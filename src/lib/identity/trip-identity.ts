/**
 * @fileoverview "Which of these guests am I?" — one answer, three sources.
 *
 * Nothing in this app knew whose phone it was running on. Two half-mechanisms
 * existed and neither was readable as an answer:
 *
 * - The **share-link wizard** writes `{ personId, tripId }` to `localStorage`
 *   when a guest picks their name (`lib/sharing/guest-identity`). It only ever
 *   covers someone who arrived through a link, so the trip's own organiser —
 *   who never opens their own share link — had no identity at all.
 * - The **invite/account flow** writes a claim to `trip_members.person_id` on
 *   the server (`lib/sync/join-trip`). That claim was written and then never
 *   read back: `db.tripMembers` is declared, indexed, cascaded, and until now
 *   nothing wrote a single row to it.
 *
 * So this module resolves them in precedence order and adds the missing third:
 * an explicit choice, for the organiser and for anyone who wants to correct the
 * other two.
 *
 * 1. `AppSettings.myPersonIdByTripId` — what the user said, in Settings.
 * 2. The share-link identity for this trip.
 * 3. The account's claimed participant, from the cached membership row.
 *
 * The answer is **device-local at every level**, including the third: the
 * server row says which account claimed a participant, and reading it back only
 * tells this device what it already agreed to. Nothing here is ever written
 * into the trip document, because who is holding a phone is not a fact about
 * the trip.
 *
 * @module lib/identity/trip-identity
 */

import { db } from '@/lib/db/database';
import { getMyPersonId } from '@/lib/db';
import { getTripGuestPersonId } from '@/lib/sharing/guest-identity';
import type { PersonId, ShareId, Trip, TripId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** Where a resolved identity came from, so the UI can explain itself. */
export type TripIdentitySource = 'explicit' | 'shareLink' | 'account';

/** The resolved answer to "who is holding this device, on this trip". */
export interface TripIdentity {
  /** The guest this device is, or undefined when nobody has said. */
  readonly personId: PersonId | undefined;
  /** Which source answered, or undefined when none did. */
  readonly source: TripIdentitySource | undefined;
}

/** The minimum a caller must hold to resolve an identity. */
export type IdentifiableTrip = {
  readonly id: TripId;
  readonly shareId: ShareId;
};

// ============================================================================
// Constants
// ============================================================================

/** The answer when nobody has said who they are. */
export const UNKNOWN_TRIP_IDENTITY: TripIdentity = {
  personId: undefined,
  source: undefined,
};

// ============================================================================
// Resolution
// ============================================================================

/**
 * Resolves who is holding this device, for one trip.
 *
 * Precedence is the point: an explicit choice always wins, because it is the
 * only one the user made deliberately *about this question*. The share-link
 * identity comes next — it was also a deliberate choice, just about a different
 * question ("which name on this list is me") — and the account claim last,
 * being the weakest evidence and the one most likely to be stale after a device
 * is handed on.
 *
 * A source that names a guest the trip no longer holds is **skipped, not
 * returned**. Handing back a dangling id would filter the transport list down
 * to nothing and read to the user as "you have no travel", which is a different
 * and worse claim than "we do not know who you are".
 *
 * @param trip - The trip to resolve within
 * @param userId - The signed-in account, when there is one
 * @returns The resolved identity, or {@link UNKNOWN_TRIP_IDENTITY}
 *
 * @example
 * ```typescript
 * const { personId } = await resolveTripIdentity(trip, session?.user.id);
 * ```
 */
export async function resolveTripIdentity(
  trip: IdentifiableTrip | null | undefined,
  userId?: string,
): Promise<TripIdentity> {
  if (!trip) {
    return UNKNOWN_TRIP_IDENTITY;
  }

  const candidates: { personId: PersonId; source: TripIdentitySource }[] = [];

  const explicit = await getMyPersonId(trip.id);
  if (explicit !== undefined) {
    candidates.push({ personId: explicit, source: 'explicit' });
  }

  const fromShareLink = getTripGuestPersonId(trip);
  if (fromShareLink !== undefined) {
    candidates.push({ personId: fromShareLink, source: 'shareLink' });
  }

  if (userId !== undefined) {
    const fromAccount = await readClaimedPersonId(trip.id, userId);
    if (fromAccount !== undefined) {
      candidates.push({ personId: fromAccount, source: 'account' });
    }
  }

  for (const candidate of candidates) {
    const person = await db.persons.get(candidate.personId);
    if (person !== undefined && person.tripId === trip.id) {
      return candidate;
    }
  }

  return UNKNOWN_TRIP_IDENTITY;
}

/**
 * Reads the participant this account claimed on a trip, from the local cache.
 *
 * The cache (`db.tripMembers`) is a projection of the server's `trip_members`,
 * which stays authoritative — its unique constraint is what actually stops two
 * accounts claiming the same guest. Reading the projection rather than the
 * server keeps identity resolvable offline, which matters because the whole app
 * is.
 *
 * @param tripId - The local trip id
 * @param userId - The signed-in account
 * @returns The claimed guest id, or undefined
 */
export async function readClaimedPersonId(
  tripId: TripId,
  userId: string,
): Promise<PersonId | undefined> {
  try {
    const row = await db.tripMembers.get([tripId, userId]);
    return row?.personId === undefined ? undefined : (row.personId as PersonId);
  } catch {
    // A read failure is "we do not know", never "nobody". Throwing here would
    // take down whichever view asked, and the caller has a perfectly good
    // fallback: show everything rather than filter to nobody.
    return undefined;
  }
}

/**
 * Caches an account's claim locally, so identity survives a reload offline.
 *
 * Called on the join path right after the server accepts the claim. Until now
 * that claim was written to Postgres and never read back, which is why an
 * account-joined guest had no local sense of being anybody.
 *
 * @param tripId - The local trip id
 * @param userId - The signed-in account
 * @param personId - The participant claimed, or undefined when skipped
 */
export async function cacheClaimedPersonId(
  tripId: TripId,
  userId: string,
  personId: PersonId | undefined,
): Promise<void> {
  try {
    await db.tripMembers.put({
      tripId,
      userId,
      personId,
      joinedAt: Date.now(),
    });
  } catch (error) {
    // Best-effort cache. The server row is authoritative and the identity
    // resolver has two other sources, so failing to cache must not fail a join.
    console.error('[identity] Failed to cache trip membership:', error);
  }
}

/**
 * Narrows a `Trip` to what {@link resolveTripIdentity} needs.
 *
 * Exists so callers holding a full trip do not have to build a literal, and so
 * the resolver's parameter can stay minimal — it is used from tests and from
 * the join path, neither of which has a whole `Trip` to hand.
 *
 * @param trip - A full trip record
 * @returns Its id and share id
 */
export function toIdentifiableTrip(trip: Trip): IdentifiableTrip {
  return { id: trip.id, shareId: trip.shareId };
}
