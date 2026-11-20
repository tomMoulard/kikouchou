/**
 * @fileoverview Tells a full disk from any other IndexedDB failure.
 *
 * A phone with no space left refuses even to open IndexedDB: Chrome throws
 * `QuotaExceededError: Encountered full disk while opening backing store for
 * indexedDB.open.` Dexie never hands that over bare. It wraps it in an
 * `OpenFailedError` with the browser's exception on `inner`, and every query
 * after that fails with a `DatabaseClosedError` wrapping the same thing. A
 * repository adds one more layer, on `cause` (see `repository-error`). A write
 * that runs past the quota is the same name, one level down.
 *
 * Nothing in the app can cure it, and nothing is wrong with the app: the user
 * has to free some space. So it is reported apart from real failures.
 *
 * @module lib/db/storage-full
 */

import { hasErrorNamedInChain } from './error-chain';

/** The name both the browser and Dexie give a full disk. */
const STORAGE_FULL_NAME = 'QuotaExceededError';

/**
 * Whether an error, or one it wraps on `inner` or `cause`, says the device has
 * no storage left.
 *
 * @param error - Whatever was caught
 * @returns True for a `QuotaExceededError` anywhere in the first few wrappers
 */
export function isStorageFullError(error: unknown): boolean {
  return hasErrorNamedInChain(error, STORAGE_FULL_NAME);
}
