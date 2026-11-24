/**
 * @fileoverview Asking the push server to tell the people a change is about.
 *
 * An invitation to an activity and a money line someone is on are told at
 * once, not on the server's hourly sweep: the device that made the change asks
 * `POST <share origin>/push/notify` (`server/share-preview`, `notify.rs`).
 * The server reads who to tell from the trip's shared document, so the ask
 * only works once the change is there. This module therefore queues the ask,
 * in localStorage so it survives being offline and a restart, and sends it:
 *
 * - when the trip's sync reports everything sent (`useTripNotificationFlush`);
 * - a moment after it was queued, in case that report came and went;
 * - again, with a growing delay, while the server answers "not yet".
 *
 * Only a shared trip, opened by a member, has anybody else to tell, and only a
 * build that knows the push server (`VITE_SHARE_ORIGIN`) can ask it. The ask
 * names the change and nothing else: no guest, no title, no amount.
 *
 * @module lib/notifications/trip-notify
 */

import { getSupabaseClient } from '@/lib/supabase/client';
import type { Trip } from '@/types';

// ============================================================================
// Types
// ============================================================================

/** The two changes worth telling at once. */
export type TripNotificationKind = 'activity_invite' | 'money_line';

/** What to tell about: the change, by its kind and its id in the document. */
export interface TripNotificationRequest {
  readonly kind: TripNotificationKind;
  /** The activity's or the money line's id. */
  readonly subjectId: string;
}

interface QueuedNotification extends TripNotificationRequest {
  /** This ask, apart from an equal one queued later while it was in flight. */
  readonly id: string;
  /** `trips.id` on the server. */
  readonly remoteTripId: string;
  /** How many times the server said "not yet". */
  readonly attempts: number;
}

/** Everything a flush reads from outside, for tests that have none of it. */
export interface FlushDeps {
  readonly origin?: string;
  readonly fetch?: typeof fetch;
  readonly readToken?: () => Promise<string | null>;
  readonly storage?: Storage | null;
}

// ============================================================================
// Constants
// ============================================================================

/** Where the queue lives between launches. */
export const TRIP_NOTIFY_QUEUE_KEY = 'kikouchou-trip-notify-queue';

/** "Not yet" this many times, and the change is taken to be gone. */
const MAX_ATTEMPTS = 8;

/** A queue past this many asks drops the oldest: a device offline for weeks. */
const MAX_QUEUE = 100;

/** The delay before the first try, and the base of the backoff. */
const FIRST_TRY_MS = 2000;

/** The longest wait between two tries. */
const MAX_DELAY_MS = 60_000;

// ============================================================================
// Queue
// ============================================================================

function defaultStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readQueue(storage: Storage | null): QueuedNotification[] {
  if (!storage) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(storage.getItem(TRIP_NOTIFY_QUEUE_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is QueuedNotification =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as QueuedNotification).id === 'string' &&
            typeof (item as QueuedNotification).remoteTripId === 'string' &&
            typeof (item as QueuedNotification).subjectId === 'string' &&
            ((item as QueuedNotification).kind === 'activity_invite' ||
              (item as QueuedNotification).kind === 'money_line') &&
            typeof (item as QueuedNotification).attempts === 'number',
        )
      : [];
  } catch {
    return [];
  }
}

function writeQueue(storage: Storage | null, queue: readonly QueuedNotification[]): void {
  if (!storage) {
    return;
  }
  try {
    if (queue.length === 0) {
      storage.removeItem(TRIP_NOTIFY_QUEUE_KEY);
    } else {
      storage.setItem(TRIP_NOTIFY_QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)));
    }
  } catch {
    // A full or blocked storage costs the notification, never the change.
  }
}

function sameAsk(a: QueuedNotification, b: QueuedNotification): boolean {
  return a.remoteTripId === b.remoteTripId && a.kind === b.kind && a.subjectId === b.subjectId;
}

/** The signed-in session's access token, refreshed by supabase-js if due. */
async function readAccessToken(): Promise<string | null> {
  const client = await getSupabaseClient();
  if (client === null) {
    return null;
  }
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

/** A fresh id for one ask. */
function askId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ============================================================================
// Scheduling
// ============================================================================

let timer: ReturnType<typeof setTimeout> | undefined;
let flushing: Promise<void> | undefined;

/** Runs a flush after `delay`, replacing a later one already planned. */
function scheduleFlush(delay: number): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (timer !== undefined) {
    clearTimeout(timer);
  }
  timer = setTimeout(() => {
    timer = undefined;
    void flushTripNotifications();
  }, delay);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Queues an ask to tell the people a change is about, and sends it soon.
 *
 * Does nothing for a trip that is not shared, a viewer trip (read-only, so it
 * changes nothing), or a build without the push server.
 *
 * @param trip - The trip the change was made on
 * @param request - The change
 */
export function requestTripNotification(
  trip: Pick<Trip, 'remoteTripId' | 'viewerToken'>,
  request: TripNotificationRequest,
): void {
  const origin = import.meta.env.VITE_SHARE_ORIGIN ?? '';
  if (!trip.remoteTripId || trip.viewerToken !== undefined || origin === '') {
    return;
  }
  const storage = defaultStorage();
  const ask: QueuedNotification = {
    ...request,
    id: askId(),
    remoteTripId: trip.remoteTripId,
    attempts: 0,
  };
  // The same change asked twice is one ask: a line saved twice before either
  // left is one version to tell about, and the server reads the latest.
  writeQueue(storage, [...readQueue(storage).filter((item) => !sameAsk(item, ask)), ask]);
  scheduleFlush(FIRST_TRY_MS);
}

/**
 * Sends every queued ask the server can answer now.
 *
 * An ask leaves the queue once the server has answered it for good: told, or
 * refused. "Not yet" keeps it for a later try, and so do a network failure and
 * a device with nobody signed in.
 *
 * @param deps - What to read from outside; the real ones by default
 */
export function flushTripNotifications(deps: FlushDeps = {}): Promise<void> {
  flushing ??= runFlush(deps).finally(() => {
    flushing = undefined;
  });
  return flushing;
}

async function runFlush(deps: FlushDeps): Promise<void> {
  const origin = (deps.origin ?? import.meta.env.VITE_SHARE_ORIGIN ?? '').replace(/\/+$/, '');
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  const send = deps.fetch ?? (typeof fetch === 'undefined' ? undefined : fetch.bind(globalThis));
  const queue = readQueue(storage);
  if (origin === '' || queue.length === 0 || !send) {
    return;
  }

  const token = await (deps.readToken ?? readAccessToken)();
  if (!token) {
    // Signed out: kept until somebody signs in on this device.
    return;
  }

  let retry = false;
  const kept: QueuedNotification[] = [];
  for (const ask of queue) {
    let status: number;
    try {
      const response = await send(`${origin}/push/notify`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ trip_id: ask.remoteTripId, kind: ask.kind, subject_id: ask.subjectId }),
      });
      status = response.status;
    } catch {
      // Offline, or the server is down: try again later, unchanged.
      kept.push(ask);
      retry = true;
      continue;
    }

    if (status === 409 && ask.attempts + 1 < MAX_ATTEMPTS) {
      kept.push({ ...ask, attempts: ask.attempts + 1 });
      retry = true;
    } else if (status >= 500) {
      kept.push(ask);
      retry = true;
    }
    // Anything else is final: told (200), refused (4xx), or never coming (409
    // too often).
  }

  // Asks queued while this flush ran are kept as they are, and replace a kept
  // ask for the same change: the newer one names the newer version.
  const latest = readQueue(storage);
  const added = latest.filter((item) => !queue.some((sent) => sent.id === item.id));
  const stillKept = kept.filter((ask) => !added.some((item) => sameAsk(item, ask)));
  writeQueue(storage, [...stillKept, ...added]);

  if (retry || added.length > 0) {
    const attempts = Math.max(0, ...stillKept.map((ask) => ask.attempts));
    scheduleFlush(Math.min(MAX_DELAY_MS, FIRST_TRY_MS * 2 ** attempts));
  }
}
