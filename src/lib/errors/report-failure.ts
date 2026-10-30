/**
 * @fileoverview What to do with an error the app caught and handled.
 *
 * A caught error used to go three separate ways at every call site, and one of
 * the three was always missing. It reached the console, which nobody reads on a
 * phone. It reached the user as a translated headline — `Failed to save` — that
 * names the operation and never the fault. And it reached PostHog not at all,
 * because `capture_exceptions` only sees errors that stay unhandled, so
 * catching one is exactly what hides it.
 *
 * That combination produced a bug report no one could act on: a session replay
 * showing a red toast on the rooms page, a console line with an empty message,
 * and an error tracking view with nothing in it.
 *
 * This does all three in one call, so a handler cannot do two of them and
 * forget the third.
 *
 * @module lib/errors/report-failure
 */

import { describeCause } from '@/lib/db/repository-error';
import { notify } from '@/lib/notifications';
import { reportError } from '@/lib/posthog';

/**
 * Logs a handled failure, reports it, and tells the user what went wrong.
 *
 * The toast keeps the translated headline it always had, because that is the
 * part the user reads first and the part that is in their language. The fault
 * goes underneath it as the description: untranslated, because it comes from
 * the browser or from Dexie, and unhelpful English beats a silent failure the
 * user can only describe as "it does nothing".
 *
 * @param source - Where this failure happened, as a stable identifier that can
 *   be grouped on in PostHog: `RoomListPage.assignGuestToRoom`. Not translated,
 *   not shown to the user.
 * @param error - Whatever was caught.
 * @param message - The already-translated headline for the toast.
 * @param context - Extra domain detail for PostHog. Never anything that
 *   identifies a guest: trip records are not identities in this project.
 *
 * @example
 * ```typescript
 * catch (error) {
 *   reportFailure('RoomListPage.assignGuestToRoom', error, t('errors.saveFailed'), {
 *     room_id: roomId,
 *   });
 * }
 * ```
 */
export function reportFailure(
  source: string,
  error: unknown,
  message: string,
  context?: Record<string, unknown>,
): void {
  const reason = describeCause(error);

  console.error(`${source}:`, error);
  reportError(error, { source, reason, ...context });
  notify.error(message, { description: reason });
}
