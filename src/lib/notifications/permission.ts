/**
 * @fileoverview Whether this device may post an OS notification, and asking for it.
 *
 * Nothing here runs on load. `Notification.requestPermission()` is only ever
 * called from {@link requestNotificationPermission}, which the settings card
 * calls from a click — an unprompted permission dialog is how a PWA gets its
 * notifications denied forever, and `denied` is a state neither this module nor
 * any other part of the app can undo.
 *
 * @module lib/notifications/permission
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * The permission states, plus the one the DOM has no word for.
 *
 * `NotificationPermission` is `'default' | 'granted' | 'denied'` and assumes the
 * API exists. It does not exist on iOS Safari outside an installed PWA, in a
 * private window on some browsers, or in jsdom, and a UI that renders those as
 * "off" invites the user to press a button that can never work. `unsupported`
 * is a fourth answer so the card can say so instead.
 */
export const NOTIFICATION_STATES = [
  'unsupported',
  'default',
  'granted',
  'denied',
] as const;

/** One of {@link NOTIFICATION_STATES}. */
export type NotificationState = (typeof NOTIFICATION_STATES)[number];

// ============================================================================
// Reads
// ============================================================================

/**
 * Whether this browser exposes the Notification API at all.
 *
 * @returns True when `Notification` can be read
 */
export function isNotificationSupported(): boolean {
  return typeof globalThis.Notification !== 'undefined';
}

/**
 * Reads what this browser currently allows, without asking for anything.
 *
 * Safe to call during render: it touches no storage and shows no dialog.
 *
 * @returns The current state, `'unsupported'` when there is no API
 */
export function getNotificationState(): NotificationState {
  if (!isNotificationSupported()) {
    return 'unsupported';
  }

  // Read defensively: `permission` is a static getter, and a browser that ships
  // a stub `Notification` (some in-app webviews do) can return anything.
  const permission: unknown = globalThis.Notification.permission;

  if (permission === 'granted') {
    return 'granted';
  }

  if (permission === 'denied') {
    return 'denied';
  }

  return 'default';
}

// ============================================================================
// Writes
// ============================================================================

/**
 * Asks the user, once, and reports where that left things.
 *
 * Never called on load — see the module docblock. Never called when the answer
 * is already `denied` either: browsers reject that immediately and silently,
 * so a retry button would look like it did nothing. The card explains the
 * browser's own site settings instead.
 *
 * Never throws. A browser that refuses the request resolves to whatever the
 * permission reads as afterwards.
 *
 * **Racy on the pre-Promise callback form**, and deliberately left that way.
 * Older Safari and some in-app webviews return `undefined` here and answer
 * through a callback, so the `await` lands before the user has decided and the
 * card shows `default` for a moment after they pressed Allow. Racing a callback
 * would close that, at the price of hanging forever on a stub that implements
 * neither form — an enable button disabled for the life of the page, which is
 * worse than a label that is briefly stale. It corrects itself on the next
 * click or the card's `visibilitychange` re-read, and delivery is unaffected:
 * `notify` reads the live permission, not this return value.
 *
 * @returns The state as of this call returning
 */
export async function requestNotificationPermission(): Promise<NotificationState> {
  const current = getNotificationState();

  if (current !== 'default') {
    return current;
  }

  try {
    // Safari shipped only the callback form for years and returned `undefined`
    // from the call. Awaiting `undefined` is harmless, and the state is then
    // read back rather than taken from the return value — which is also what
    // makes a browser that resolves with something unexpected land somewhere
    // sensible.
    await globalThis.Notification.requestPermission();
  } catch (error) {
    // A refused request is not an app error: the user simply has no
    // notifications, which is the same outcome as declining the dialog.
    console.warn('[notifications] permission request failed:', error);
  }

  return getNotificationState();
}
