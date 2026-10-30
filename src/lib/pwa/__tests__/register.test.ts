/**
 * @fileoverview Tests for the service worker registration.
 * @module lib/pwa/__tests__/register
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================================
// Mocks
// ============================================================================

interface RegisterSWOptions {
  readonly onRegisteredSW?: (swUrl: string, registration: unknown) => void;
  readonly onRegisterError?: (error: unknown) => void;
}

const { registerSW, watchForUpdates } = vi.hoisted(() => ({
  registerSW: vi.fn<(options: RegisterSWOptions) => () => Promise<void>>(
    () => () => Promise.resolve(),
  ),
  watchForUpdates: vi.fn(),
}));

vi.mock('virtual:pwa-register', () => ({ registerSW }));
vi.mock('../update-check', () => ({ watchForUpdates }));

import { registerServiceWorker } from '../register';

// ============================================================================
// Helpers
// ============================================================================

function registeredOptions(): RegisterSWOptions {
  registerServiceWorker();
  const options = registerSW.mock.calls.at(-1)?.[0];
  if (!options) {
    throw new Error('registerSW was not called');
  }
  return options;
}

// ============================================================================
// Tests
// ============================================================================

describe('registerServiceWorker', () => {
  beforeEach(() => {
    registerSW.mockClear();
    watchForUpdates.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('watches the registration for updates', () => {
    const registration = { update: vi.fn() };
    registeredOptions().onRegisteredSW?.('/sw.js', registration);

    expect(watchForUpdates).toHaveBeenCalledWith(registration);
  });

  // PostHog issues 01a10e23 and 01a0ddd3: a script injected into an Android
  // webview wraps navigator.serviceWorker.register and rejects with
  // `Error: Rejected`. vite-plugin-pwa catches it and hands it to
  // onRegisterError, and capture_console_errors turned a console.error there
  // into an exception flagged unhandled.
  it('logs a refused registration as a warning, not an error', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    registeredOptions().onRegisterError?.(new Error('Rejected'));

    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('service worker registration failed'),
      expect.any(Error),
    );
  });
});
