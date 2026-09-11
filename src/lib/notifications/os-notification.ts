/**
 * @fileoverview Delivers the app's confirmations as operating system
 * notifications instead of in-page cards.
 *
 * Every confirmation used to be a sonner toast, and toasts are fixed overlays
 * anchored to the bottom of the screen: three room creations in a row left
 * three stacked cards over the content, and on a phone they sat on top of the
 * nav bar and the FAB (`AGENTS.md`, "A fixed overlay eats every tap
 * underneath it"). The operating system already owns a surface for transient
 * confirmations that does not compete with the page for space or for taps, so
 * confirmations go there.
 *
 * Three platform facts shape the code below, and each one is why a line looks
 * the way it does rather than simpler:
 *
 * 1. `Notification.requestPermission()` needs user activation in Safari, so
 *    the request rides on the click that saved something. It is also asked at
 *    most once per session — {@link permissionRequest} holds the in-flight
 *    promise, because two saves in the same tick would otherwise open two
 *    prompts.
 * 2. `new Notification()` throws `TypeError: Illegal constructor` on Android
 *    Chrome, where a notification may only come from a service worker. The
 *    constructor is still tried first, because a page-context notification can
 *    carry an `onclick` that focuses the tab, which a worker notification
 *    cannot without a `notificationclick` handler in the worker.
 * 3. Nothing here is guaranteed. Notifications are unsupported in a browser
 *    without the API, denied by choice, and on iOS granted only to an
 *    installed PWA. Every function therefore reports whether delivery
 *    happened, and no caller treats a `false` as an error.
 *
 * @module lib/notifications/os-notification
 */

import { reportNotificationOpened } from '@/lib/notifications/opened';

// ============================================================================
// Constants
// ============================================================================

/**
 * The product name, used as every notification's title.
 *
 * Not a translation key: it is the same word in both locales, and this module
 * runs outside React, where `t` is not in reach.
 */
const APP_NAME = 'Kikouchou';

/**
 * The one tag every confirmation carries, so a new one *replaces* the last.
 *
 * This is the piling-up fix restated at the OS level. These messages are
 * transient status ("Room created successfully"), they are read at a glance or
 * not at all, and a queue of five of them in the notification shade is the
 * same defect the stacked toasts were. One slot, latest wins.
 */
const NOTIFICATION_TAG = 'kikouchou-status';

/**
 * How long a confirmation stays up before the app withdraws it.
 *
 * A toast dismissed itself; an OS notification does not, and a permanent
 * "Room created successfully" in the shade would be litter. Roughly sonner's
 * own four seconds plus room to notice it.
 */
const AUTO_DISMISS_MS = 6_000;

/**
 * What a click on a confirmation reports.
 *
 * One name for all of them: a confirmation is "the thing you just did worked",
 * and which save it followed says nothing a click can be read for. It exists so
 * that confirmations are separable from the reminders that are meant to bring
 * somebody back — those carry their own kind (`pickup`, `leave`, …), and mixing
 * the two would let a save inflate the number that measures reminders.
 */
const NOTIFICATION_KIND = 'status';

// ============================================================================
// Module State
// ============================================================================

/**
 * The in-flight permission request, if one is open.
 *
 * Shared so that N confirmations in the same moment produce one prompt.
 */
let permissionRequest: Promise<NotificationPermission> | null = null;

// ============================================================================
// Capability
// ============================================================================

/**
 * Whether this browser has the Notification API at all.
 *
 * False in jsdom and in Firefox for Android, among others.
 */
export function isOsNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/**
 * The current permission, without asking for it.
 *
 * `'denied'` stands in for "no API here", so callers have one value to test.
 */
export function osNotificationPermission(): NotificationPermission {
  return isOsNotificationSupported() ? Notification.permission : 'denied';
}

// ============================================================================
// Permission
// ============================================================================

/**
 * Returns the permission, asking the user for it the first time.
 *
 * Safari's `requestPermission` predates promises and answers through a
 * callback, returning `undefined`; reading `Notification.permission` back
 * afterwards covers both shapes.
 */
async function ensurePermission(): Promise<NotificationPermission> {
  const current = osNotificationPermission();
  if (current !== 'default') {
    return current;
  }

  permissionRequest ??= (async (): Promise<NotificationPermission> => {
    try {
      await Notification.requestPermission();
    } catch (error) {
      // A browser that refuses the request — no user activation left, or a
      // permissions policy — is not a broken app. It is one without
      // notifications.
      console.error('[notifications] permission request failed:', error);
    }
    return osNotificationPermission();
  })();

  return permissionRequest;
}

// ============================================================================
// Delivery
// ============================================================================

/** The notification options both delivery paths share. */
function notificationOptions(body: string): NotificationOptions {
  return {
    body,
    tag: NOTIFICATION_TAG,
    icon: `${import.meta.env.BASE_URL}icons/icon.svg`,
    // These are confirmations of something the user just did. They do not need
    // a sound each time, and on a phone a chime per save would be its own bug.
    silent: true,
    // Read by the worker's `notificationclick` handler, which is what reports a
    // click on the service-worker-delivered copy. The page-delivered copy has
    // its own `onclick` below.
    data: { kind: NOTIFICATION_KIND },
  };
}

/**
 * Delivers through the page, and focuses the tab when the user clicks it.
 *
 * @returns `false` when the constructor is unavailable (Android Chrome).
 */
function deliverFromPage(body: string): boolean {
  try {
    const notification = new Notification(APP_NAME, notificationOptions(body));
    notification.onclick = (): void => {
      // This copy never reaches the worker, so nothing else would count it.
      reportNotificationOpened(NOTIFICATION_KIND);
      window.focus();
      notification.close();
    };
    window.setTimeout(() => notification.close(), AUTO_DISMISS_MS);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delivers through the service worker, the only route Android Chrome allows.
 *
 * Withdrawal has to go back through the registration: `showNotification`
 * returns nothing to hold on to, so the timer re-finds the notification by its
 * tag. Anything already gone — dismissed by the user, replaced by a newer
 * confirmation — simply is not in that list.
 */
async function deliverFromServiceWorker(body: string): Promise<boolean> {
  const registration = await navigator.serviceWorker?.getRegistration();
  if (!registration) {
    return false;
  }

  try {
    await registration.showNotification(APP_NAME, notificationOptions(body));
  } catch (error) {
    console.error('[notifications] service worker delivery failed:', error);
    return false;
  }

  window.setTimeout(() => {
    void registration
      .getNotifications({ tag: NOTIFICATION_TAG })
      .then((open) => {
        for (const notification of open) {
          notification.close();
        }
      })
      .catch(() => {
        // Withdrawal is a courtesy; a failure here leaves a stale card in the
        // shade and nothing else.
      });
  }, AUTO_DISMISS_MS);

  return true;
}

/**
 * Shows one confirmation, asking for permission if it has never been asked.
 *
 * @param body - The message, already translated.
 * @returns Whether the notification reached the operating system.
 *
 * @example
 * ```ts
 * const shown = await showOsNotification('Room created successfully');
 * ```
 */
export async function showOsNotification(body: string): Promise<boolean> {
  if (!isOsNotificationSupported()) {
    return false;
  }

  const permission = await ensurePermission();
  if (permission !== 'granted') {
    return false;
  }

  return deliverFromPage(body) || (await deliverFromServiceWorker(body));
}
