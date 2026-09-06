/**
 * @fileoverview Local OS notifications for ride notices, and their limits.
 *
 * ## What this is
 *
 * The app ships no server. There is no VAPID key, no subscription table and no
 * cron, so nothing can wake a phone that is not already running Kikouchou.
 * What is here instead is the *local* half of the Web Notifications API:
 * `registration.showNotification()`, called from the page, delivered by the
 * service worker the app already installs.
 *
 * ## What that means, honestly
 *
 * A notice is announced **while the page is open, or while the service worker
 * happens to be alive**. A backgrounded tab or a recently-used installed PWA
 * usually still counts; a phone that has not opened the app since yesterday
 * does not. iOS is stricter again — the Notification API exists only in a PWA
 * added to the Home Screen, and the worker is evicted aggressively.
 *
 * So this is genuinely best-effort, and it is the *second* half of telling a
 * driver they need to set off. The load-bearing half is the in-app alert, which
 * is computed from the same `rideNotices` rows and is guaranteed to be there
 * the moment the driver opens the app. This module makes the good case better;
 * it is not what makes the feature correct. Nothing that matters may be
 * reachable only through a notification.
 *
 * Stating that here rather than papering over it, because the failure is
 * invisible: nothing reports "the notification you expected did not arrive".
 *
 * ## Shape
 *
 * - `permission.ts` — the four states, and the one place that ever asks. The
 *   ask is behind a settings card, never on load.
 * - `notify.ts` — one notice, at most once per device, never throwing.
 * - `public/sw-notifications.js` — the `notificationclick` handler, folded into
 *   the generated Workbox worker by `workbox.importScripts` in
 *   `vite.config.ts`. The worker stays in `generateSW` mode; see that file.
 *
 * @module lib/notifications
 */

// ============================================================================
// Permission
// ============================================================================

export {
  getNotificationState,
  isNotificationSupported,
  NOTIFICATION_STATES,
  requestNotificationPermission,
  type NotificationState,
} from './permission';

// ============================================================================
// Delivery
// ============================================================================

export { notify, type RideNotification } from './notify';
