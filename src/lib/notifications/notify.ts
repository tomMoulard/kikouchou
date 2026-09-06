/**
 * @fileoverview Posts one ride notice to the operating system, at most once.
 *
 * @module lib/notifications/notify
 */

import {
  getRideNotices,
  markNoticeFired,
  rideNoticeKey,
  type RideNoticeKind,
} from '@/lib/db';
import { getNotificationState } from '@/lib/notifications/permission';
import type { RideId, TransportId, TripId } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * The icon a notification carries.
 *
 * Built from Vite's `BASE_URL`, a build-time constant, rather than from
 * `window.location` — `lib/` never reads the location (AGENTS.md), and the app
 * is served from a sub-path on some deploys. A browser that will not render an
 * SVG here simply shows its own default; the notification still arrives.
 */
const NOTIFICATION_ICON = `${import.meta.env.BASE_URL}icons/icon.svg`;

// ============================================================================
// Type Definitions
// ============================================================================

/** One notice to announce on this device. */
export interface RideNotification {
  /** The trip the subject belongs to; also what scopes the dedupe read. */
  readonly tripId: TripId;
  /** What the notice is about — `'leave'` or `'moved'`. */
  readonly kind: RideNoticeKind;
  /** The ride or leg it concerns. */
  readonly subjectId: RideId | TransportId;
  /**
   * The heading, already translated.
   *
   * Translation is the caller's job on purpose: `t()` needs the React i18next
   * instance, and a `lib/` module reaching for a global one would give the
   * service-worker-adjacent code a second source of truth for the language.
   */
  readonly title: string;
  /** The body, already translated. */
  readonly body: string;
  /**
   * Where a tap should land, **relative to the app's base** and without a
   * leading slash — `trips/<id>/transports`, never `/trips/<id>/transports`.
   *
   * Defaults to the trip's transport list. The click handler resolves this
   * against the service worker's registration scope, so a leading slash would
   * escape a sub-path deploy and open the host root; one is stripped here
   * rather than trusted.
   */
  readonly path?: string;
}

/**
 * The part of `ServiceWorkerRegistration` this module uses.
 *
 * Narrowed so the caller can be tested without a service worker, which jsdom
 * has no implementation of — same shape as `lib/pwa/update-check`.
 */
interface NotifyingRegistration {
  readonly showNotification: (
    title: string,
    options?: NotificationOptions,
  ) => Promise<void>;
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Finds the registration to post through, or `undefined` when there is none.
 *
 * `navigator.serviceWorker.ready` is deliberately not used: it never settles
 * when nothing is registered, which would leave a caller awaiting forever on
 * every desktop browser that has not installed the worker yet.
 *
 * @returns The active registration, when it can show notifications
 */
async function findRegistration(): Promise<NotifyingRegistration | undefined> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return undefined;
  }

  const registration = await navigator.serviceWorker.getRegistration();

  return typeof registration?.showNotification === 'function'
    ? registration
    : undefined;
}

/**
 * Reduces a path to plain relative segments.
 *
 * The click handler resolves this against the worker's registration scope, so
 * a leading slash or a `..` segment would escape a sub-path deploy and open the
 * host root — the wrong page, and not one this app controls. Empty and `.`
 * segments go with them, which also collapses a doubled slash.
 *
 * The handler re-checks the resolved URL against its own scope rather than
 * trusting this, because it is the side that has to: `data.url` reaches it from
 * a stored notification, and a notification can outlive the build that wrote it.
 *
 * @param path - A path relative to the app's base
 * @returns The same path with nothing that could escape the base
 */
function toAppRelative(path: string): string {
  return path
    .split('/')
    .filter(
      (segment) => segment !== '' && segment !== '.' && segment !== '..',
    )
    .join('/');
}

// ============================================================================
// Delivery
// ============================================================================

/**
 * Announces a ride notice on this device, unless it already has.
 *
 * Silent by design in four normal situations, none of which is an error:
 *
 * 1. the browser has no Notification API (see `permission.ts`);
 * 2. permission is `default` or `denied` — nobody has opted in, or they opted
 *    out, and this is not the place to ask;
 * 3. no service worker has registered yet — a first load, or a context that
 *    installs none;
 * 4. `markNoticeFired` already recorded this notice on this device.
 *
 * The fourth is the load-bearing one. Without it "leave now" would be announced
 * on every clock tick, every tab focus and every re-render for as long as the
 * ride stayed due. The record is device-local (`rideNotices` never syncs), so
 * two phones each get told once rather than the first one silencing the second.
 *
 * A `moved` notice can legitimately fire again: `markTransportSeen` writes a
 * fresh row when the user acknowledges the change, which drops `firedAtMs`, so
 * the *next* time that passenger moves their time this device speaks again.
 *
 * Never throws. Anything unexpected — a rejected `showNotification`, a Dexie
 * error — is logged and reported as "not announced", the same rule `lib/posthog`
 * follows: a notification that fails is not worth an error boundary.
 *
 * @param notification - The notice to announce
 * @returns True when a notification was actually posted
 *
 * @example
 * ```ts
 * // `title` and `body` arrive translated; the caller owns those keys, and owns
 * // adding them to *both* locales — a key that does not exist still renders.
 * await notify({
 *   tripId,
 *   kind: 'leave',
 *   subjectId: ride.id,
 *   title: t('rides.leaveAt', { time }),
 *   body: t('rides.meetAt', { time: meetTime }),
 * });
 * ```
 */
export async function notify(notification: RideNotification): Promise<boolean> {
  const { tripId, kind, subjectId, title, body, path } = notification;

  try {
    if (getNotificationState() !== 'granted') {
      return false;
    }

    const registration = await findRegistration();

    if (registration === undefined) {
      return false;
    }

    const key = rideNoticeKey(kind, subjectId),
      notices = await getRideNotices(tripId);

    if (notices.get(key)?.firedAtMs !== undefined) {
      return false;
    }

    await registration.showNotification(title, {
      body,
      // The notice key doubles as the tag, so a second post for the same ride
      // replaces the banner rather than stacking a duplicate beside it.
      tag: key,
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_ICON,
      data: { url: toAppRelative(path ?? `trips/${tripId}/transports`) },
    });

    // Written after the post, not before: a `showNotification` that rejects
    // must stay retryable, and the tag above means a duplicate posted by a
    // racing caller collapses into one banner anyway.
    await markNoticeFired(tripId, kind, subjectId, Date.now());

    return true;
  } catch (error) {
    console.warn('[notifications] could not announce a ride notice:', error);

    return false;
  }
}
