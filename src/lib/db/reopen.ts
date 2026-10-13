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
 * @module lib/db/reopen
 */

import { db } from './database';

/** The two calls this needs from a Dexie database. */
export interface ReopenableDatabase {
  close(): void;
  open(): Promise<unknown>;
}

/**
 * Whether an error is IndexedDB's internal failure, which a new connection
 * cures. Dexie keeps the browser's own error on `inner`.
 *
 * @param error - Whatever was caught
 * @returns True for an `UnknownError`, at the top or one level down
 */
export function isTransientIndexedDbError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ((error as { name?: unknown }).name === 'UnknownError') return true;
  const inner = (error as { inner?: unknown }).inner;
  return typeof inner === 'object' && inner !== null && (inner as { name?: unknown }).name === 'UnknownError';
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
  try {
    return await operation();
  } catch (error) {
    if (!isTransientIndexedDbError(error)) {
      throw error;
    }
    // A warning: the retry is expected to cure it, and if it does not, the
    // caller reports what the retry threw.
    console.warn('[db] IndexedDB failed internally, reopening once:', error);
    database.close();
    await database.open();
    return operation();
  }
}
