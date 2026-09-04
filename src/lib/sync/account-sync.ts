/**
 * @fileoverview Bringing a whole account's trips together when somebody signs in.
 *
 * Until now a trip reached the server only when its owner opened the share
 * dialog, and a trip on the server reached a device only when somebody pressed
 * *Download*. That is enough for handing a trip to a friend, and not enough for
 * the thing people actually expect from an account: sign in on the phone and on
 * the laptop, and see the same trips on both.
 *
 * This module is the sweep that closes that gap. It runs for a signed-in
 * session, in both directions:
 *
 * - **Up** — every trip on this device that has never been uploaded gets a
 *   server row and its document, exactly as sharing would have done.
 * - **Down** — every trip on the account that is not on this device is
 *   materialised locally, exactly as pressing *Download* would have done.
 *
 * Phase 6 of `plans/2026-08-31-server-backed-trip-sync-v1.md` always meant this
 * to exist — "run lazily on first share **or first sign-in**, never as a
 * big-bang" — and only the share half was built.
 *
 * ## What it deliberately does not do
 *
 * **It never re-creates a server row.** `ensureRemoteTrip` repairs a
 * `remoteTripId` pointing at a row that has gone, which is right at share time,
 * with the owner at the keyboard and one trip in view. Run unattended across
 * every trip it is a hazard instead: a row this session merely *cannot see* —
 * a second account signed in on the same device — reads as absent, and
 * "repairing" it would fork the trip into a duplicate owned by the wrong
 * account. So a trip that already carries a `remoteTripId` is left entirely
 * alone here, and sharing stays the one place that reconciliation happens.
 *
 * **It never uploads the document of a trip it did not just link.** A joined
 * trip that has not been opened on this device yet has a *placeholder* Dexie
 * row — the server's preview, or `Untitled` — and no document at all. Pushing
 * that as CRDT state would write the placeholder name over the owner's real one
 * for everybody. Only a trip whose row this sweep created is uploaded, because
 * for that trip this device is by definition the only source there has ever
 * been.
 *
 * **It is additive, never subtractive.** A trip missing from the server is a
 * local-only trip, not a deletion to replay; a trip missing locally is a trip to
 * fetch, not one to remove from the account. Signing out leaves everything on
 * the device untouched.
 *
 * @module lib/sync/account-sync
 */

import type { TypedSupabaseClient } from '@/lib/supabase/client';

import { db } from '@/lib/db/database';
import { materialiseJoinedTrip } from './join-trip';
import { ensureRemoteTrip, listRemoteTripsMissingLocally } from './remote-trip';
import { uploadTripDocument } from './upload-document';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * What one sweep actually moved.
 *
 * Counts rather than `void`, for the same reason `syncRemoteTripMetadata`
 * reports its outcome: "nothing needed doing" and "everything failed" are very
 * different facts, and a sweep that quietly does neither is exactly the kind of
 * silence this feature cannot afford — its whole promise is that the other
 * device will have the trips.
 */
export interface AccountSyncResult {
  /** Local trips given a server row and pushed. */
  readonly uploaded: number;
  /** Server trips materialised onto this device. */
  readonly downloaded: number;
  /** Trips that could not be moved, in either direction. */
  readonly failed: number;
}

// ============================================================================
// Constants
// ============================================================================

const NOTHING: AccountSyncResult = { uploaded: 0, downloaded: 0, failed: 0 };

// ============================================================================
// Internals
// ============================================================================

/**
 * Uploads the trips on this device that have never been on the server.
 *
 * Sequential on purpose. A device with a dozen trips would otherwise open a
 * dozen concurrent upload chains over the connection that has just been proven
 * good enough to sign in on and nothing else — and the ordering makes a partial
 * sweep comprehensible: the trips that made it are the first ones.
 *
 * One trip failing never stops the rest. Going offline mid-sweep is the ordinary
 * way this ends, and the trips already up stay up.
 */
async function pushLocalTrips(
  client: TypedSupabaseClient,
  userId: string,
): Promise<AccountSyncResult> {
  // Read once, before any of the awaits below: `ensureRemoteTrip` writes
  // `remoteTripId` back to Dexie, so re-reading mid-sweep would be answering a
  // different question each time.
  const local = await db.trips.toArray();
  const neverUploaded = local.filter((trip) => trip.remoteTripId === undefined);

  let uploaded = 0;
  let failed = 0;

  for (const trip of neverUploaded) {
    const remote = await ensureRemoteTrip(client, userId, trip.id);
    if (remote.status !== 'ready') {
      // `unauthenticated` cannot happen here — both arguments are present.
      // `missing` means the trip was deleted while the sweep ran, and `error` is
      // usually the network going away. None is worth interrupting anybody for.
      failed += 1;
      continue;
    }

    // The row alone is not the trip. Without the document the other device
    // materialises a name and two dates and then waits on "Getting the trip…"
    // forever — the exact gap `upload-document` was written to close at share
    // time, and this is the second place that can open it.
    const pushed = await uploadTripDocument(client, trip.id, remote.remoteTripId);
    if (pushed.status === 'error') {
      failed += 1;
      continue;
    }
    uploaded += 1;
  }

  return { uploaded, downloaded: 0, failed };
}

/**
 * Materialises the account's trips that are not on this device.
 *
 * The same work the *Download* button does, for every trip at once. It stays a
 * button as well: this can only run while online, and somebody who signed in on
 * a train still needs a way in when the connection comes back.
 */
async function pullRemoteTrips(
  client: TypedSupabaseClient,
): Promise<AccountSyncResult> {
  const missing = await listRemoteTripsMissingLocally(client);

  let downloaded = 0;
  let failed = 0;

  for (const remote of missing) {
    const result = await materialiseJoinedTrip(client, remote.id);
    if (result.status === 'error') {
      failed += 1;
      continue;
    }
    // `already-local` is neither a download nor a failure: another tab, or the
    // *Download* button, got there first.
    if (result.status === 'joined') {
      downloaded += 1;
    }
  }

  return { uploaded: 0, downloaded, failed };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Brings this device and this account to the same set of trips.
 *
 * Idempotent and safe to call again: a second run finds nothing to push — every
 * trip carries a `remoteTripId` by then — and nothing to pull.
 *
 * Never throws. Every failure it can have is one the app is expected to survive
 * — offline, a row that vanished, a trip deleted mid-sweep — and none of them is
 * a reason to take the app down or to interrupt somebody who is editing.
 *
 * @param client - An authenticated Supabase client, or null with no backend
 * @param userId - The signed-in account, which owns anything uploaded here
 */
export async function syncAccountTrips(
  client: TypedSupabaseClient | null,
  userId: string | null,
): Promise<AccountSyncResult> {
  if (!client || !userId) {
    // Signed out, or a build with no backend. The ordinary local-only mode.
    return NOTHING;
  }

  try {
    // Up first. The trips already on this device are the ones the person can
    // see, so getting them onto the account is what makes the *other* device
    // useful — and doing it first leaves the pull below a settled picture of
    // what is already here.
    const pushed = await pushLocalTrips(client, userId);
    const pulled = await pullRemoteTrips(client);

    return {
      uploaded: pushed.uploaded,
      downloaded: pulled.downloaded,
      failed: pushed.failed + pulled.failed,
    };
  } catch (error: unknown) {
    // Belt and braces: everything above reports rather than throws, so reaching
    // here means Dexie itself failed.
    console.warn(
      '[sync] the account sweep did not finish:',
      error instanceof Error ? error.message : String(error),
    );
    return NOTHING;
  }
}
