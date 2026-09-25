/**
 * @fileoverview Reading a shared trip through its invite link, with no account.
 *
 * The invite link used to lead to a wall — "Create an account so the others can
 * see your room" — and most invitees who hit it left. Nothing about *reading* a
 * trip needs an account: every write policy names `auth.uid()`, no read does.
 * So a link now opens the trip for anyone holding it, and the account is asked
 * for at the first edit instead.
 *
 * The server side is one `security definer` function, `read_shared_trip`,
 * which is the only thing `anon` may execute (see the migration for the
 * decision and its limits). This module is the client side of it, in three
 * moments:
 *
 * 1. {@link materialiseViewerTrip} — the invite link is opened. The trip is
 *    fetched, a local row is created with `viewerToken` set, and the document
 *    is projected into Dexie so every page renders it like any other trip.
 * 2. {@link refreshViewerTrip} — the trip is open. Pulled again from the
 *    cursor on focus and on reconnect, into the live document, so what the
 *    viewer sees follows the members' edits.
 * 3. {@link upgradeViewerTrip} — the viewer signs in. The same token is
 *    redeemed, `viewerToken` clears, and the trip becomes an ordinary member
 *    trip that the sync provider takes over.
 *
 * ## What a viewer trip must never do
 *
 * Write into its document. The document is the server's, replayed; a viewer
 * has no account to send edits under, so any local write would sit in the
 * document unsent — and the day the viewer signs in, `reconcile()` would push
 * it over whatever the members wrote in between. `YjsSyncObserver` therefore
 * skips every Dexie → document effect for a viewer trip, and every refresh
 * here ends by projecting the document back over Dexie, so a stray local row
 * is overwritten rather than kept.
 *
 * ## Untrusted input
 *
 * The payload is remote-supplied by the same standard as a member's pull: the
 * trip is resolved locally by its server id and that local id is the only write
 * key, every field is bounded on the way in, and a row that will not decode is
 * dropped on its own rather than failing the batch.
 *
 * @module lib/sync/viewer
 */

import type { TypedSupabaseClient } from '@/lib/supabase/client';
import { nanoid } from 'nanoid';
import * as Y from 'yjs';

import { db } from '@/lib/db/database';
import { toISODateStringFromString } from '@/lib/db/utils';
import { cacheClaimedPersonId } from '@/lib/identity/trip-identity';
import { getTripGuestPersonId } from '@/lib/sharing/guest-identity';
import { loadPersistedUpdates, syncDocToDexie } from '@/lib/yjs/dexie-bridge';
import type { ShareId, Trip, TripId, UnixTimestamp } from '@/types';

import { decodeUpdate } from './codec';
import { advanceCursor, readCursor, recordServerState } from './cursors';
import { mapInviteError, redeemInvite } from './invites';
import { claimParticipant, sanitisePreview, type RemoteTripPreview } from './join-trip';
import { ORIGIN_REMOTE } from './SupabaseYjsProvider';

// ============================================================================
// Type Definitions
// ============================================================================

/** One log row, as `read_shared_trip` returns it. */
export interface SharedTripUpdate {
  readonly id: number;
  /** Base64 of one Yjs update. */
  readonly update: string;
}

/** What `read_shared_trip` returns, bounded and renamed for the client. */
export interface SharedTripPayload {
  readonly trip: RemoteTripPreview & {
    /** Server `trips.id`. */
    readonly id: string;
  };
  /** The compacted head, when it folds rows past the caller's cursor. */
  readonly snapshot: { readonly state: string; readonly throughId: number } | null;
  /** Log rows after the cursor (or after the snapshot), ascending. */
  readonly updates: readonly SharedTripUpdate[];
  /** Whether another page is waiting after the last row here. */
  readonly hasMore: boolean;
}

/** Why a token opens nothing. The same four reasons `redeem_invite` gives. */
export type InviteRejection = 'not-found' | 'revoked' | 'expired' | 'exhausted';

export type ReadSharedTripResult =
  | { readonly status: 'ok'; readonly payload: SharedTripPayload }
  | { readonly status: InviteRejection }
  | { readonly status: 'error'; readonly message: string };

export type ViewerTripResult =
  /** The trip is on this device, read through the token. */
  | { readonly status: 'viewing'; readonly tripId: TripId }
  /** Already here as a member trip — this device joined it with an account. */
  | { readonly status: 'member'; readonly tripId: TripId }
  | { readonly status: InviteRejection }
  | { readonly status: 'error'; readonly message: string };

export type ViewerRefreshResult =
  | { readonly status: 'updated' | 'current' }
  | { readonly status: InviteRejection }
  | { readonly status: 'error'; readonly message: string };

export type ViewerUpgradeResult =
  | { readonly status: 'upgraded' }
  /** Nothing to do: the trip was not a viewer trip. */
  | { readonly status: 'already-member' }
  | { readonly status: InviteRejection | 'unauthenticated' }
  | { readonly status: 'error'; readonly message: string };

// ============================================================================
// Constants
// ============================================================================

/**
 * Pages a single refresh will fetch before giving up.
 *
 * A bound rather than a loop on `has_more` alone, so a server that kept saying
 * "more" could not hold a device in a loop. Fifty pages of 500 rows is far past
 * any trip's log, and the next refresh picks up where this one stopped.
 */
const MAX_PAGES_PER_REFRESH = 50;

/** The encoding of an update carrying no changes, measured rather than assumed. */
const EMPTY_UPDATE = Y.encodeStateAsUpdate(new Y.Doc());

// ============================================================================
// Reading
// ============================================================================

/**
 * Calls `read_shared_trip` and bounds what comes back.
 *
 * Works signed out — that is the whole point — and signed in alike: the
 * function authorises the caller with the token, not with a session.
 *
 * @param client - A Supabase client, with or without a session
 * @param token - The invite token from the link
 * @param afterId - The highest log id already applied on this device
 */
export async function readSharedTrip(
  client: TypedSupabaseClient,
  token: string,
  afterId = 0,
): Promise<ReadSharedTripResult> {
  try {
    const { data, error } = await client.rpc('read_shared_trip', {
      invite_token: token,
      after_id: afterId,
    });

    if (error) {
      const mapped = mapInviteError(error);
      // `read_shared_trip` never asks for a session, so `unauthenticated` here
      // is a server that is not the one this client was built for.
      if (mapped.status === 'unauthenticated' || mapped.status === 'joined') {
        return { status: 'error', message: error.message ?? 'unexpected answer' };
      }
      return mapped;
    }

    const payload = parsePayload(data);
    if (payload === null) {
      return { status: 'error', message: 'the server answered with something unreadable' };
    }
    return { status: 'ok', payload };
  } catch (error: unknown) {
    // Offline: the fetch rejects rather than returning an error.
    return { status: 'error', message: toMessage(error) };
  }
}

/**
 * Bounds the function's answer before anything acts on it.
 *
 * Returns `null` for a payload with no usable trip in it, which the caller
 * reports as an error. A malformed *row* is dropped on its own; a malformed
 * snapshot is dropped and the log is read instead — the same tolerance the
 * member pull has, applied at the boundary rather than at each use.
 */
function parsePayload(data: unknown): SharedTripPayload | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const record = data as Record<string, unknown>;

  const tripRaw = record.trip;
  if (typeof tripRaw !== 'object' || tripRaw === null) {
    return null;
  }
  const trip = tripRaw as Record<string, unknown>;
  const id = trip.id;
  if (typeof id !== 'string' || id.length === 0 || id.length > 64) {
    return null;
  }

  const preview = sanitisePreview({
    name: typeof trip.name === 'string' ? trip.name : '',
    startDate: typeof trip.start_date === 'string' ? trip.start_date : '',
    endDate: typeof trip.end_date === 'string' ? trip.end_date : '',
  });

  let snapshot: SharedTripPayload['snapshot'] = null;
  const snapshotRaw = record.snapshot;
  if (typeof snapshotRaw === 'object' && snapshotRaw !== null) {
    const candidate = snapshotRaw as Record<string, unknown>;
    if (
      typeof candidate.state === 'string' &&
      candidate.state.length > 0 &&
      typeof candidate.through_id === 'number' &&
      Number.isFinite(candidate.through_id)
    ) {
      snapshot = { state: candidate.state, throughId: candidate.through_id };
    }
  }

  const updates: SharedTripUpdate[] = [];
  if (Array.isArray(record.updates)) {
    for (const rowRaw of record.updates) {
      if (typeof rowRaw !== 'object' || rowRaw === null) {
        continue;
      }
      const row = rowRaw as Record<string, unknown>;
      if (
        typeof row.id === 'number' &&
        Number.isFinite(row.id) &&
        row.id > 0 &&
        typeof row.update === 'string' &&
        row.update.length > 0
      ) {
        updates.push({ id: row.id, update: row.update });
      }
    }
  }

  return {
    trip: { id, ...preview },
    snapshot,
    updates,
    hasMore: record.has_more === true,
  };
}

// ============================================================================
// Applying
// ============================================================================

interface AppliedPage {
  /** The highest log id the page carried, or 0 when it carried nothing. */
  readonly highest: number;
  /** The snapshot was present and did not decode: the rows alone are not the trip. */
  readonly snapshotFailed: boolean;
}

/**
 * Applies one page into a document, as the server's own writes.
 *
 * `ORIGIN_REMOTE` on the transaction is what keeps these updates from being
 * treated as local edits by anything watching the document.
 */
function applyPage(doc: Y.Doc, page: SharedTripPayload): AppliedPage {
  let highest = 0;
  let snapshotFailed = false;

  Y.transact(
    doc,
    () => {
      if (page.snapshot !== null) {
        const bytes = decodeUpdate(page.snapshot.state);
        if (bytes === null) {
          // The rows after `through_id` are meaningless without what it folds.
          snapshotFailed = true;
        } else {
          try {
            Y.applyUpdate(doc, bytes, ORIGIN_REMOTE);
            highest = page.snapshot.throughId;
          } catch (error: unknown) {
            console.warn('[viewer] the snapshot did not apply:', error);
            snapshotFailed = true;
          }
        }
      }

      for (const row of page.updates) {
        const bytes = decodeUpdate(row.update);
        if (bytes === null) {
          // Drop the individual row, never the batch.
          console.warn('[viewer] skipping undecodable log row %d', row.id);
          continue;
        }
        try {
          Y.applyUpdate(doc, bytes, ORIGIN_REMOTE);
          highest = Math.max(highest, row.id);
        } catch (error: unknown) {
          console.warn('[viewer] log row %d did not apply:', row.id, error);
        }
      }
    },
    ORIGIN_REMOTE,
  );

  return { highest, snapshotFailed };
}

/**
 * Pulls every page from `afterId` into the document.
 *
 * @returns The highest id applied, or the reason the read stopped
 */
async function applyFromCursor(
  client: TypedSupabaseClient,
  token: string,
  doc: Y.Doc,
  afterId: number,
  firstPage?: SharedTripPayload,
): Promise<
  | { readonly status: 'ok'; readonly highest: number; readonly applied: boolean }
  | { readonly status: InviteRejection }
  | { readonly status: 'error'; readonly message: string }
> {
  let cursor = afterId;
  let applied = false;
  let page = firstPage;

  for (let pages = 0; pages < MAX_PAGES_PER_REFRESH; pages += 1) {
    if (page === undefined) {
      const read = await readSharedTrip(client, token, cursor);
      if (read.status !== 'ok') {
        return read;
      }
      page = read.payload;
    }

    const result = applyPage(doc, page);
    if (result.snapshotFailed) {
      return {
        status: 'error',
        message: 'the trip could not be read: its compacted document did not decode',
      };
    }
    if (result.highest > cursor) {
      cursor = result.highest;
      applied = true;
    }
    if (!page.hasMore) {
      break;
    }
    page = undefined;
  }

  return { status: 'ok', highest: cursor, applied };
}

// ============================================================================
// Opening the link
// ============================================================================

/**
 * Gets the trip behind a token onto this device, as a viewer trip.
 *
 * Idempotent: opening the same link twice finds the existing local row. A trip
 * this device already holds as a *member* is left exactly as it is and reported
 * as such — the account that joined it outranks the link.
 *
 * Works with its own document rather than the one React holds: the trip is not
 * the open one at this point, so there is no live document to borrow. What it
 * writes — the local row, the persisted updates, the Dexie projection, the
 * cursor and the server state vector — is what `useTripDoc` and the pages read
 * the moment the trip is selected.
 *
 * @param client - A Supabase client, with or without a session
 * @param token - The invite token from the link
 */
export async function materialiseViewerTrip(
  client: TypedSupabaseClient,
  token: string,
): Promise<ViewerTripResult> {
  const first = await readSharedTrip(client, token, 0);
  if (first.status !== 'ok') {
    return first;
  }
  const { payload } = first;
  const remoteTripId = payload.trip.id;

  try {
    const known = await db.trips.where('remoteTripId').equals(remoteTripId).first();
    if (known !== undefined && known.viewerToken === undefined) {
      return { status: 'member', tripId: known.id };
    }

    const tripId =
      known !== undefined
        ? known.id
        : await createViewerTripRow(payload.trip, remoteTripId, token);

    if (known !== undefined && known.viewerToken !== token) {
      // A newer link for the same trip: read through it from now on.
      await db.trips.update(tripId, { viewerToken: token });
    }

    const doc = new Y.Doc();
    try {
      // Whatever this device already holds for the trip, so the delta persisted
      // below is only what is new.
      await loadPersistedUpdates(doc, tripId);
      const before = Y.encodeStateVector(doc);

      const pulled = await applyFromCursor(client, token, doc, 0, payload);
      if (pulled.status !== 'ok') {
        return pulled;
      }

      const delta = Y.encodeStateAsUpdate(doc, before);
      if (!isEmptyUpdate(delta)) {
        await db.yjsUpdates.add({ tripId, update: delta });
      }

      // Awaited, unlike the projection `subscribeToUpdates` fires: the page
      // that called this is about to read the guests from Dexie.
      await syncDocToDexie(doc, tripId);

      if (pulled.highest > 0) {
        await advanceCursor(tripId, pulled.highest);
      }
      // The document now holds exactly what the server holds, and nothing
      // else may be written into it. Recording that here is what makes the
      // later upgrade to a member trip push nothing: the provider's diff
      // against this vector is empty.
      await recordServerState(tripId, Y.encodeStateVector(doc));
    } finally {
      doc.destroy();
    }

    return { status: 'viewing', tripId };
  } catch (error: unknown) {
    return { status: 'error', message: toMessage(error) };
  }
}

/**
 * Creates the local row for a viewer trip, once, whatever races it.
 *
 * The look-up and the write are one transaction for the same reason
 * `materialiseJoinedTrip`'s are: two tabs opening the same link would each see
 * nothing and each add a row. IndexedDB serialises readwrite transactions over
 * one store across connections, so this is a real lock and not a tidier race.
 */
async function createViewerTripRow(
  preview: RemoteTripPreview,
  remoteTripId: string,
  token: string,
): Promise<TripId> {
  return db.transaction('rw', db.trips, async (): Promise<TripId> => {
    const existing = await db.trips.where('remoteTripId').equals(remoteTripId).first();
    if (existing !== undefined) {
      return existing.id;
    }

    const now = Date.now() as UnixTimestamp;
    const trip: Trip = {
      id: nanoid() as TripId,
      name: preview.name,
      startDate: toISODateStringFromString(preview.startDate),
      endDate: toISODateStringFromString(preview.endDate),
      // A local share id, never one adopted from the server: it is a unique
      // Dexie index, and a colliding value aborts the whole write transaction.
      shareId: nanoid(10) as ShareId,
      createdAt: now,
      updatedAt: now,
      remoteTripId,
      viewerToken: token,
    };

    await db.trips.add(trip);
    return trip.id;
  });
}

// ============================================================================
// Keeping a viewer trip current
// ============================================================================

/**
 * Pulls what the members wrote since this device last looked.
 *
 * Into the **live** document: `useTripDoc` has already attached the bridge that
 * persists every update and projects it into Dexie, so applying here is enough
 * for every page to re-render. The explicit projection at the end is the
 * read-only guarantee — a row a viewer somehow wrote locally is replaced by the
 * server's view of the trip, even when nothing new arrived.
 *
 * @param client - A Supabase client, with or without a session
 * @param doc - The trip's live document
 * @param tripId - The local trip id
 * @param token - The invite token the trip is read through
 */
export async function refreshViewerTrip(
  client: TypedSupabaseClient,
  doc: Y.Doc,
  tripId: TripId,
  token: string,
): Promise<ViewerRefreshResult> {
  try {
    const cursor = await readCursor(tripId);
    const pulled = await applyFromCursor(client, token, doc, cursor.lastSeenUpdateId);
    if (pulled.status !== 'ok') {
      return pulled;
    }

    if (pulled.highest > cursor.lastSeenUpdateId) {
      await advanceCursor(tripId, pulled.highest);
    }
    await recordServerState(tripId, Y.encodeStateVector(doc));
    await syncDocToDexie(doc, tripId);

    return { status: pulled.applied ? 'updated' : 'current' };
  } catch (error: unknown) {
    return { status: 'error', message: toMessage(error) };
  }
}

// ============================================================================
// Becoming a member
// ============================================================================

/**
 * Turns a viewer trip into a member trip, once its viewer has an account.
 *
 * Redeems the token the trip was read through, clears `viewerToken`, and — if
 * the viewer had said who they are while signed out — makes that the account's
 * claim on the roster, so the choice made in the browser survives the sign-in.
 *
 * `remoteTripId` is already set and unchanged, so the moment `viewerToken`
 * clears the sync provider mounts on the same document. Its first reconcile
 * finds nothing to push, because the viewer path recorded the server's state
 * vector after every read and allowed no local write in between.
 *
 * @param client - An authenticated Supabase client
 * @param userId - The signed-in account
 * @param trip - The local trip row
 */
export async function upgradeViewerTrip(
  client: TypedSupabaseClient,
  userId: string,
  trip: Trip,
): Promise<ViewerUpgradeResult> {
  const token = trip.viewerToken;
  if (token === undefined) {
    return { status: 'already-member' };
  }

  try {
    const redeemed = await redeemInvite(client, token);
    if (redeemed.status !== 'joined') {
      return redeemed;
    }

    if (trip.remoteTripId !== undefined && redeemed.remoteTripId !== trip.remoteTripId) {
      // The token opened a different trip than the one it was stored on. Do not
      // relink: the local row's document belongs to the trip it was read from.
      return { status: 'error', message: 'the invite belongs to another trip' };
    }

    await db.trips.update(trip.id, {
      viewerToken: undefined,
      remoteTripId: redeemed.remoteTripId,
    });

    // The identity chosen while signed out was a deliberate answer to "which one
    // are you"; carrying it onto the roster spares asking twice. A name somebody
    // else claimed in the meantime is simply not claimed, and the trip opens
    // as it would for a member who skipped the step.
    const personId = getTripGuestPersonId(trip);
    if (personId !== undefined) {
      const claim = await claimParticipant(client, redeemed.remoteTripId, userId, personId);
      if (claim.status === 'claimed') {
        await cacheClaimedPersonId(trip.id, userId, personId);
      }
    }

    return { status: 'upgraded' };
  } catch (error: unknown) {
    return { status: 'error', message: toMessage(error) };
  }
}

// ============================================================================
// Internals
// ============================================================================

function isEmptyUpdate(update: Uint8Array): boolean {
  return (
    update.length === EMPTY_UPDATE.length &&
    update.every((byte, index) => byte === EMPTY_UPDATE[index])
  );
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
