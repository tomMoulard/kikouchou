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
 * @module lib/notifications/push
 */

import type { TypedSupabaseClient } from '@/lib/supabase/client';
import type { Json } from '@/lib/supabase/database.types';
import { mapInviteError } from '@/lib/sync/invites';
import type { Trip } from '@/types';

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
}

export interface EnableRemindersOptions {
  /** The guest this device is on the trip; decides which arrivals and rides are "yours". */
  readonly personId?: string | undefined;
  /** `en` or `fr`: the language the reminder is written in. */
  readonly locale: string;
  /** The PostHog distinct id, so server events land on the same person. */
  readonly analyticsId?: string | undefined;
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
      return parsed as StoredReminderSubscription;
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
  if (getNotificationState() === 'denied') {
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
  const publicKey = vapidPublicKey();
  if (!isPushSupported() || publicKey === undefined) {
    return { status: 'unsupported' };
  }
  if (trip.viewerToken === undefined && trip.remoteTripId === undefined) {
    // Nothing on the server knows this trip, so nothing can remind about it.
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
  const common = {
    // `PushSubscriptionJSON` is plain data — an endpoint, a time, two keys —
    // and that is what the function stores.
    subscription: payload as unknown as Json,
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
  if (typeof data !== 'string' || typeof payload.endpoint !== 'string') {
    return { status: 'error', message: 'unexpected reply' };
  }

  writeReminderSubscription(trip.id, {
    endpoint: payload.endpoint,
    subscriptionId: data,
    enabledAt: new Date().toISOString(),
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
  clearReminderSubscription(tripId);
  if (stored === undefined) {
    return true;
  }

  const { error } = await client.rpc('unsubscribe_reminders', { endpoint: stored.endpoint });

  if (!anyOtherTripSubscribed(tripId) && isPushSupported()) {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      await subscription?.unsubscribe();
    } catch {
      // The server row is what stops the reminders; the browser's copy is tidy-up.
    }
  }

  return !error;
}
