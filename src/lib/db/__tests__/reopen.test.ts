/**
 * Tests for retrying a database call once after reopening IndexedDB.
 *
 * PostHog issue `01a13061`: on iOS Safari, IndexedDB sometimes answers the
 * first request with "UnknownError: An internal error was encountered in the
 * Indexed Database server" — the connection the WebKit IndexedDB process held
 * for the page has gone. Boot's `ensureSettings()` rejected with it, and the
 * app came up on default settings with a dead connection.
 *
 * @module lib/db/__tests__/reopen.test
 */
import { type Mock, afterEach, describe, expect, it, vi } from 'vitest';

import { isTransientIndexedDbError, retryAfterReopen } from '../reopen';

/** What Dexie rejects with when WebKit's IndexedDB server has failed. */
function webkitInternalError(): Error {
  const error = new Error(
    'An internal error was encountered in the Indexed Database server\n UnknownError: An internal error was encountered in the Indexed Database server',
  );
  error.name = 'UnknownError';
  return error;
}

function fakeDatabase(): {
  close: Mock<() => void>;
  open: Mock<() => Promise<undefined>>;
} {
  return { close: vi.fn<() => void>(), open: vi.fn(async () => undefined) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('retryAfterReopen', () => {
  it('recovers from an internal IndexedDB error by reopening once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const database = fakeDatabase();
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(webkitInternalError())
      .mockResolvedValueOnce('settings');

    await expect(retryAfterReopen(operation, database)).resolves.toBe('settings');
    expect(database.close).toHaveBeenCalledTimes(1);
    expect(database.open).toHaveBeenCalledTimes(1);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not log an error for a failure it recovered from', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(webkitInternalError())
      .mockResolvedValueOnce('settings');

    await retryAfterReopen(operation, fakeDatabase());

    expect(consoleError).not.toHaveBeenCalled();
  });

  it('gives up after one reopen', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(webkitInternalError());

    await expect(retryAfterReopen(operation, fakeDatabase())).rejects.toThrow(
      'internal error',
    );
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('passes any other failure straight through', async () => {
    const database = fakeDatabase();
    const quota = new Error('quota');
    quota.name = 'QuotaExceededError';
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(quota);

    await expect(retryAfterReopen(operation, database)).rejects.toBe(quota);
    expect(database.close).not.toHaveBeenCalled();
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe('isTransientIndexedDbError', () => {
  it('recognises the WebKit internal error, directly or as a cause', () => {
    expect(isTransientIndexedDbError(webkitInternalError())).toBe(true);
    expect(
      isTransientIndexedDbError(Object.assign(new Error('wrapped'), { inner: webkitInternalError() })),
    ).toBe(true);
  });

  it('ignores everything else', () => {
    expect(isTransientIndexedDbError(new Error('nope'))).toBe(false);
    expect(isTransientIndexedDbError('UnknownError')).toBe(false);
    expect(isTransientIndexedDbError(null)).toBe(false);
  });
});

describe('isTransientIndexedDbError: what counts as wrapped', () => {
  it('does not read a function named UnknownError as the wrapped error', () => {
    function UnknownError(): void {}

    expect(isTransientIndexedDbError({ name: 'AbortError', inner: UnknownError })).toBe(false);
  });

  it('reads an empty wrapper as not transient', () => {
    expect(isTransientIndexedDbError({ name: 'AbortError', inner: null })).toBe(false);
  });

  it('reads a wrapped error of another kind as not transient', () => {
    expect(
      isTransientIndexedDbError({ name: 'AbortError', inner: { name: 'QuotaExceededError' } }),
    ).toBe(false);
  });

  it('does not take a function for an error, whatever it is called', () => {
    function UnknownError(): void {}

    expect(isTransientIndexedDbError(UnknownError)).toBe(false);
  });

  it('says why it reopens', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const database = { close: vi.fn(), open: vi.fn(async () => undefined) };
    const failure = Object.assign(new Error('internal'), { name: 'UnknownError' });
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce('ok');

    await expect(retryAfterReopen(operation, database as never)).resolves.toBe('ok');

    expect(warn).toHaveBeenCalledWith(
      '[db] IndexedDB failed internally, reopening once:',
      failure,
    );
  });
});
