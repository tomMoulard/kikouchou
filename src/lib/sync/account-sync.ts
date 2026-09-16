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
import { downloadTripDocument } from './download-document';
import { materialiseJoinedTrip } from './join-trip';
import { ensureRemoteTrip, listRemoteTripsMissingLocally } from './remote-trip';
import { uploadTripDocument } from './upload-document';
import { upgradeViewerTrip } from './viewer';

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
  /** Viewer trips whose invite this account redeemed, now member trips. */
  readonly upgraded: number;
  /** Trips that could not be moved, in any direction. */
  readonly failed: number;
}

// ============================================================================
// Constants
// ============================================================================

const NOTHING: AccountSyncResult = { uploaded: 0, downloaded: 0, upgraded: 0, failed: 0 };

// ============================================================================
// Internals
// ============================================================================

/**
 * Redeems the invites behind the trips this device only *reads*.
 *
 * A viewer trip was opened from a link with no account. The moment there is
 * one, the same token joins the account to the trip, the trip stops being
 * read-only, and the sync provider takes over the document. This is the one
 * moment that transition can happen unattended, and it runs first: a trip that
 * is upgraded here is a member trip by the time the push half looks at it.
 *
 * A dead token — revoked, expired, spent — leaves the trip as it was: readable
 * and read-only. The card on the trip's pages says so and offers a retry.
 */
async function upgradeViewerTrips(
  client: TypedSupabaseClient,
  userId: string,
): Promise<AccountSyncResult> {
  const viewing = (await db.trips.toArray()).filter((trip) => trip.viewerToken !== undefined);

  let upgraded = 0;
  let failed = 0;

  for (const trip of viewing) {
    const result = await upgradeViewerTrip(client, userId, trip);
    if (result.status === 'upgraded') {
      upgraded += 1;
      continue;
    }
    if (result.status !== 'already-member') {
      failed += 1;
    }
  }

  return { uploaded: 0, downloaded: 0, upgraded, failed };
}

/**
 * Hydrates the trips that arrived as a row and never got their document.
 *
 * Every sweep before this one left placeholders behind, so a device that signed
 * in yesterday is already full of them and would stay that way: the pull half
 * only looks at trips that are *missing* locally, and a placeholder is not
 * missing. Without this pass the fix would only ever reach trips joined from
 * here on, and the list somebody is looking at right now would still need every
 * card opened by hand.
 *
 * Cheap enough to run every time. The only trips it considers are the ones with
 * no persisted document at all, `downloadTripDocument` re-checks that itself,
 * and one successful hydration takes a trip out of the set permanently.
 *
 * It runs before the push half on purpose: at this point a `remoteTripId` can
 * only have been written by an earlier session, so a trip this sweep is about to
 * upload is never downloaded back a moment later.
 */
async function hydratePlaceholderTrips(
  client: TypedSupabaseClient,
): Promise<AccountSyncResult> {
  const linked = (await db.trips.toArray()).filter(
    (trip) => trip.remoteTripId !== undefined,
  );

  let failed = 0;

  for (const trip of linked) {
    const held = await db.yjsUpdates.where('tripId').equals(trip.id).count();
    if (held > 0) {
      continue;
    }

    const result = await downloadTripDocument(
      client,
      trip.id,
      trip.remoteTripId as string,
    );
    if (result.status === 'error') {
      failed += 1;
    }
  }

  return { uploaded: 0, downloaded: 0, upgraded: 0, failed };
}

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

  return { uploaded, downloaded: 0, upgraded: 0, failed };
}

/**
 * Materialises the account's trips that are not on this device.
 *
 * The same work the *Download* button does, for every trip at once. It stays a
 * button as well: this can only run while online, and somebody who signed in on
 * a train still needs a way in when the connection comes back.
 *
 * The row is not the trip, which is the same thing the push half had to learn.
 * `materialiseJoinedTrip` writes a placeholder built from the server's preview —
 * a name and two dates — and everything the trip list actually shows on a card
 * lives in the document: the guests, the place, the coordinates behind the map.
 * Without the download below, signing in on a new device produced a list of
 * cards that each had to be opened, one at a time, before they showed anything.
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
    // *Download* button, got there first — and that tab is hydrating the trip.
    if (result.status !== 'joined') {
      continue;
    }

    downloaded += 1;

    // Counted as a failure, and the trip still stays: the row on its own is a
    // trip somebody can open to repair, which is where this was before, so the
    // count is the honest report of a half-finished download rather than a
    // reason to undo one.
    const hydrated = await downloadTripDocument(client, result.tripId, remote.id);
    if (hydrated.status === 'error') {
      failed += 1;
    }
  }

  return { uploaded: 0, downloaded, upgraded: 0, failed };
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
    // Viewer trips first: redeeming their invites is what turns them into
    // trips the account is actually on, so the pull below does not fetch a
    // second copy of a trip that is already here.
    const upgraded = await upgradeViewerTrips(client, userId);

    // Then the trips an earlier sweep left as a name and two dates, before the
    // push half can mistake an unopened placeholder for anything else.
    const repaired = await hydratePlaceholderTrips(client);

    // Then up. The trips already on this device are the ones the person can
    // see, so getting them onto the account is what makes the *other* device
    // useful — and doing it first leaves the pull below a settled picture of
    // what is already here.
    const pushed = await pushLocalTrips(client, userId);
    const pulled = await pullRemoteTrips(client);

    return {
      uploaded: pushed.uploaded,
      downloaded: pulled.downloaded,
      upgraded: upgraded.upgraded,
      failed: upgraded.failed + repaired.failed + pushed.failed + pulled.failed,
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
