/**
 * @fileoverview One way for a repository to wrap a failed database write.
 *
 * Every repository already wrapped its Dexie failures in an `Error` that says
 * which record it was writing, and passed the original as `cause`. That reads
 * well and loses the only part that explains *why* the write failed: nothing in
 * this app ever reads `.cause`, so the wrapper's message was all anyone saw.
 *
 * It cost a real investigation. A guest could not house anyone on the rooms
 * page, and the console held `Failed to create room assignment:` followed by a
 * bare stack — the underlying reason was a `DOMException` on the `cause`, and a
 * `DOMException` from IndexedDB often carries an empty `message`, so the
 * browser printed the wrapper and a stack and nothing else. The session replay
 * showed a red toast; error tracking showed nothing at all.
 *
 * So the cause is folded into the message here, and still attached as `cause`
 * for anything that does look. Errors thrown through this helper name both the
 * record and the fault in one line, which is what lands in a toast, on the
 * error page, and in PostHog.
 *
 * @module lib/db/repository-error
 */

/**
 * The readable part of whatever a database layer threw.
 *
 * Dexie rejects with an `Error` subclass most of the time, with a
 * `DOMException` when IndexedDB itself refuses, and — on an aborted
 * transaction — occasionally with an event object that is neither. The last two
 * are why this does not simply read `.message`: an empty or absent message has
 * to degrade to the error's name (`QuotaExceededError`, `DatabaseClosedError`)
 * rather than to an empty string, because the name alone is usually enough to
 * tell a full disk from a closed database.
 *
 * @param cause - Whatever was caught. Any value, including a non-`Error`.
 * @returns A non-empty, human-readable description.
 */
export function describeCause(cause: unknown): string {
  if (cause instanceof Error || cause instanceof DOMException) {
    const message = cause.message.trim();
    return message.length > 0 ? `${cause.name}: ${message}` : cause.name;
  }

  if (typeof cause === 'string' && cause.trim().length > 0) {
    return cause.trim();
  }

  return String(cause);
}

/**
 * Builds the error a repository throws when a write fails.
 *
 * @param what - What the repository was doing, in the present tense and naming
 *   the record: `Failed to create assignment for person p1 in room r2`. It
 *   becomes the first half of the message, so it must not end in punctuation.
 * @param cause - The value the database layer threw.
 * @returns An `Error` reading `<what>: <cause>`, carrying `cause` unchanged.
 *
 * @example
 * ```typescript
 * try {
 *   await db.roomAssignments.add(assignment);
 * } catch (error) {
 *   throw repositoryError(`Failed to create assignment ${assignment.id}`, error);
 * }
 * // message: 'Failed to create assignment abc: ConstraintError: Key already exists'
 * ```
 */
export function repositoryError(what: string, cause: unknown): Error {
  return new Error(`${what}: ${describeCause(cause)}`, { cause });
}
