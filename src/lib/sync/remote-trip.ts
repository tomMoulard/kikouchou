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
 * @module lib/sync/remote-trip
 */

import type { SupabaseClient } from '@supabase/supabase-js';

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

// ============================================================================
// Internals
// ============================================================================

/**
 * Reads back the row for a trip already uploaded by this owner.
 *
 * Used both to recover from a duplicate-key collision and to re-link a device
 * that lost its local `remoteTripId` — after a reinstall, say — without creating
 * a second server row for the same trip.
 */
async function findExistingRemoteTrip(
  client: SupabaseClient,
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

/**
 * Whether the server row this trip points at still exists.
 *
 * Null means the question could not be answered, which the caller must not read
 * as "deleted" — creating a duplicate row on every failed check would be far
 * worse than doing nothing.
 */
async function remoteTripExists(
  client: SupabaseClient,
  remoteTripId: string,
): Promise<boolean | null> {
  try {
    const { data, error } = await client
      .from('trips')
      .select('id')
      .eq('id', remoteTripId)
      .limit(1);
    if (error) {
      return null;
    }
    return Array.isArray(data) && data.length > 0;
  } catch {
    return null;
  }
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
  client: SupabaseClient | null,
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
    const stillThere = await remoteTripExists(client, trip.remoteTripId);

    if (stillThere !== false) {
      // Present, or unknowable. Either way, keep the link.
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
        name: trip.name,
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
 * lives in the document, which stays authoritative. Failure is deliberately
 * swallowed — a stale preview is cosmetic, and this must never block an edit.
 */
export async function syncRemoteTripMetadata(
  client: SupabaseClient | null,
  trip: Trip,
): Promise<void> {
  if (!client || !trip.remoteTripId) {
    return;
  }

  try {
    await client
      .from('trips')
      .update({
        name: trip.name,
        start_date: trip.startDate,
        end_date: trip.endDate,
      })
      .eq('id', trip.remoteTripId);
  } catch (error: unknown) {
    console.warn('[sync] trip preview update failed (harmless):', error);
  }
}

/**
 * Server trips this account can see that are not on this device yet.
 *
 * Drives the "trips you joined elsewhere" part of the trip list. Returns an
 * empty array rather than throwing when offline: the list still has to render
 * whatever is local.
 */
export async function listRemoteTripsMissingLocally(
  client: SupabaseClient | null,
): Promise<{ readonly id: string; readonly name: string }[]> {
  if (!client) {
    return [];
  }

  try {
    const { data, error } = await client.from('trips').select('id, name');
    if (error || !data) {
      return [];
    }

    const localRemoteIds = new Set(
      (await db.trips.toArray())
        .map((trip) => trip.remoteTripId)
        .filter((id): id is string => typeof id === 'string'),
    );

    return (data as { id: string; name: string }[]).filter(
      (row) => !localRemoteIds.has(row.id),
    );
  } catch {
    return [];
  }
}
