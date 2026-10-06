/**
 * @fileoverview The one entry point for user feedback, and the split that
 * decides where a message lands.
 *
 * **A confirmation goes to the operating system. A problem stays in the page.**
 *
 * Confirmations are the messages that piled up: they arrive in bursts (three
 * room creations, one guest group import per member), they say something the
 * user already knows they did, and every one of them was a fixed card over the
 * content. The OS notification shade is the right home for those.
 *
 * Errors and warnings are not. They report something the user did *not* ask
 * for and has to read — a save that failed, guests that were dropped from a
 * group — and their delivery must not depend on a permission the user may have
 * denied, on an iOS install, or on the notification shade being looked at.
 * They stay sonner toasts, where they also keep sonner's `role="alert"`.
 *
 * A confirmation can therefore be lost: a denied permission means nobody sees
 * "Room created successfully". That is the accepted trade — the saved room is
 * itself visible on the page behind the message — and it is why the live-region
 * announcement in {@link announceStatus} runs regardless of delivery, so a
 * screen reader still says it.
 *
 * Import `notify` from here rather than `toast` from `sonner`, so the split
 * stays in one file instead of at 80 call sites.
 *
 * @module lib/notifications/notify
 */

import { toast, type ExternalToast } from 'sonner';

import { announceStatus } from '@/lib/notifications/announcer';
import { showOsNotification } from '@/lib/notifications/os-notification';

// ============================================================================
// Internals
// ============================================================================

/**
 * Announces a confirmation, then sends it to the operating system.
 *
 * Deliberately not awaited by callers: `showOsNotification` may open a
 * permission prompt, and no save should wait on that. Its `false` — denied,
 * unsupported — is not an error and not reported.
 */
function confirm(message: string): void {
  announceStatus(message);
  void showOsNotification(message);
}

// ============================================================================
// API
// ============================================================================

/**
 * User feedback: confirmations to the operating system, problems to the page.
 *
 * @example
 * ```ts
 * notify.success(t('rooms.createSuccess', 'Room created successfully'));
 * notify.error(t('errors.saveFailed'));
 * ```
 */
export const notify = {
  /**
   * Confirms something the user just did.
   *
   * Reaches an OS notification, or nothing at all when notifications are
   * unavailable or refused. Never a card over the content.
   *
   * @param message - The message, already translated.
   */
  success(message: string): void {
    confirm(message);
  },

  /**
   * States a neutral fact the user just caused, like a switched trip.
   *
   * Same delivery as {@link notify.success}; the two are separate names
   * because the call sites read better, not because the surface differs.
   *
   * @param message - The message, already translated.
   */
  info(message: string): void {
    confirm(message);
  },

  /**
   * Reports something that went wrong, in the page, as a toast.
   *
   * @param message - The message, already translated.
   * @param options - Passed through to sonner.
   */
  error(message: string, options?: ExternalToast): void {
    // Forwarded positionally only when there is something to forward: sonner
    // treats a trailing `undefined` the same either way, but a test asserting
    // `toHaveBeenCalledWith(message)` does not.
    if (options === undefined) {
      toast.error(message);
      return;
    }
    toast.error(message, options);
  },

  /**
   * Reports something that half worked and the user has to know about.
   *
   * A toast for the same reason an error is: it is news, not a confirmation.
   *
   * @param message - The message, already translated.
   * @param options - Passed through to sonner.
   */
  warning(message: string, options?: ExternalToast): void {
    if (options === undefined) {
      toast.warning(message);
      return;
    }
    toast.warning(message, options);
  },
} as const;
