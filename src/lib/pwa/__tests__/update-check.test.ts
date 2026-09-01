/**
 * @fileoverview Tests for the service worker update check.
 * @module lib/pwa/__tests__/update-check
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UPDATE_CHECK_INTERVAL_MS, watchForUpdates } from '../update-check';

// ============================================================================
// Helpers
// ============================================================================

/** jsdom reports `visible` and offers no way to change it. */
function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => online,
  });
}

type UpdateFn = () => Promise<unknown>;

function createRegistration(update: UpdateFn = () => Promise.resolve()) {
  return { update: vi.fn<UpdateFn>(update) };
}

// ============================================================================
// Tests
// ============================================================================

describe('watchForUpdates', () => {
  let stop: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    setOnline(true);
    setVisibility('visible');
  });

  afterEach(() => {
    stop?.();
    stop = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not check on startup', () => {
    const registration = createRegistration();

    stop = watchForUpdates(registration);

    // Registration has only just resolved; the browser fetched `sw.js` to get
    // here, so asking again immediately would be a duplicate request.
    expect(registration.update).not.toHaveBeenCalled();
  });

  it('checks when the tab goes away, so the reload happens off-screen', () => {
    const registration = createRegistration();
    stop = watchForUpdates(registration);

    setVisibility('hidden');

    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('does not check when the tab comes back', () => {
    const registration = createRegistration();
    stop = watchForUpdates(registration);

    setVisibility('hidden');
    registration.update.mockClear();
    setVisibility('visible');

    expect(registration.update).not.toHaveBeenCalled();
  });

  it('still checks a session that is never hidden', () => {
    const registration = createRegistration();
    stop = watchForUpdates(registration);

    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS * 2);

    expect(registration.update).toHaveBeenCalledTimes(2);
  });

  it('skips the check while offline', () => {
    const registration = createRegistration();
    stop = watchForUpdates(registration);

    setOnline(false);
    setVisibility('hidden');
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);

    expect(registration.update).not.toHaveBeenCalled();
  });

  it('keeps checking after a failed check', async () => {
    const registration = createRegistration(() =>
      Promise.reject(new Error('network')),
    );
    stop = watchForUpdates(registration);

    setVisibility('hidden');
    // Let the rejection settle: an unhandled one would fail the run.
    await Promise.resolve();

    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);

    expect(registration.update).toHaveBeenCalledTimes(2);
  });

  it('stops both the listener and the interval when disposed', () => {
    const registration = createRegistration();
    const dispose = watchForUpdates(registration);

    dispose();

    setVisibility('hidden');
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS * 2);

    expect(registration.update).not.toHaveBeenCalled();
  });
});
