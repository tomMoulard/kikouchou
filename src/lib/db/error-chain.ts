/**
 * @fileoverview Finds a browser error by name inside the wrappers Dexie and
 * the repositories put around it.
 *
 * Dexie never hands over the browser's exception bare. An open that fails is
 * an `OpenFailedError` with the exception on `inner`, every query after that
 * is a `DatabaseClosedError` wrapping the same thing, and a repository adds
 * one more layer on `cause` (see `repository-error`). So the name that tells
 * one failure from another can sit two or three levels down.
 *
 * @module lib/db/error-chain
 */

/** How many errors to look at; a real chain is two or three deep. */
const MAX_ERRORS_CHECKED = 8;

/**
 * Whether an error, or one it wraps on `inner` or `cause`, carries `name`.
 *
 * Only objects count: a function that happens to be called `name` is not the
 * error. A chain that points back at itself is read once.
 *
 * @param error - Whatever was caught
 * @param name - The error name to look for, such as `QuotaExceededError`
 * @returns True when `name` is found in the first few wrappers
 */
export function hasErrorNamedInChain(error: unknown, name: string): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  while (pending.length > 0 && seen.size < MAX_ERRORS_CHECKED) {
    const current = pending.shift();
    if (typeof current !== 'object' || current === null || seen.has(current)) continue;
    seen.add(current);
    const candidate = current as { name?: unknown; inner?: unknown; cause?: unknown };
    if (candidate.name === name) return true;
    pending.push(candidate.inner, candidate.cause);
  }
  return false;
}
