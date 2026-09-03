/**
 * @fileoverview Getting a local trip a server row.
 *
 * This is the seam where a trip stops being local-only. It runs at exactly two
 * moments — when someone shares a trip, and when someone joins one — and never
 * on launch, because a trip nobody has shared must never touch the network.
 *
 * Idempotency is the whole problem here. A device may retry this after a failed
 * request, two tabs may run it at once, and a reinstall may run it again against
 * a row that already exists. The server's `unique (owner_id, local_id)` is what
 * makes all three safe: the client's own nanoid `TripId` travels as `local_id`,
 * so "create the row for this trip" resolves to the same row every time rather
 * than littering duplicates.
 *
 * ## Which copy of a trip's name and dates wins
 *
 * There are three, and they are not equals:
 *
 * 1. The **Y.Doc** is authoritative. Every device converges on it.
 * 2. **Dexie** holds what this device has hydrated from that document, and is
 *    what the whole UI renders.
 * 3. The **server `trips` row** holds a denormalised *preview* — name and dates
 *    only — for the one case the other two cannot serve: a device that is a
 *    member of a trip it has never downloaded. It is a cache, never a source.
 *
 * The preview is therefore allowed to lag, but it must not lag *silently*, and
 * this module is where it is kept honest: every write asks for the affected rows
 * back and reports what happened, and `ensureRemoteTrip` republishes it whenever
 * it finds it out of step — which is the moment a link is about to be handed to
 * somebody whose only source it is.
 *
 * @module lib/sync/remote-trip
 */

import type { TypedSupabaseClient } from '@/lib/supabase/client';

import { db } from '@/lib/db/database';
import type { Trip, TripId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

export type EnsureRemoteTripResult =
  | { readonly status: 'ready'; readonly remoteTripId: string }
  /** No account, so there is nothing to upload to. Not an error. */
  | { readonly status: 'unauthenticated' }
  /** The trip is not on this device. */
  | { readonly status: 'missing' }
  | { readonly status: 'error'; readonly message: string };

/**
 * What happened to the denormalised preview.
 *
 * Deliberately not `void`. The update is an UPDATE narrowed by RLS to rows this
 * account owns, so it matches nothing at all on a *member's* device — and an
 * UPDATE matching no row succeeds, with no error and no rows. Reported as a
 * status rather than swallowed, so "the preview is stale and this device cannot
 * fix it" is a fact a caller can see instead of silence.
 */
export type SyncPreviewResult =
  /** No client, or the trip has never been shared. Nothing to keep in step. */
  | { readonly status: 'skipped' }
  | { readonly status: 'updated' }
  /**
   * The UPDATE matched no row. Either this account does not own the trip
   * (`owners update their trips`) or the row is gone. Not this device's problem
   * to solve, and not an error to shout about — but not a success either.
   */
  | { readonly status: 'not-applied' }
  | { readonly status: 'error'; readonly message: string };

/** The server's preview columns for one trip. */
interface RemotePreview {
  readonly name: string;
  readonly startDate: string;
  readonly endDate: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * The server's own bound: `check (length(name) between 1 and 200)`.
 *
 * The trip form clips a name to 100, but a name adopted from a peer's document
 * never passes through that sanitiser, so an over-long one can and does reach
 * Dexie. Sent as-is it fails the check constraint — as a silently dropped
 * preview update, and as an outright failure to share. The preview is a cache,
 * so clipping it costs nothing the document does not still hold in full.
 */
const MAX_PREVIEW_NAME_LENGTH = 200;

// ============================================================================
// Internals
// ============================================================================

/**
 * The name as the server will accept it: trimmed, and clipped to its check
 * constraint.
 *
 * A name of nothing but whitespace keeps its whitespace. Trimming it to `''`
 * would fail `length(name) between 1 and 200` — turning a share that used to
 * work into a database error in the share dialog, over a name nobody can see
 * anyway.
 */
function previewName(name: string): string {
  const trimmed = name.trim().slice(0, MAX_PREVIEW_NAME_LENGTH);
  return trimmed || name.slice(0, MAX_PREVIEW_NAME_LENGTH);
}

/**
 * Reads back the row for a trip already uploaded by this owner.
 *
 * Used both to recover from a duplicate-key collision and to re-link a device
 * that lost its local `remoteTripId` — after a reinstall, say — without creating
 * a second server row for the same trip.
 */
async function findExistingRemoteTrip(
  client: TypedSupabaseClient,
  ownerId: string,
  localId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('trips')
    .select('id')
    .eq('owner_id', ownerId)
    .eq('local_id', localId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }
  const id = (data as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

async function rememberRemoteTripId(
  tripId: TripId,
  remoteTripId: string,
): Promise<void> {
  await db.trips.update(tripId, { remoteTripId });
}

/** The state of the server row a local trip points at. */
type RemoteTripState =
  | { readonly status: 'present'; readonly preview: RemotePreview | null }
  | { readonly status: 'absent' }
  /** The question could not be answered. Never the same as "absent". */
  | { readonly status: 'unknown' };

/**
 * Looks up the server row this trip points at.
 *
 * `unknown` is not "deleted", and the caller must not treat it as one: creating
 * a duplicate row on every failed check would be far worse than doing nothing.
 *
 * The preview columns come back with it rather than `id` alone: the same round
 * trip that answers "is it still there?" also answers "does it still say what
 * this device says?", which is what makes republishing free.
 */
async function readRemoteTrip(
  client: TypedSupabaseClient,
  remoteTripId: string,
): Promise<RemoteTripState> {
  try {
    const { data, error } = await client
      .from('trips')
      .select('id, name, start_date, end_date')
      .eq('id', remoteTripId)
      .limit(1);
    if (error) {
      return { status: 'unknown' };
    }
    if (!Array.isArray(data) || data.length === 0) {
      return { status: 'absent' };
    }

    // Remote-supplied, so read defensively: a row missing its preview columns is
    // still a row that exists, which is the question that must not be got wrong.
    const row = data[0] as Record<string, unknown> | undefined;
    const name = row?.name;
    const startDate = row?.start_date;
    const endDate = row?.end_date;
    const preview =
      typeof name === 'string' &&
      typeof startDate === 'string' &&
      typeof endDate === 'string'
        ? { name, startDate, endDate }
        : null;

    return { status: 'present', preview };
  } catch {
    return { status: 'unknown' };
  }
}

/** Whether the server's preview still describes the trip on this device. */
function previewMatches(preview: RemotePreview | null, trip: Trip): boolean {
  return (
    preview !== null &&
    preview.name === previewName(trip.name) &&
    preview.startDate === trip.startDate &&
    preview.endDate === trip.endDate
  );
}

/**
 * Drops a local trip's link to a server row that is gone, and the sync
 * bookkeeping that described it.
 *
 * The cursor matters as much as the link. `serverStateVector` records what the
 * server was known to hold, so carrying it across to a freshly created row would
 * leave the provider computing a diff against a state that row has never had —
 * pushing a fragment of the document and treating the rest as already sent.
 */
async function forgetRemoteTrip(tripId: TripId): Promise<void> {
  await db.trips.update(tripId, { remoteTripId: undefined });
  await db.syncCursors.delete(tripId);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Makes sure the trip has a server row, creating one if needed.
 *
 * Safe to call repeatedly. Returns the existing id without a write when the trip
 * has already been uploaded.
 *
 * @param client - An authenticated Supabase client
 * @param userId - The signed-in user, who becomes the trip's owner
 * @param tripId - Local trip to upload
 */
export async function ensureRemoteTrip(
  client: TypedSupabaseClient | null,
  userId: string | null,
  tripId: TripId,
): Promise<EnsureRemoteTripResult> {
  if (!client || !userId) {
    return { status: 'unauthenticated' };
  }

  const trip = await db.trips.get(tripId);
  if (!trip) {
    return { status: 'missing' };
  }

  if (trip.remoteTripId) {
    // Verified rather than trusted. The local `remoteTripId` is a cached pointer
    // at a row on the server, and it goes stale for ordinary reasons: the row
    // deleted from the dashboard, a project reset, a restore from a backup taken
    // before the trip existed.
    //
    // Trusting it produced a confusing failure rather than a clean one. Deleting
    // a trip cascades its `trip_members` row away, so the upload that follows
    // went ahead against a trip this account was no longer a member of and the
    // insert policy correctly refused it —
    // `new row violates row-level security policy for table "trip_doc_updates"`,
    // reported from the share dialog, which reads as a permissions bug rather
    // than a missing trip.
    const remote = await readRemoteTrip(client, trip.remoteTripId);

    if (remote.status !== 'absent') {
      // Present, or unknowable. Either way, keep the link.
      if (remote.status === 'present' && !previewMatches(remote.preview, trip)) {
        // Sharing is the one moment the preview is certain to be read by
        // somebody who has nothing else to go on, and the one moment the trip's
        // owner is at the keyboard — so it is where a preview that drifted gets
        // put right. Awaited, but its outcome cannot fail the share: the link
        // works whatever the row says.
        await syncRemoteTripMetadata(client, trip);
      }
      return { status: 'ready', remoteTripId: trip.remoteTripId };
    }

    // Gone. Forget it and fall through to create a fresh row, which is what
    // sharing the trip again should mean.
    console.info(
      '[sync] the server row for trip %s is gone; creating a new one',
      tripId,
    );
    await forgetRemoteTrip(tripId);
  }

  try {
    const { data, error } = await client
      .from('trips')
      .insert({
        local_id: trip.id,
        owner_id: userId,
        name: previewName(trip.name),
        start_date: trip.startDate,
        end_date: trip.endDate,
      })
      .select('id')
      .single();

    if (!error) {
      const id = (data as { id?: unknown } | null)?.id;
      if (typeof id !== 'string') {
        return { status: 'error', message: 'server did not return a trip id' };
      }
      await rememberRemoteTripId(tripId, id);
      return { status: 'ready', remoteTripId: id };
    }

    // 23505 is unique_violation: this trip is already uploaded, by this device
    // or another one. Read the row back rather than treating it as a failure.
    if (error.code === '23505') {
      const existing = await findExistingRemoteTrip(client, userId, trip.id);
      if (existing) {
        await rememberRemoteTripId(tripId, existing);
        return { status: 'ready', remoteTripId: existing };
      }
    }

    return { status: 'error', message: error.message };
  } catch (error: unknown) {
    // Offline: the fetch rejects rather than returning an error.
    return {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Keeps the server's denormalised preview in step with the document.
 *
 * Only the three fields the trip list renders before hydrating: everything else
 * lives in the document, which stays authoritative.
 *
 * It still never blocks an edit — the caller is free to ignore the result — but
 * it no longer *hides* what happened. It used to `await` an update it never
 * looked at, which made two very different outcomes indistinguishable: the
 * preview being brought up to date, and the preview being permanently
 * unmaintainable from this device because RLS narrows the UPDATE to
 * `owner_id = auth.uid()` and a guest owns nothing. That second case matched no
 * rows, returned no error, and left every other device reading a name the trip
 * no longer has.
 *
 * @returns What actually happened to the row — including `not-applied`, the
 *   zero-rows case an unchecked `await` reported as success.
 */
export async function syncRemoteTripMetadata(
  client: TypedSupabaseClient | null,
  trip: Trip,
): Promise<SyncPreviewResult> {
  if (!client || !trip.remoteTripId) {
    return { status: 'skipped' };
  }

  try {
    // `.select()` is what makes this checkable: without it PostgREST returns no
    // rows for an UPDATE, so "nothing matched" and "everything worked" arrive
    // as the same empty, error-free answer.
    const { data, error } = await client
      .from('trips')
      .update({
        name: previewName(trip.name),
        start_date: trip.startDate,
        end_date: trip.endDate,
      })
      .eq('id', trip.remoteTripId)
      .select('id');

    if (error) {
      console.warn('[sync] trip preview update failed:', error.message);
      return { status: 'error', message: error.message };
    }

    if (!Array.isArray(data) || data.length === 0) {
      // Expected and permanent on a member's device; a deleted row on the
      // owner's. Either way the list on other devices keeps the old name, so it
      // is said out loud rather than passed off as an update.
      console.info(
        '[sync] trip preview for %s was not updated: no row this account may write',
        trip.remoteTripId,
      );
      return { status: 'not-applied' };
    }

    return { status: 'updated' };
  } catch (error: unknown) {
    // Offline: the fetch rejects rather than returning an error. The preview
    // will be republished the next time the trip is opened or shared.
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[sync] trip preview update failed:', message);
    return { status: 'error', message };
  }
}

/**
 * Server trips this account can see that are not on this device yet.
 *
 * Drives the "trips you joined elsewhere" part of the trip list. Returns an
 * empty array rather than throwing when offline: the list still has to render
 * whatever is local.
 *
 * Every field here is remote-supplied — the row was written by whoever owns the
 * trip — so it is validated and bounded on the way in rather than cast and
 * rendered. A row without a usable id is dropped on its own; a row whose name is
 * missing or blank keeps its place with an empty name, which the caller renders
 * as a translated placeholder. Inventing an English one here would put an
 * untranslated string on screen as if it were the trip's name.
 */
export async function listRemoteTripsMissingLocally(
  client: TypedSupabaseClient | null,
): Promise<{ readonly id: string; readonly name: string }[]> {
  if (!client) {
    return [];
  }

  try {
    const { data, error } = await client.from('trips').select('id, name');
    if (error || !Array.isArray(data)) {
      return [];
    }

    const localRemoteIds = new Set(
      (await db.trips.toArray())
        .map((trip) => trip.remoteTripId)
        .filter((id): id is string => typeof id === 'string'),
    );

    const remoteOnly: { readonly id: string; readonly name: string }[] = [];
    for (const row of data as readonly Record<string, unknown>[]) {
      const id = row.id;
      if (typeof id !== 'string' || id.length === 0 || localRemoteIds.has(id)) {
        continue;
      }
      const name = row.name;
      remoteOnly.push({
        id,
        name: typeof name === 'string' ? previewName(name) : '',
      });
    }
    return remoteOnly;
  } catch {
    return [];
  }
}
