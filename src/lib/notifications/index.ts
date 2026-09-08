/**
 * @fileoverview Barrel export for user feedback.
 *
 * @module lib/notifications
 */

export { notify } from './notify';
export { announceStatus, subscribeToStatus, type StatusListener } from './announcer';
export {
  showOsNotification,
  isOsNotificationSupported,
  osNotificationPermission,
} from './os-notification';
