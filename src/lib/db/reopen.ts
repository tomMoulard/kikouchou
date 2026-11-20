/**
 * @fileoverview Retries a database call once after reopening IndexedDB.
 *
 * On iOS Safari, IndexedDB sometimes answers with "UnknownError: An internal
 * error was encountered in the Indexed Database server": the connection
 * WebKit's IndexedDB process held for the page is gone, and every request on
 * it fails the same way. Closing and reopening the database gets a fresh
 * connection, and the request then succeeds. Boot's `ensureSettings()` hit it
 * and left the app on default settings over a dead connection (PostHog issue
 * `01a13061`).
 *
 * One reopen, not a loop: an IndexedDB that fails the same way on a fresh
 * connection is broken for this page, and the caller's own error handling is
 * the right place for that.
 *
 * The same dead connection also answers "UnknownError: Attempt to open a
 * cursor in database without an in-progress transaction": the page created
 * the transaction a moment before, but WebKit's server no longer knows it
 * (PostHog issue `01a1f5a2`, the trip list's guest badges).
 *
 * It is safe inside a `liveQuery` querier, which is where the trip list calls
 * it. Dexie does the same close and open from inside its own transactions
 * (its `PR1398` path), and `Dexie.open()` runs in the global zone, so the
 * querier's zone does not leak into the open. The retried read is still one
 * the live query observes (`reopen.test.ts` adds a row after a reopen and
 * watches the query answer again). Several callers meet the dead connection
 * at about the same moment, so they share one reopen: a caller that fails
 * while a reopen runs joins it, and a caller whose call started before the
 * last reopen just runs again, rather than closing the new connection.
 *
 * @module lib/db/reopen
 */

import { db } from './database';
import { hasErrorNamedInChain } from './error-chain';

/** The two calls this needs from a Dexie database. */
export interface ReopenableDatabase {
  close(options?: { disableAutoOpen: boolean }): void;
  open(): Promise<unknown>;
}

/** The reopen under way for each database, shared by every caller. */
const reopening = new WeakMap<ReopenableDatabase, Promise<unknown>>();

/** How many reopens each database has started: which connection a call met. */
const generations = new WeakMap<ReopenableDatabase, number>();

function generationOf(database: ReopenableDatabase): number {
  return generations.get(database) ?? 0;
}

/**
 * Closes the database and opens it again, or joins the reopen under way.
 *
 * `disableAutoOpen: false` is how Dexie closes a connection it means to
 * reopen: a query that arrives meanwhile waits for the open, and if the open
 * fails, the next query tries again. The default `close()` turns auto-open
 * off, so after a failed open every query failed with `DatabaseClosedError`,
 * which a live query swallows: its screen stayed on its loading state.
 *
 * @param database - The database to reopen
 * @param failedOn - The generation the failed call started on
 */
function reopen(database: ReopenableDatabase, failedOn: number): Promise<unknown> {
  const pending = reopening.get(database);
  if (pending !== undefined) return pending;
  if (generationOf(database) !== failedOn) {
    // The call started on a connection that has been replaced since.
    return Promise.resolve();
  }
  generations.set(database, failedOn + 1);
  database.close({ disableAutoOpen: false });
  const opened = database.open().finally(() => {
    reopening.delete(database);
  });
  reopening.set(database, opened);
  return opened;
}

/**
 * Whether an error is IndexedDB's internal failure, which a new connection
 * may cure. Dexie keeps the browser's own error on `inner`, and wraps it once
 * more in a `DatabaseClosedError` for every query after a failed open; a
 * repository adds `cause`. So the name is looked for down the chain.
 *
 * @param error - Whatever was caught
 * @returns True for an `UnknownError` anywhere in the first few wrappers
 */
export function isTransientIndexedDbError(error: unknown): boolean {
  return hasErrorNamedInChain(error, 'UnknownError');
}

/**
 * Runs `operation`, and runs it once more on a reopened database if IndexedDB
 * failed internally.
 *
 * @param operation - The database call
 * @param database - The database to reopen; the app's own by default
 * @returns What `operation` resolved with
 */
export async function retryAfterReopen<T>(
  operation: () => Promise<T>,
  database: ReopenableDatabase = db,
): Promise<T> {
  const generation = generationOf(database);
  try {
    return await operation();
  } catch (error) {
    if (!isTransientIndexedDbError(error)) {
      throw error;
    }
    // A warning: the retry is expected to cure it, and if it does not, the
    // caller reports what the retry threw.
    console.warn('[db] IndexedDB failed internally, reopening once:', error);
    await reopen(database, generation);
    return operation();
  }
}
