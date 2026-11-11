/**
 * Tests for the database half of the boot sequence, and for telling a full
 * disk from any other IndexedDB failure.
 *
 * PostHog, 2026-10-26, Android Chrome 138: `OpenFailedError: QuotaExceededError
 * Encountered full disk while opening backing store for indexedDB.open.` The
 * phone had no space left, so IndexedDB could not even open. Boot logged the
 * failure with `console.error` (once for the sample trip, once for the
 * settings row), which PostHog records as an unhandled exception, and then
 * rendered the app over a database that could not open: the user got a
 * generic "Failed to load" and nothing said the storage was full.
 *
 * @module lib/db/__tests__/boot.test
 */
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { seedSampleTripOnce } from '@/features/trips/utils/seed-sample-trip';

import { prepareDatabase } from '../boot';
import { db } from '../database';
import { ensureSettings } from '../repositories/settings-repository';
import { isStorageFullError } from '../storage-full';

/** What Chrome throws from `indexedDB.open` when the disk is full. */
function fullDiskException(): DOMException {
  return new DOMException(
    'Encountered full disk while opening backing store for indexedDB.open.',
    'QuotaExceededError',
  );
}

/**
 * Makes the next open of the app's database fail the way it did in
 * production: Chrome refuses `indexedDB.open`, and Dexie wraps the refusal in
 * an `OpenFailedError` whose `inner` is the `QuotaExceededError`.
 */
function fillTheDisk(): void {
  // `disableAutoOpen: false`, so the next query opens the database again, as
  // the first query of a fresh page load does.
  db.close({ disableAutoOpen: false });
  vi.spyOn(indexedDB, 'open').mockImplementation(() => {
    throw fullDiskException();
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (!db.isOpen()) {
    await db.open();
  }
});

describe('isStorageFullError', () => {
  it('recognises the browser exception itself', () => {
    expect(isStorageFullError(fullDiskException())).toBe(true);
  });

  it('recognises Dexie wrapping it on open', () => {
    const wrapped = new Dexie.OpenFailedError(fullDiskException());

    expect(wrapped.name).toBe('OpenFailedError');
    expect(isStorageFullError(wrapped)).toBe(true);
  });

  it("recognises Dexie's own QuotaExceededError", () => {
    expect(isStorageFullError(new Dexie.QuotaExceededError('full'))).toBe(true);
  });

  it('recognises it as the cause of a repository error', () => {
    const error = new Error('Failed to save settings', { cause: fullDiskException() });

    expect(isStorageFullError(error)).toBe(true);
  });

  it('does not take any other failure for a full disk', () => {
    const internal = new Error('An internal error was encountered');
    internal.name = 'UnknownError';

    expect(isStorageFullError(internal)).toBe(false);
    expect(isStorageFullError(new Dexie.OpenFailedError(internal))).toBe(false);
    expect(isStorageFullError(new Error('QuotaExceededError'))).toBe(false);
    expect(isStorageFullError('QuotaExceededError')).toBe(false);
    expect(isStorageFullError(null)).toBe(false);
    expect(isStorageFullError(undefined)).toBe(false);
  });

  it('does not loop on a cause that points back at itself', () => {
    const error = new Error('loop');
    Object.defineProperty(error, 'cause', { value: error });

    expect(isStorageFullError(error)).toBe(false);
  });
});

describe('prepareDatabase', () => {
  it('reports a full disk once, as a warning, and tells the caller', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fillTheDisk();

    const outcome = await prepareDatabase({
      seed: async () => {
        await seedSampleTripOnce('en');
      },
      ensureSettings,
      timeoutMs: 3000,
    });

    expect(consoleError).not.toHaveBeenCalled();
    expect(outcome).toBe('storage-full');
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(isStorageFullError(consoleWarn.mock.calls[0]?.[1])).toBe(true);
  });

  it('answers ready when the database opens', async () => {
    const seed = vi.fn(async () => undefined);

    await expect(prepareDatabase({ seed, ensureSettings, timeoutMs: 3000 })).resolves.toBe(
      'ready',
    );
    expect(seed).toHaveBeenCalledTimes(1);
    await expect(db.settings.count()).resolves.toBe(1);
  });

  it('still creates the settings row when only the sample trip fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const outcome = await prepareDatabase({
      seed: () => Promise.reject(new Error('sample broke')),
      ensureSettings,
      timeoutMs: 3000,
    });

    expect(outcome).toBe('ready');
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to seed the sample trip:',
      expect.any(Error),
    );
    await expect(db.settings.count()).resolves.toBe(1);
  });

  it('logs any other failure as an error and lets the app render', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = new Error('blocked');

    const outcome = await prepareDatabase({
      ensureSettings: () => Promise.reject(failure),
      timeoutMs: 3000,
    });

    expect(outcome).toBe('failed');
    expect(consoleError).toHaveBeenCalledWith('Database initialization failed:', failure);
  });

  it('gives up waiting after the timeout, without an error', async () => {
    vi.useFakeTimers();
    try {
      const outcome = prepareDatabase({
        ensureSettings: () => new Promise<never>(() => undefined),
        timeoutMs: 3000,
      });
      await vi.advanceTimersByTimeAsync(3000);

      await expect(outcome).resolves.toBe('timed-out');
    } finally {
      vi.useRealTimers();
    }
  });
});
