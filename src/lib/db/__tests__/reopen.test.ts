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
import { liveQuery } from 'dexie';

import { db } from '../database';
import { isTransientIndexedDbError, retryAfterReopen } from '../reopen';
import type { Person, PersonId, TripId } from '@/types';

/** What Dexie rejects with when WebKit's IndexedDB server has failed. */
function webkitInternalError(): Error {
  const error = new Error(
    'An internal error was encountered in the Indexed Database server\n UnknownError: An internal error was encountered in the Indexed Database server',
  );
  error.name = 'UnknownError';
  return error;
}

function fakeDatabase(): {
  close: Mock<(options?: { disableAutoOpen: boolean }) => void>;
  open: Mock<() => Promise<undefined>>;
} {
  return {
    close: vi.fn<(options?: { disableAutoOpen: boolean }) => void>(),
    open: vi.fn(async () => undefined),
  };
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

  it('recognises it under the wrappers Dexie and a repository add', () => {
    const closed = Object.assign(new Error('Database has been closed'), {
      name: 'DatabaseClosedError',
      inner: Object.assign(new Error('open failed'), {
        name: 'OpenFailedError',
        inner: webkitInternalError(),
      }),
    });

    expect(isTransientIndexedDbError(closed)).toBe(true);
    expect(isTransientIndexedDbError(new Error('Failed to load', { cause: closed }))).toBe(true);
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

/**
 * PostHog issue `01a1f5a2`: the trip list's guests read, a `liveQuery`, met
 * the same dead connection ("Attempt to open a cursor in database without an
 * in-progress transaction"). A live query is not alone on the page, so the
 * reopen has to suit several callers at once and leave the live query
 * observing.
 */
describe('retryAfterReopen inside live queries', () => {
  /** A real IndexedDB round trip, under a loaded machine's suite. */
  const REAL_DATABASE_WAIT = { timeout: 5000 };

  function lostConnectionError(): Error {
    const message = 'Attempt to open a cursor in database without an in-progress transaction';
    return Object.assign(new Error(message), {
      name: 'UnknownError',
      inner: new DOMException(message, 'UnknownError'),
    });
  }

  it('keeps auto-open on, as Dexie does when it reopens', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const database = fakeDatabase();
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(lostConnectionError())
      .mockResolvedValueOnce('guests');

    await expect(retryAfterReopen(operation, database)).resolves.toBe('guests');
    expect(database.close).toHaveBeenCalledWith({ disableAutoOpen: false });
  });

  it('shares one reopen between callers that fail at the same moment', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const database = fakeDatabase();
    let finishOpen: () => void = () => undefined;
    database.open.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          finishOpen = () => resolve(undefined);
        }),
    );
    const first = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(lostConnectionError())
      .mockResolvedValueOnce('first');
    const second = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(lostConnectionError())
      .mockResolvedValueOnce('second');

    const both = Promise.all([
      retryAfterReopen(first, database),
      retryAfterReopen(second, database),
    ]);
    await vi.waitFor(() => {
      expect(database.open).toHaveBeenCalledTimes(1);
    });
    // Both have failed and are waiting on the one open.
    await vi.waitFor(() => {
      expect(console.warn).toHaveBeenCalledTimes(2);
    });
    finishOpen();

    await expect(both).resolves.toEqual(['first', 'second']);
    expect(database.close).toHaveBeenCalledTimes(1);
    expect(database.open).toHaveBeenCalledTimes(1);
  });

  it('does not close the new connection for a call that started on the old one', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const database = fakeDatabase();
    let failLate: (error: Error) => void = () => undefined;
    const early = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(lostConnectionError())
      .mockResolvedValueOnce('early');
    // Sent on the old connection, but its failure arrives after the reopen.
    const late = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(
        () =>
          new Promise<string>((_resolve, reject) => {
            failLate = reject;
          }),
      )
      .mockResolvedValueOnce('late');

    const lateResult = retryAfterReopen(late, database);
    await expect(retryAfterReopen(early, database)).resolves.toBe('early');
    failLate(lostConnectionError());

    await expect(lateResult).resolves.toBe('late');
    expect(database.close).toHaveBeenCalledTimes(1);
    expect(database.open).toHaveBeenCalledTimes(1);
  });

  it('reopens again for a failure after the last reopen finished', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const database = fakeDatabase();
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(lostConnectionError())
      .mockResolvedValueOnce('one')
      .mockRejectedValueOnce(lostConnectionError())
      .mockResolvedValueOnce('two');

    await expect(retryAfterReopen(operation, database)).resolves.toBe('one');
    await expect(retryAfterReopen(operation, database)).resolves.toBe('two');
    expect(database.close).toHaveBeenCalledTimes(2);
    expect(database.open).toHaveBeenCalledTimes(2);
  });

  it('leaves a live query on the real database observing after the reopen', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const tripId = 'trip-reopen' as TripId;
    const person = (id: string, name: string): Person => ({
      id: id as PersonId,
      tripId,
      name,
      color: '#ef4444' as Person['color'],
    });
    await db.persons.add(person('person-1', 'Alice'));
    let failNext = true;

    const names: string[][] = [];
    const subscription = liveQuery(async () => {
      const persons = await retryAfterReopen(() => {
        if (failNext) {
          failNext = false;
          return Promise.reject(lostConnectionError());
        }
        return db.persons.where('tripId').anyOf([tripId]).toArray();
      }, db);
      return persons.map((entry) => entry.name).sort();
    }).subscribe((value) => {
      names.push(value);
    });

    try {
      await vi.waitFor(() => {
        expect(names).toEqual([['Alice']]);
      }, REAL_DATABASE_WAIT);
      expect(db.isOpen()).toBe(true);

      // The read after the reopen is still what the live query watches.
      await db.persons.add(person('person-2', 'Bob'));

      await vi.waitFor(() => {
        expect(names.at(-1)).toEqual(['Alice', 'Bob']);
      }, REAL_DATABASE_WAIT);
    } finally {
      subscription.unsubscribe();
    }
  });
});
