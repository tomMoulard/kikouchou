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

import type { TypedSupabaseClient } from '@/lib/supabase/client';
import { nanoid } from 'nanoid';

import { db } from '@/lib/db/database';
import { toISODateStringFromString, toLocalISODateString } from '@/lib/db/utils';
import i18n from '@/lib/i18n';
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
  client: TypedSupabaseClient,
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
    // Empty, not a name. Reading the row is not the place to decide what a
    // nameless trip is called — `sanitisePreview` is, and it is the only place,
    // so every missing-name path lands on one string instead of three literals
    // that disagreed about capitalisation.
    name: typeof row.name === 'string' ? row.name : '',
    startDate: typeof row.start_date === 'string' ? row.start_date : '',
    endDate: typeof row.end_date === 'string' ? row.end_date : '',
  };
}

/**
 * Bounds the preview before it reaches Dexie, and names a trip that has no name.
 *
 * The server row is written by another user, which makes it remote-supplied
 * input by the same standard as a peer's document. A 200-character cap matches
 * the server's own check constraint; a malformed date falls back to today rather
 * than poisoning every date query with an unparseable value.
 *
 * The fallback name is translated at the point it is written, not left as a
 * sentinel for the UI to resolve. That is the deliberately worse-looking half of
 * a real trade-off, so it is worth stating:
 *
 * - It is *persisted*. `db.trips.name` is what `TripCard`, `TripListPage` and
 *   `PageHeader` render, straight, with no `|| t(...)` in the way — an empty
 *   sentinel would show a nameless trip as blank on every one of them. The
 *   render-time form (`trip.name || t('trips.untitled')`) is what
 *   `lib/sync/remote-trip.ts` does, and it can, because that list is built fresh
 *   on every render and never stored.
 * - So switching language later does not re-translate an already-joined trip.
 *   That is the accepted cost. It is bounded: the trip is nameless only until
 *   the CRDT document arrives with the owner's real name, usually seconds, and
 *   the user can rename it. A blank trip name in the meantime is worse than a
 *   stale-language one.
 *
 * The key is `trips.untitled` — the same one the CRDT bridge writes for the same
 * situation, so the two entry paths cannot disagree about what a nameless trip
 * is called. Importing `@/lib/i18n` from `lib/` follows that bridge: it is the
 * framework-free i18next instance, not a React hook.
 */
function sanitisePreview(preview: RemoteTripPreview | null): RemoteTripPreview {
  // The viewer's own calendar day, not UTC: these become `Trip.startDate` /
  // `Trip.endDate`, which the whole app reads as local day keys. Deriving the
  // fallback in UTC handed a Paris user yesterday's date for most of the
  // evening, and the placeholder trip opened on the wrong day.
  const today = toLocalISODateString(new Date());
  const untitled = i18n.t('trips.untitled');

  if (!preview) {
    return { name: untitled, startDate: today, endDate: today };
  }

  const isIsoDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

  return {
    name: preview.name.trim().slice(0, 200) || untitled,
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
  client: TypedSupabaseClient,
  remoteTripId: string,
): Promise<JoinTripResult> {
  try {
    // The cheap answer first, outside any transaction: opening an invite twice,
    // or downloading a trip the sweep already brought in, must not cost a round
    // trip to fetch a preview that is about to be thrown away.
    const known = await db.trips.where('remoteTripId').equals(remoteTripId).first();
    if (known) {
      return { status: 'already-local', tripId: known.id };
    }

    const preview = sanitisePreview(await fetchRemoteTripPreview(client, remoteTripId));
    const now = Date.now() as UnixTimestamp;

    // The look-up and the write are one transaction, not two statements.
    //
    // The check above is a fast path, not the guard: it answers from a moment
    // that has already passed by the time the preview lands. The one below is
    // the authoritative one, and it is repeated deliberately.
    //
    // "Is it here already? No — add it" is a check-then-act, and it is now
    // reached without a user driving it: the account sweep materialises every
    // trip at once, in every open tab, the moment somebody signs in. Two tabs
    // interleaved between the read and the write would each see nothing and
    // each add a row, leaving one server trip showing twice in the list, with
    // two documents and two cursors behind it.
    //
    // IndexedDB serialises readwrite transactions over the same store across
    // connections, so this is a real lock between tabs and not merely a tidier
    // way to write the same race. The network fetch above stays outside it —
    // holding a Dexie transaction open across a round trip would block every
    // other writer for as long as the server takes.
    return await db.transaction('rw', db.trips, async (): Promise<JoinTripResult> => {
      // Resolve locally rather than trusting anything in the payload — the same
      // rule the CRDT bridge follows.
      const existing = await db.trips
        .where('remoteTripId')
        .equals(remoteTripId)
        .first();
      if (existing) {
        return { status: 'already-local', tripId: existing.id };
      }

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
    });
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
  client: TypedSupabaseClient,
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
  client: TypedSupabaseClient,
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
