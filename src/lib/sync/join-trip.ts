/**
 * @fileoverview Turning a redeemed invite into a local trip.
 *
 * Redemption gets the account onto the server's roster. This gets the trip onto
 * the device: a local `Trip` row whose `remoteTripId` points at the server row,
 * so the sync provider mounts and hydrates the document from the log.
 *
 * The local row starts as a placeholder — the name and dates come from the
 * server's denormalised preview, and the document overwrites them the moment it
 * arrives. That is deliberate: showing "Brittany, 15–22 July" immediately is
 * better than a spinner while the log downloads, and being briefly wrong about a
 * detail the user is about to see corrected costs nothing.
 *
 * @module lib/sync/join-trip
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';

import { db } from '@/lib/db/database';
import { toISODateStringFromString } from '@/lib/db/utils';
import type { ShareId, Trip, TripId, UnixTimestamp } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

export type JoinTripResult =
  | { readonly status: 'joined'; readonly tripId: TripId }
  /** Already on this device — opening the same link twice. */
  | { readonly status: 'already-local'; readonly tripId: TripId }
  | { readonly status: 'error'; readonly message: string };

interface RemoteTripPreview {
  readonly name: string;
  readonly startDate: string;
  readonly endDate: string;
}

// ============================================================================
// Internals
// ============================================================================

async function fetchRemoteTripPreview(
  client: SupabaseClient,
  remoteTripId: string,
): Promise<RemoteTripPreview | null> {
  const { data, error } = await client
    .from('trips')
    .select('name, start_date, end_date')
    .eq('id', remoteTripId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const row = data as Record<string, unknown>;
  return {
    name: typeof row.name === 'string' ? row.name : 'Shared trip',
    startDate: typeof row.start_date === 'string' ? row.start_date : '',
    endDate: typeof row.end_date === 'string' ? row.end_date : '',
  };
}

/**
 * Bounds the preview before it reaches Dexie.
 *
 * The server row is written by another user, which makes it remote-supplied
 * input by the same standard as a WebRTC peer's document. A 200-character cap
 * matches the server's own check constraint; a malformed date falls back to
 * today rather than poisoning every date query with an unparseable value.
 */
function sanitisePreview(preview: RemoteTripPreview | null): RemoteTripPreview {
  const today = new Date().toISOString().slice(0, 10);
  if (!preview) {
    return { name: 'Shared trip', startDate: today, endDate: today };
  }

  const isIsoDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

  return {
    name: preview.name.slice(0, 200) || 'Shared trip',
    startDate: isIsoDate(preview.startDate) ? preview.startDate : today,
    endDate: isIsoDate(preview.endDate) ? preview.endDate : today,
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Creates or finds the local trip for a server trip this account has joined.
 *
 * Idempotent: opening the same invite twice, or on a device that already has the
 * trip, returns the existing local trip rather than creating a duplicate.
 *
 * @param client - Authenticated Supabase client
 * @param remoteTripId - Server `trips.id`, as returned by `redeem_invite`
 */
export async function materialiseJoinedTrip(
  client: SupabaseClient,
  remoteTripId: string,
): Promise<JoinTripResult> {
  try {
    // Resolve locally rather than trusting anything in the payload — the same
    // rule the CRDT bridge follows.
    const existing = await db.trips
      .where('remoteTripId')
      .equals(remoteTripId)
      .first();
    if (existing) {
      return { status: 'already-local', tripId: existing.id };
    }

    const preview = sanitisePreview(await fetchRemoteTripPreview(client, remoteTripId));
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
    };

    await db.trips.add(trip);
    return { status: 'joined', tripId: trip.id };
  } catch (error: unknown) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Records which participant this account is.
 *
 * The unique constraint on `(trip_id, person_id)` is what actually prevents two
 * accounts claiming the same person, so a conflict here is an expected outcome
 * to report, not a bug to guard against beforehand — checking first would leave
 * a race between the check and the write.
 *
 * Confirmed against the row the server returns, never against the absence of an
 * error. An UPDATE matching nothing is not a failure in SQL: it succeeds, having
 * changed no rows, and reports no error. That is the normal outcome whenever the
 * roster row is not visible to this account — redemption never completed, the
 * session belongs to a different user than the one that redeemed, or the RLS
 * `user_id = auth.uid()` check filters it out. Trusting the missing error would
 * leave the identity null while the UI moved on, and an unclaimed participant
 * still looks free, so the next person to join could claim the same name.
 *
 * `select()` is safe to add here even though `RETURNING` is subject to the
 * SELECT policy: that policy is `is_trip_member(trip_id)`, and an account
 * claiming an identity is by definition on the roster it is updating.
 */
export async function claimParticipant(
  client: SupabaseClient,
  remoteTripId: string,
  userId: string,
  personId: string,
): Promise<{
  readonly status: 'claimed' | 'taken' | 'not-a-member' | 'error';
  readonly message?: string;
}> {
  try {
    const { data, error } = await client
      .from('trip_members')
      .update({ person_id: personId })
      .eq('trip_id', remoteTripId)
      .eq('user_id', userId)
      .select('person_id');

    if (error) {
      // 23505 is unique_violation: somebody else is already this participant.
      if (error.code === '23505') {
        return { status: 'taken' };
      }
      return { status: 'error', message: error.message };
    }

    if (!Array.isArray(data) || data.length === 0) {
      return { status: 'not-a-member' };
    }

    return { status: 'claimed' };
  } catch (error: unknown) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Which participants are already claimed by other accounts.
 *
 * Drives the identity step: a name someone else has taken must not be offered as
 * a choice, or the claim fails at the last moment with nothing useful to say.
 */
export async function fetchClaimedParticipants(
  client: SupabaseClient,
  remoteTripId: string,
  currentUserId: string,
): Promise<Set<string>> {
  try {
    const { data, error } = await client
      .from('trip_members')
      .select('user_id, person_id')
      .eq('trip_id', remoteTripId);

    if (error || !data) {
      return new Set();
    }

    return new Set(
      (data as { user_id: string; person_id: string | null }[])
        .filter((row) => row.person_id !== null && row.user_id !== currentUserId)
        .map((row) => row.person_id as string),
    );
  } catch {
    return new Set();
  }
}
