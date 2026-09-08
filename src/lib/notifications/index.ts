/**
 * @fileoverview Barrel export for user feedback.
 *
 * Two things live here, and they are not the same thing.
 *
 * ## In-app feedback — `notify`
 *
 * Confirmations and problems raised by something the user just did. See
 * `notify.ts` for the split: a confirmation goes to the operating system, a
 * problem stays in the page. Every screen imports `notify` from here rather
 * than `toast` from sonner.
 *
 * ## Ride notices — `notifyRide`
 *
 * Local OS notifications about a ride that is due, and their limits.
 *
 * The app ships no server. There is no VAPID key, no subscription table and no
 * cron, so nothing can wake a phone that is not already running Kikouchou.
 * What is here instead is the *local* half of the Web Notifications API:
 * `registration.showNotification()`, called from the page, delivered by the
 * service worker the app already installs.
 *
 * A notice is therefore announced **while the page is open, or while the
 * service worker happens to be alive**. A backgrounded tab or a recently-used
 * installed PWA usually still counts; a phone that has not opened the app
 * since yesterday does not. iOS is stricter again — the Notification API
 * exists only in a PWA added to the Home Screen, and the worker is evicted
 * aggressively.
 *
 * So this is genuinely best-effort, and it is the *second* half of telling a
 * driver they need to set off. The load-bearing half is the in-app alert, read
 * from the same `rideNotices` rows and guaranteed to be there the moment the
 * driver opens the app. Nothing that matters may be reachable only through a
 * notification.
 *
 * ## Shape
 *
 * - `notify.ts` — in-app feedback, and where each kind of message lands.
 * - `announcer.ts`, `os-notification.ts` — the two deliveries it splits over.
 * - `permission.ts` — the four notification states, and the one place that
 *   ever asks. The ask is behind a settings card, never on load.
 * - `ride-notify.ts` — one ride notice, at most once per device, never
 *   throwing.
 * - `public/sw-notifications.js` — the `notificationclick` handler, folded into
 *   the generated Workbox worker by `workbox.importScripts` in
 *   `vite.config.ts`. The worker stays in `generateSW` mode; see that file.
 *
 * @module lib/notifications
 */

// ============================================================================
// In-app feedback
// ============================================================================

export { notify } from './notify';
export { announceStatus, subscribeToStatus, type StatusListener } from './announcer';
export {
  showOsNotification,
  isOsNotificationSupported,
  osNotificationPermission,
} from './os-notification';

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
// Ride notices
// ============================================================================

export { notifyRide, type RideNotification } from './ride-notify';
