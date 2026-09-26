/**
 * @fileoverview Trip reminders over Web Push: turning them on, and off.
 *
 * A reminder is the one thing that brings somebody back to a trip they looked
 * at once. It reaches a closed app only through the browser's push service, so
 * this module subscribes this device through the service worker and hands the
 * subscription to the server (`subscribe_trip_reminders` for a viewer holding
 * an invite token, `subscribe_member_reminders` for a member), which is where
 * `server/share-preview` reads it back when something is due.
 *
 * Nothing here runs on load. `Notification.requestPermission()` is called from
 * {@link enableTripReminders} only, which the reminder card calls from a click:
 * an unprompted dialog is how notifications get denied forever.
 *
 * The device remembers what it asked for in `localStorage`, per trip: the
 * endpoint and the row id. That record is the card's "on"; the server's row is
 * the truth the sender uses. They can drift — a subscription the push service
 * dropped is pruned server-side — and the next `enable` simply re-subscribes.
 *
 * The store apps take the same two RPCs with a different subscription: an APNs
 * or FCM device token from `lib/notifications/native-push`, stored where a
 * browser's endpoint goes, so `unsubscribe_reminders` and the local record
 * work unchanged.
 *
 * @module lib/notifications/push
 */

import { db } from '@/lib/db/database';
import { isNativeApp } from '@/lib/platform';
import type { TypedSupabaseClient } from '@/lib/supabase/client';
import type { Json } from '@/lib/supabase/database.types';
import { mapInviteError } from '@/lib/sync/invites';
import type { Trip, TripId } from '@/types';

import {
  isNativePushAvailable,
  registerNativePush,
  unregisterNativePush,
} from './native-push';
import { getNotificationState, requestNotificationPermission } from './permission';

// ============================================================================
// Type Definitions
// ============================================================================

/** What the reminder card renders from. */
export type ReminderState =
  /** No push here: no service worker, no PushManager, or no VAPID key in the build. */
  | 'unsupported'
  /** Notifications are denied for this site; only the browser's settings undo it. */
  | 'blocked'
  | 'off'
  | 'on';

export type EnableRemindersResult =
  | { readonly status: 'enabled' }
  | { readonly status: 'unsupported' }
  | { readonly status: 'blocked' }
  /** The permission dialog was dismissed without an answer. */
  | { readonly status: 'dismissed' }
  /** The invite behind a viewer trip is dead; same reasons as joining. */
  | { readonly status: 'not-found' }
  | { readonly status: 'revoked' }
  | { readonly status: 'expired' }
  | { readonly status: 'exhausted' }
  | { readonly status: 'unauthenticated' }
  | { readonly status: 'not-a-member' }
  | { readonly status: 'error'; readonly message: string };

/** What the device remembers about one trip's reminders. */
export interface StoredReminderSubscription {
  readonly endpoint: string;
  readonly subscriptionId: string;
  readonly enabledAt: string;
  /**
   * The trip's server id, so turning the reminders off names the trip.
   *
   * One browser subscription serves every trip on the device, so an
   * `unsubscribe_reminders` call with the endpoint alone deletes every trip's
   * row for it. Absent on a record written before this field existed; the
   * caller then reads it from the trip row.
   */
  readonly remoteTripId?: string;
}

export interface EnableRemindersOptions {
  /** The guest this device is on the trip; decides which arrivals and rides are "yours". */
  readonly personId?: string | undefined;
  /** `en` or `fr`: the language the reminder is written in. */
  readonly locale: string;
  /** The PostHog distinct id, so server events land on the same person. */
  readonly analyticsId?: string | undefined;
  /**
   * The Android notification channel's name, translated: what the user sees
   * in the system settings next to the switch that silences reminders.
   */
  readonly channelName?: string | undefined;
}

// ============================================================================
// Constants
// ============================================================================

const STORAGE_PREFIX = 'kikouchou-reminders:';

/**
 * How long to wait for the service worker to be ready before deciding this
 * page has none. The dev server registers no worker at all, and `ready` there
 * never resolves.
 */
const WORKER_READY_TIMEOUT_MS = 5_000;

// ============================================================================
// Capability
// ============================================================================

/** The public VAPID key the build was given, or `undefined` when there is none. */
export function vapidPublicKey(): string | undefined {
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  return typeof key === 'string' && key.trim() !== '' ? key.trim() : undefined;
}

/**
 * Whether this browser could receive a push at all.
 *
 * False in an iPhone's Safari tab (only the Home Screen app has `PushManager`),
 * in jsdom, and in a build with no VAPID key.
 *
 * @returns True when subscribing could succeed
 */
export function isPushSupported(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  if (isNativeApp()) {
    return isNativePushAvailable();
  }
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    vapidPublicKey() !== undefined
  );
}

// ============================================================================
// Storage
// ============================================================================

function storageKey(tripId: string): string {
  return `${STORAGE_PREFIX}${tripId}`;
}

/**
 * What this device remembers asking for, for one trip.
 *
 * @param tripId - The local trip id
 * @returns The stored record, or undefined
 */
export function readReminderSubscription(tripId: string): StoredReminderSubscription | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  try {
    const raw = window.localStorage.getItem(storageKey(tripId));
    if (raw === null) {
      return undefined;
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { endpoint?: unknown }).endpoint === 'string' &&
      typeof (parsed as { subscriptionId?: unknown }).subscriptionId === 'string' &&
      typeof (parsed as { enabledAt?: unknown }).enabledAt === 'string'
    ) {
      const remoteTripId: unknown = (parsed as { remoteTripId?: unknown }).remoteTripId;
      return {
        ...(parsed as StoredReminderSubscription),
        ...(typeof remoteTripId === 'string' ? { remoteTripId } : {}),
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function writeReminderSubscription(tripId: string, record: StoredReminderSubscription): void {
  try {
    window.localStorage.setItem(storageKey(tripId), JSON.stringify(record));
  } catch {
    // Storage refused: the server has the row; the card just cannot show "on".
  }
}

function clearReminderSubscription(tripId: string): void {
  try {
    window.localStorage.removeItem(storageKey(tripId));
  } catch {
    // Nothing to do.
  }
}

/** Whether any other trip on this device still wants the push subscription. */
function anyOtherTripSubscribed(tripId: string): boolean {
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key !== null && key.startsWith(STORAGE_PREFIX) && key !== storageKey(tripId)) {
        return true;
      }
    }
  } catch {
    // Unreadable storage: keep the browser subscription, it costs nothing.
    return true;
  }
  return false;
}

// ============================================================================
// Reads
// ============================================================================

/**
 * What the reminder card shows for one trip, without asking for anything.
 *
 * @param tripId - The local trip id
 * @returns The state
 */
export function getReminderState(tripId: string): ReminderState {
  if (!isPushSupported()) {
    return 'unsupported';
  }
  // A store app's permission is the operating system's and can only be read
  // asynchronously; a refusal shows up as `blocked` when the user tries.
  if (!isNativeApp() && getNotificationState() === 'denied') {
    return 'blocked';
  }
  return readReminderSubscription(tripId) !== undefined ? 'on' : 'off';
}

// ============================================================================
// Internals
// ============================================================================

/**
 * `applicationServerKey` wants the raw key bytes; the build carries them as
 * base64url, the form every VAPID tool prints.
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const standard = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(standard);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

/** The worker registration, or undefined when this page has none in time. */
async function readyRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  const ready = navigator.serviceWorker.ready.then(
    (registration): ServiceWorkerRegistration | undefined => registration,
  );
  const timeout = new Promise<undefined>((resolve) => {
    setTimeout(() => {
      resolve(undefined);
    }, WORKER_READY_TIMEOUT_MS);
  });
  return Promise.race([ready, timeout]);
}

/** Subscribes this device with the push service, or reuses what it has. */
async function browserSubscription(
  registration: ServiceWorkerRegistration,
  publicKey: string,
): Promise<PushSubscription> {
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    return existing;
  }
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  });
}

function mapRpcError(error: {
  readonly message?: string;
  readonly hint?: string | null;
  readonly code?: string;
}): EnableRemindersResult {
  switch (error.hint) {
    case 'not_a_member':
      return { status: 'not-a-member' };
    case 'unauthenticated':
      return { status: 'unauthenticated' };
    default: {
      const mapped = mapInviteError(error);
      return mapped.status === 'joined'
        ? { status: 'error', message: error.message ?? 'unexpected reply' }
        : mapped;
    }
  }
}

// ============================================================================
// Writes
// ============================================================================

/**
 * Asks for permission, subscribes this device, and registers it for a trip.
 *
 * Call from a click. Never throws: every way it can fail is a status.
 *
 * @param client - The Supabase client
 * @param trip - The trip; a viewer trip registers through its token, a member
 *   trip through its server id
 * @param options - Who this device is, and in which language to be reminded
 * @returns What happened
 */
export async function enableTripReminders(
  client: TypedSupabaseClient,
  trip: Trip,
  options: EnableRemindersOptions,
): Promise<EnableRemindersResult> {
  if (trip.viewerToken === undefined && trip.remoteTripId === undefined) {
    // Nothing on the server knows this trip, so nothing can remind about it.
    return { status: 'unsupported' };
  }

  if (isNativeApp()) {
    const registration = await registerNativePush(options.channelName ?? 'Trip reminders');
    if (registration.status !== 'registered') {
      return registration;
    }
    return registerWithServer(client, trip, options, {
      endpoint: registration.subscription.token,
      subscription: registration.subscription as unknown as Json,
    });
  }

  const publicKey = vapidPublicKey();
  if (!isPushSupported() || publicKey === undefined) {
    return { status: 'unsupported' };
  }

  const permission = await requestNotificationPermission();
  if (permission === 'denied') {
    return { status: 'blocked' };
  }
  if (permission !== 'granted') {
    return { status: 'dismissed' };
  }

  let subscription: PushSubscription;
  try {
    const registration = await readyRegistration();
    if (registration === undefined) {
      return { status: 'unsupported' };
    }
    subscription = await browserSubscription(registration, publicKey);
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'push subscription failed',
    };
  }

  const payload = subscription.toJSON();
  if (typeof payload.endpoint !== 'string') {
    return { status: 'error', message: 'unexpected reply' };
  }
  return registerWithServer(client, trip, options, {
    endpoint: payload.endpoint,
    // `PushSubscriptionJSON` is plain data — an endpoint, a time, two keys —
    // and that is what the function stores.
    subscription: payload as unknown as Json,
  });
}

/**
 * Hands a subscription to the server and remembers it on this device.
 *
 * @param subscription.endpoint - The browser endpoint, or the device token
 * @param subscription.subscription - What `store_push_subscription` reads
 */
async function registerWithServer(
  client: TypedSupabaseClient,
  trip: Trip,
  options: EnableRemindersOptions,
  subscription: { readonly endpoint: string; readonly subscription: Json },
): Promise<EnableRemindersResult> {
  const common = {
    subscription: subscription.subscription,
    ...(options.personId !== undefined ? { person_id: options.personId } : {}),
    locale: options.locale.toLowerCase().startsWith('fr') ? 'fr' : 'en',
    ...(options.analyticsId !== undefined ? { analytics_id: options.analyticsId } : {}),
  };

  const { data, error } =
    trip.viewerToken !== undefined
      ? await client.rpc('subscribe_trip_reminders', {
          invite_token: trip.viewerToken,
          ...common,
        })
      : await client.rpc('subscribe_member_reminders', {
          trip: trip.remoteTripId as string,
          ...common,
        });

  if (error) {
    return mapRpcError(error);
  }
  if (typeof data !== 'string') {
    return { status: 'error', message: 'unexpected reply' };
  }

  writeReminderSubscription(trip.id, {
    endpoint: subscription.endpoint,
    subscriptionId: data,
    enabledAt: new Date().toISOString(),
    ...(trip.remoteTripId !== undefined ? { remoteTripId: trip.remoteTripId } : {}),
  });
  return { status: 'enabled' };
}

/**
 * Stops the reminders for one trip on this device.
 *
 * The browser subscription itself is dropped only when no other trip on this
 * device still uses it: one subscription serves them all.
 *
 * @param client - The Supabase client
 * @param tripId - The local trip id
 * @returns True when the server row is gone (or was never there)
 */
export async function disableTripReminders(
  client: TypedSupabaseClient,
  tripId: string,
): Promise<boolean> {
  const stored = readReminderSubscription(tripId);
  if (stored === undefined) {
    return true;
  }

  // Named, because the endpoint is shared. Every trip on this device rides the
  // one browser subscription, and the server keys its rows on
  // `(trip_id, endpoint)`: an endpoint-only call deleted every trip's row,
  // while the other trips' local records went on saying "on" and their cards
  // never offered the reminders again. A record from before the id was stored
  // falls back to the trip row; a trip the server does not know has no row to
  // name, and the endpoint alone is then all there is.
  const remoteTripId = stored.remoteTripId ?? (await db.trips.get(tripId as TripId))?.remoteTripId;
  const { error } = await client.rpc('unsubscribe_reminders', {
    endpoint: stored.endpoint,
    ...(remoteTripId !== undefined ? { trip: remoteTripId } : {}),
  });

  // Cleared only once the server has actually forgotten the endpoint.
  //
  // It used to be cleared first. The endpoint is the only handle on that
  // server row — the sender pushes to it, and `unsubscribe_reminders` takes it
  // as its whole argument — so a failed call destroyed the one thing needed to
  // try again, while the server went on delivering the trip's pickup places
  // and times to the device. There was no path back: the card read the local
  // record, found nothing, and showed the reminders as off.
  if (error) {
    return false;
  }

  clearReminderSubscription(tripId);

  if (!anyOtherTripSubscribed(tripId) && isNativeApp()) {
    await unregisterNativePush();
  } else if (!anyOtherTripSubscribed(tripId) && isPushSupported()) {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      await subscription?.unsubscribe();
    } catch {
      // The server row is what stops the reminders; the browser's copy is tidy-up.
    }
  }

  return true;
}
