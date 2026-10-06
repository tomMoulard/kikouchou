/**
 * @fileoverview Tests for the stale-build check behind the catch-all route.
 *
 * The behaviour worth pinning is the refusal, not the recovery: a reload that
 * happens when no newer worker ever took over is a reload loop, because the
 * same worker answers it from the same precache and lands on the same missing
 * route.
 *
 * @module lib/pwa/__tests__/stale-build
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  recoverFromStaleBuild,
  STALE_BUILD_TIMEOUT_MS,
  type StaleBuildContainer,
  type StaleBuildRegistration,
} from '../stale-build';

// ============================================================================
// Helpers
// ============================================================================

interface FakeContainer extends StaleBuildContainer {
  /** Fires `controllerchange`, the way an activating worker does. */
  readonly takeOver: () => void;
}

function createContainer(options: {
  controlled?: boolean;
  registration?: StaleBuildRegistration | null;
}): FakeContainer {
  const listeners = new Set<() => void>();
  const { controlled = true, registration = null } = options;

  return {
    controller: controlled ? {} : null,
    getRegistration: vi.fn(() => Promise.resolve(registration)),
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
    takeOver: () => {
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

function createRegistration(newer: boolean): StaleBuildRegistration {
  return {
    update: vi.fn(() => Promise.resolve()),
    installing: newer ? {} : null,
    waiting: null,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('recoverFromStaleBuild', () => {
  let reload: () => void;

  beforeEach(() => {
    reload = vi.fn<() => void>();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('refuses the path when no worker answered the navigation', async () => {
    const container = createContainer({ controlled: false });

    await expect(recoverFromStaleBuild({ container, reload })).resolves.toBe(false);
    expect(container.getRegistration).not.toHaveBeenCalled();
    expect(vi.mocked(reload)).not.toHaveBeenCalled();
  });

  it('refuses the path when this browser has no service worker at all', async () => {
    await expect(recoverFromStaleBuild({ container: null, reload })).resolves.toBe(false);
    expect(vi.mocked(reload)).not.toHaveBeenCalled();
  });

  it('refuses the path when there is no registration to ask', async () => {
    const container = createContainer({ registration: null });

    await expect(recoverFromStaleBuild({ container, reload })).resolves.toBe(false);
    expect(vi.mocked(reload)).not.toHaveBeenCalled();
  });

  it('refuses the path when the running build is the current one', async () => {
    const registration = createRegistration(false);
    const container = createContainer({ registration });

    await expect(recoverFromStaleBuild({ container, reload })).resolves.toBe(false);
    expect(registration.update).toHaveBeenCalled();
    expect(vi.mocked(reload)).not.toHaveBeenCalled();
  });

  it('refuses the path when the update check itself fails', async () => {
    const registration: StaleBuildRegistration = {
      update: vi.fn(() => Promise.reject(new Error('offline'))),
      installing: {},
      waiting: null,
    };
    const container = createContainer({ registration });

    await expect(recoverFromStaleBuild({ container, reload })).resolves.toBe(false);
    expect(vi.mocked(reload)).not.toHaveBeenCalled();
  });

  it('reloads once a newer worker has taken over', async () => {
    const container = createContainer({ registration: createRegistration(true) });

    const recovery = recoverFromStaleBuild({ container, reload });
    // Past `getRegistration` and `update`, which are two microtasks.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    container.takeOver();

    await expect(recovery).resolves.toBe(true);
    expect(vi.mocked(reload)).toHaveBeenCalledTimes(1);
  });

  it('gives up rather than reloading onto the same worker', async () => {
    vi.useFakeTimers();
    const container = createContainer({ registration: createRegistration(true) });

    const recovery = recoverFromStaleBuild({ container, reload });
    await vi.advanceTimersByTimeAsync(STALE_BUILD_TIMEOUT_MS + 1);

    await expect(recovery).resolves.toBe(false);
    expect(vi.mocked(reload)).not.toHaveBeenCalled();
  });
});
