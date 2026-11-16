/**
 * @fileoverview Who is on a shared trip, and taking someone off it.
 *
 * The roster is `trip_members`: one row per account, with the guest the
 * account said it is (`person_id`) once it has picked one. The organiser is
 * `trips.owner_id`; the roster has no role column.
 *
 * Removing goes through the `remove_trip_member` RPC, because no client policy
 * deletes another account's row. The function also withdraws every live invite
 * of the trip, so the removed person cannot rejoin with the link they joined
 * through, and stops their reminders.
 *
 * @module lib/sync/members
 */

import type { TypedSupabaseClient } from '@/lib/supabase/client';

// ============================================================================
// Type Definitions
// ============================================================================

/** One account on a trip's roster. */
export interface TripMember {
  readonly userId: string;
  /** The guest this account said it is, or null before it picked one. */
  readonly personId: string | null;
  readonly joinedAt: string;
}

export type ListTripMembersResult =
  | {
      readonly status: 'ok';
      /** The organiser's account, or null when the trip row is not readable. */
      readonly ownerId: string | null;
      /** Oldest first, so the organiser, who joined at creation, leads. */
      readonly members: readonly TripMember[];
    }
  | { readonly status: 'error'; readonly message: string };

export type RemoveTripMemberResult =
  | { readonly status: 'removed' }
  | { readonly status: 'not-owner' }
  | { readonly status: 'error'; readonly message: string };

// ============================================================================
// Reads
// ============================================================================

/**
 * The trip's roster and its organiser.
 *
 * @param client - Authenticated Supabase client
 * @param remoteTripId - Server `trips.id`
 */
export async function listTripMembers(
  client: TypedSupabaseClient,
  remoteTripId: string,
): Promise<ListTripMembersResult> {
  try {
    const [trip, roster] = await Promise.all([
      client.from('trips').select('owner_id').eq('id', remoteTripId).maybeSingle(),
      client
        .from('trip_members')
        .select('user_id, person_id, joined_at')
        .eq('trip_id', remoteTripId)
        .order('joined_at', { ascending: true }),
    ]);

    if (trip.error) {
      return { status: 'error', message: trip.error.message };
    }
    if (roster.error) {
      return { status: 'error', message: roster.error.message };
    }

    const ownerId = typeof trip.data?.owner_id === 'string' ? trip.data.owner_id : null;
    const members = (roster.data ?? []).map(
      (row): TripMember => ({
        userId: row.user_id,
        personId: row.person_id,
        joinedAt: row.joined_at,
      }),
    );
    return { status: 'ok', ownerId, members };
  } catch (error: unknown) {
    return { status: 'error', message: toMessage(error) };
  }
}

// ============================================================================
// Writes
// ============================================================================

/**
 * Takes an account off the trip. Only the organiser may.
 *
 * @param client - Authenticated Supabase client
 * @param remoteTripId - Server `trips.id`
 * @param userId - The account to remove
 */
export async function removeTripMember(
  client: TypedSupabaseClient,
  remoteTripId: string,
  userId: string,
): Promise<RemoveTripMemberResult> {
  try {
    const { error } = await client.rpc('remove_trip_member', {
      target_trip_id: remoteTripId,
      target_user_id: userId,
    });
    if (!error) {
      return { status: 'removed' };
    }
    if (error.code === '42501') {
      return { status: 'not-owner' };
    }
    return { status: 'error', message: error.message };
  } catch (error: unknown) {
    return { status: 'error', message: toMessage(error) };
  }
}

// ============================================================================
// Internals
// ============================================================================

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
