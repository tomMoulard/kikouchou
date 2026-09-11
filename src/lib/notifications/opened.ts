/**
 * @fileoverview Turns a notification click into one `notification_opened` event.
 *
 * ## Why the page and not the worker
 *
 * The click happens in `public/sw-notifications.js`, and a service worker is the
 * one context that cannot capture to PostHog: posthog-js lives in the page, with
 * the person id, the super properties and the queue. So the worker hands the
 * click to a document instead, by whichever of two routes fits (see that file):
 *
 * 1. **A query parameter** on the page it is about to load or navigate. Read
 *    here at import time, reported, and removed from the URL.
 * 2. **A message** to a document that is already showing the right page, which
 *    would otherwise have to be reloaded for the sake of one parameter.
 *
 * Both land on {@link reportNotificationOpened}, so the event is the same event
 * whichever way the click arrived.
 *
 * ## Why at import time
 *
 * Same reason as `lib/supabase/auth-callback`, which this follows: `router.tsx`
 * initialises history at module scope and the query string is not guaranteed to
 * survive it. `main.tsx` therefore imports this module directly, after
 * `lib/posthog` — which must have initialised first, or the capture goes
 * nowhere — and before `App.tsx` pulls the router in.
 *
 * A page-context notification never reaches the worker at all: `os-notification`
 * holds its own `onclick`, and that one calls {@link reportNotificationOpened}
 * itself.
 *
 * @module lib/notifications/opened
 */

import { captureEvent } from '@/lib/posthog';

// ============================================================================
// Constants
// ============================================================================

/**
 * The event, one per click, whatever the notification was.
 *
 * The kind is a property rather than part of the name so that "how many people
 * come back through a notification" stays one number, and "which notification
 * brings them back" stays one breakdown of it.
 */
const OPENED_EVENT = 'notification_opened';

/**
 * The query parameter the worker sets, and the message type it posts.
 *
 * Both are duplicated in `public/sw-notifications.js`, which is copied verbatim
 * into `dist` and so can import nothing from here. Changing either name means
 * changing it in both files, and a notification written by an older build can
 * still arrive with the old one — which is why an unreadable kind is reported as
 * `unknown` rather than dropped.
 */
const NOTIFICATION_PARAM = 'from_notification';

/** @see {@link NOTIFICATION_PARAM} */
const CLICK_MESSAGE_TYPE = 'notification-click';

/** The kind reported for a notification that carries none. */
const UNKNOWN_KIND = 'unknown';

/**
 * How long a kind is allowed to be before it is discarded.
 *
 * The value reaches us from a URL, so it is attacker-supplied in the same sense
 * every query parameter is: a link with `?from_notification=<10kB>` would
 * otherwise mint a property value of that size on the project's event schema.
 * Every real kind is under twenty characters.
 */
const MAX_KIND_LENGTH = 32;

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Reduces an arriving kind to something safe to send as a property.
 *
 * @param value - What the URL or the message carried
 * @returns The kind, or {@link UNKNOWN_KIND}
 */
function toKind(value: unknown): string {
  return typeof value === 'string' &&
    value !== '' &&
    value.length <= MAX_KIND_LENGTH
    ? value
    : UNKNOWN_KIND;
}

/**
 * Removes the parameter, preserving everything else on the URL.
 *
 * A notification lands on a real page — a trip's transports, a shared trip —
 * and that page may carry its own query string, so only this one key goes. It
 * goes at all because it is noise the moment it has been read: it would ride
 * along into every `$pageview` path, into anything the user copies out of the
 * address bar, and into a reload that would then count the click twice.
 */
function stripParam(params: URLSearchParams): void {
  params.delete(NOTIFICATION_PARAM);

  const query = params.toString();
  const next = `${window.location.pathname}${query.length > 0 ? `?${query}` : ''}${window.location.hash}`;

  try {
    window.history.replaceState(window.history.state, '', next);
  } catch {
    // Some embedded webviews refuse replaceState. The event is already
    // captured; the worst case is a spent parameter left in the bar.
  }
}

/**
 * Reports the click this document loaded from, if it loaded from one.
 *
 * Runs once, at import. Anything later would be racing the router.
 */
function reportFromUrl(): void {
  if (typeof window === 'undefined') {
    return;
  }

  let params: URLSearchParams;

  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return;
  }

  const value = params.get(NOTIFICATION_PARAM);

  if (value === null) {
    return;
  }

  reportNotificationOpened(toKind(value));
  stripParam(params);
}

/**
 * Listens for clicks the worker sends to this document rather than the URL.
 *
 * The listener lives for the life of the document on purpose: a notification
 * can be clicked at any point while a tab sits in the background, which is
 * precisely the case this route exists for.
 */
function listenForClicks(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  // This module is evaluated at import time by `main.tsx`, so a throw here
  // blanks the app. `serviceWorker` can be present and unusable — a webview
  // with a partial implementation, a test's stub — and one uncounted click is
  // not worth a white screen.
  if (typeof navigator.serviceWorker.addEventListener !== 'function') {
    return;
  }

  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    const data: unknown = event.data;

    if (
      typeof data !== 'object' ||
      data === null ||
      (data as { type?: unknown }).type !== CLICK_MESSAGE_TYPE
    ) {
      return;
    }

    reportNotificationOpened(toKind((data as { kind?: unknown }).kind));
  });
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Captures one click on one notification.
 *
 * Never throws, like everything else in `lib/notifications`: an analytics event
 * that fails is not worth breaking a page the user just asked to see. With no
 * PostHog client — a fresh clone, a fork's CI, a unit test — it is a no-op.
 *
 * @param kind - What the notification was about: `trip_start`, `own_arrival`,
 *   `pickup` from the server, `leave` or `moved` from a ride notice, `status`
 *   for an in-app confirmation, `unknown` for a notification older than the
 *   build that is reading it
 *
 * @example
 * ```ts
 * reportNotificationOpened('pickup');
 * ```
 */
export function reportNotificationOpened(kind: string): void {
  try {
    captureEvent(OPENED_EVENT, { kind });
  } catch (error) {
    console.warn('[notifications] could not report a notification click:', error);
  }
}

// ============================================================================
// Bootstrap
// ============================================================================

reportFromUrl();
listenForClicks();
