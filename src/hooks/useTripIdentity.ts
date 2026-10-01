/**
 * @fileoverview Reactive access to "which guest am I, on this trip".
 *
 * Wraps `lib/identity/trip-identity` in a live query so a view re-renders when
 * the answer changes — the user picks themselves in Settings, or a join
 * completes and caches a claim.
 *
 * @module hooks/useTripIdentity
 */

import { useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { useTripContext } from '@/contexts/TripContext';
import { useAuth } from '@/features/auth/AuthContext';
import { setMyPersonId } from '@/lib/db';
import { db } from '@/lib/db/database';
import {
  resolveTripIdentity,
  UNKNOWN_TRIP_IDENTITY,
  type TripIdentitySource,
} from '@/lib/identity/trip-identity';
import type { PersonId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** What a view gets back when it asks who is holding the device. */
export interface UseTripIdentityResult {
  /** The guest this device is, or undefined when nobody has said. */
  readonly myPersonId: PersonId | undefined;
  /** Which source answered, for a UI that explains where this came from. */
  readonly source: TripIdentitySource | undefined;
  /**
   * True once the answer is settled.
   *
   * Distinct from `myPersonId === undefined`, which conflates "still loading"
   * with "nobody knows" — a filter defaulting to "only mine" while this is
   * false would flash an empty list on every navigation.
   */
  readonly isResolved: boolean;
  /** Records an explicit choice, or clears it with `undefined`. */
  setMyPersonId: (personId: PersonId | undefined) => Promise<void>;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Returns the guest this device belongs to on the current trip.
 *
 * Must be used within `TripProvider` and `AuthProvider`.
 *
 * @returns The resolved identity and a setter for the explicit choice
 *
 * @example
 * ```tsx
 * const { myPersonId, isResolved } = useTripIdentity();
 * const visible = isResolved && myPersonId !== undefined && scope === 'mine'
 *   ? journeys.filter((journey) => rideConcernsPerson(journey, myPersonId))
 *   : journeys;
 * ```
 */
export function useTripIdentity(): UseTripIdentityResult {
  const { currentTrip } = useTripContext(),
    { user } = useAuth(),
    tripId = currentTrip?.id,
    shareId = currentTrip?.shareId,
    userId = user?.id,
    // Tagged with the trip it was read for, and discarded when they disagree.
    //
    // `useLiveQuery` keeps its previous result across a deps change —
    // `useObservable` only seeds while `hasResult` is false, and it has been
    // true since the first trip — so between switching trips and the new query
    // emitting, this would otherwise hand back the *previous* trip's guest with
    // `isResolved: true`. `resolveTripIdentity` refuses to return a guest the
    // trip does not hold, but that check ran against the old trip. A reader
    // filtering "only mine" would empty the new trip; a writer would stamp the
    // old trip's person id onto the new trip's ride. `YjsTripSync` carries the
    // same guard, for the same reason, after the same class of bug moved one
    // trip's guests into another.
    tagged = useLiveQuery(async () => {
      if (tripId === undefined || shareId === undefined) {
        return { tripId, identity: UNKNOWN_TRIP_IDENTITY };
      }

      // Touched so Dexie re-runs this query when the settings singleton or a
      // membership row changes. Without a read of each table the live query has
      // nothing to observe, and picking yourself in Settings would not reach
      // the transport list until a reload.
      //
      // The share-link identity is the one source this cannot watch: it lives
      // in `localStorage`, which Dexie has no way to observe. That is fine in
      // practice because the wizard navigates immediately after writing it, so
      // every subsequent mount reads the new value — but a component that
      // stayed mounted across that write would not see it.
      await db.settings.get('settings');
      await db.tripMembers.where('tripId').equals(tripId).toArray();

      return {
        tripId,
        identity: await resolveTripIdentity({ id: tripId, shareId }, userId),
      };
    }, [tripId, shareId, userId]),
    identity = tagged !== undefined && tagged.tripId === tripId
      ? tagged.identity
      : undefined,
    setIdentity = useCallback(
      async (personId: PersonId | undefined): Promise<void> => {
        if (tripId === undefined) {
          return;
        }
        await setMyPersonId(tripId, personId);
      },
      [tripId],
    );

  return {
    myPersonId: identity?.personId,
    source: identity?.source,
    isResolved: identity !== undefined,
    setMyPersonId: setIdentity,
  };
}
