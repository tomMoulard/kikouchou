/**
 * @fileoverview Spots a travel time that moved since this device last showed it.
 *
 * `Transport` carries no `createdAt`, no `updatedAt` and no history, so "Alice
 * moved her pickup from 17:00 to 19:00" is not a fact any record states. It is
 * only ever a *difference* — between the time this phone last showed the user
 * and the time the document now holds — and that difference lives in
 * `rideNotices`, device-local, because two phones open the app on different
 * days and genuinely have different news.
 *
 * Three rules fall out of that, and each of them is a bug somebody would
 * otherwise ship:
 *
 * 1. **No watermark is not a change.** A leg this device has never seen is
 *    *new*, not moved. Reporting "Alice moved her pickup" the first time the
 *    app opens would be a lie, so those legs are counted separately as
 *    {@link UseRideChangesResult.unwatchedCount} and reported as nothing.
 * 2. **Instants, never strings.** `2026-07-15T14:00:00+02:00` sorts *after*
 *    `2026-07-15T13:00:00Z` and happens an hour *before* it, so both sides go
 *    through {@link toTransportInstant}. A value that cannot be parsed is never
 *    reported as a change: we cannot prove it moved, and a row we cannot read
 *    must not accuse its passenger.
 * 3. **The watermark advances on an acknowledgement, never on a render.**
 *    Advancing it when a card merely mounts means a change that arrived while
 *    the phone was in a pocket is marked read.
 *
 * The audience is the car, not the trip. A time change reaches the ride's
 * driver and the car-mates — everybody standing at the same station, which now
 * leaves at a different hour — and nobody else. That predicate already exists
 * as `rideConcernsPerson`; this hook does not re-derive it.
 *
 * @module features/transports/hooks/useRideChanges
 */

import { useCallback, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import {
  rideConcernsPerson,
  resolveRides,
  type ResolvedRide,
} from '@/features/transports/utils/ride-model';
import { toTransportInstant } from '@/features/transports/utils/pickup-utils';
import { useTripIdentity } from '@/hooks';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRideContext } from '@/contexts/RideContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { useTripContext } from '@/contexts/TripContext';
import {
  getRideNotices,
  markTransportSeen,
  rideNoticeKey,
  type RideNoticeRow,
} from '@/lib/db';
import type { Person, Transport, TransportId, TripId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** One leg whose time differs from what this device last showed the user. */
export interface RideChange {
  /** The leg, as the document now holds it. */
  readonly transport: Transport;
  /**
   * The traveller, when the trip still holds them.
   *
   * A leg whose guest has been removed still reports. Somebody moved a train
   * whether or not their row survived, and dropping the entry would leave the
   * car-mates waiting at the old time with nothing on screen to say why.
   */
  readonly person: Person | undefined;
  /** The time this device last showed, ISO 8601 — the "was". */
  readonly seenDatetime: string;
  /** The time the document now holds, ISO 8601 — the "now". */
  readonly datetime: string;
  /** True when the leg moved later, false when it moved earlier. */
  readonly movedLater: boolean;
  /** The car this leg travels in, so a view can name what is affected. */
  readonly journey: ResolvedRide;
}

/** What {@link useRideChanges} hands a view. */
export interface UseRideChangesResult {
  /** Moved legs in the identified guest's cars, soonest first. */
  readonly changes: readonly RideChange[];
  /**
   * True until every source has answered.
   *
   * Distinct from `changes.length === 0`, which conflates "still loading" with
   * "nothing has moved" — a feed that could not tell them apart would flash
   * empty on every navigation.
   */
  readonly isLoading: boolean;
  /**
   * Legs in scope this device holds no usable watermark for.
   *
   * These are reported as nothing, by rule 1 above, which also means nothing
   * would *ever* be reported until a first watermark exists. Surfacing the
   * count lets a view offer that first acknowledgement explicitly instead of
   * taking it on the user's behalf at mount.
   */
  readonly unwatchedCount: number;
  /** Records the time shown for one leg, so it is not reported again. */
  readonly acknowledge: (transportId: TransportId) => Promise<void>;
  /** Records the time shown for every leg in scope, changed or not. */
  readonly acknowledgeAll: () => Promise<void>;
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Keeps only the rows belonging to one trip.
 *
 * Every context this hook reads answers `isLoading: false` the moment its own
 * first query lands, and `useLiveQuery` keeps its previous result across a deps
 * change — so immediately after a trip switch they hand back the *previous*
 * trip's rows while claiming to be loaded. Nothing downstream can tell, and the
 * consequence is not merely a stale render: an acknowledgement would write a
 * `rideNotices` row keyed on one trip's leg and tagged with another trip's id,
 * which the first trip's `deleteTrip` cascade can never reclaim.
 *
 * Filtering rather than tagging because it is the same cost and states the
 * invariant locally: nothing here reasons about a row from another trip.
 *
 * @param rows - Rows from a context, possibly from the trip just left
 * @param tripId - The trip on screen
 * @returns The rows that belong to it
 */
function ofTrip<T extends { readonly tripId: TripId }>(
  rows: readonly T[],
  tripId: TripId | undefined,
): readonly T[] {
  return tripId === undefined ? [] : rows.filter((row) => row.tripId === tripId);
}

/** Orders changes the way a passenger reads them: soonest departure first. */
function sortChanges(changes: RideChange[]): RideChange[] {
  return changes.sort((left, right) => {
    const leftAt = toTransportInstant(left.datetime) ?? 0,
      rightAt = toTransportInstant(right.datetime) ?? 0;

    return leftAt === rightAt
      ? left.transport.id.localeCompare(right.transport.id)
      : leftAt - rightAt;
  });
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Reports the legs in this guest's cars whose time moved since they last looked.
 *
 * Must be used within `TripProvider`, `PersonProvider`, `TransportProvider` and
 * `RideProvider`.
 *
 * @returns The change feed, its loading state and the acknowledgements
 *
 * @example
 * ```tsx
 * const { changes, isLoading, acknowledge } = useRideChanges();
 * if (isLoading) { return null; }
 * return changes.map((change) => (
 *   <li key={change.transport.id}>
 *     {change.person?.name} — {change.seenDatetime} → {change.datetime}
 *   </li>
 * ));
 * ```
 */
export function useRideChanges(): UseRideChangesResult {
  const { currentTrip } = useTripContext();
  const { persons, isLoading: isPersonsLoading } = usePersonContext();
  const { transports, isLoading: isTransportsLoading } = useTransportContext();
  const { rides, vehicles, isLoading: isRidesLoading } = useRideContext();
  const { myPersonId, isResolved } = useTripIdentity();
  const tripId = currentTrip?.id;

  // `undefined` while the first read is in flight, which is what separates
  // "loading" from "this device has watermarked nothing". Dexie observes the
  // table, so an acknowledgement re-runs this and the entry leaves the feed.
  //
  // Tagged with the trip it was read for, and discarded when they disagree —
  // the same guard `useTripIdentity` and `YjsTripSync` carry, for the same
  // reason. `useLiveQuery` keeps its previous result across a deps change, so
  // between switching trips and the new read landing this would otherwise
  // weigh one trip's legs against another trip's watermarks and report every
  // one of them as never seen.
  const tagged = useLiveQuery(
    async (): Promise<{
      readonly tripId: TripId | undefined;
      readonly notices: ReadonlyMap<string, RideNoticeRow>;
    }> => ({
      tripId,
      notices: tripId === undefined ? new Map() : await getRideNotices(tripId),
    }),
    [tripId],
  );
  const notices = tagged !== undefined && tagged.tripId === tripId
    ? tagged.notices
    : undefined;

  // The audience rule, applied once: the ride's driver and its car-mates.
  const myJourneys = useMemo(
    () =>
      resolveRides({
        transports: ofTrip(transports, tripId),
        rides: ofTrip(rides, tripId),
        vehicles: ofTrip(vehicles, tripId),
        persons: ofTrip(persons, tripId),
      }).filter((journey) => rideConcernsPerson(journey, myPersonId)),
    [myPersonId, persons, rides, transports, tripId, vehicles],
  );

  const { changes, unwatchedCount, watermarks } = useMemo(() => {
    const found: RideChange[] = [];
    // What each leg's watermark would become if acknowledged now — the value
    // that is *on screen*, not whatever the document holds by the time the
    // button is pressed. Acknowledging a card the user never saw is the same
    // mistake as advancing on render.
    const shown = new Map<TransportId, string>();
    let unwatched = 0;

    if (notices === undefined) {
      return { changes: found, unwatchedCount: unwatched, watermarks: shown };
    }

    for (const journey of myJourneys) {
      for (const leg of journey.legs) {
        const { transport } = leg;
        const at = toTransportInstant(transport.datetime);

        // Unreadable now: not a change, and not something to watermark either
        // — a watermark it could never be compared against would only keep the
        // leg out of `unwatchedCount` forever.
        if (at === null) {
          continue;
        }

        shown.set(transport.id, transport.datetime);

        const seenDatetime = notices.get(
          rideNoticeKey('moved', transport.id),
        )?.seenDatetime;
        const seenAt =
          seenDatetime === undefined ? null : toTransportInstant(seenDatetime);

        // No row, or a row this device can no longer read. Either way there is
        // no time to have moved *from*, so nothing is reported and the leg
        // counts as unwatched — which is what lets the next acknowledgement
        // repair it.
        if (seenDatetime === undefined || seenAt === null) {
          unwatched += 1;
          continue;
        }

        if (seenAt === at) {
          continue;
        }

        found.push({
          transport,
          person: leg.person,
          seenDatetime,
          datetime: transport.datetime,
          movedLater: at > seenAt,
          journey,
        });
      }
    }

    return {
      changes: sortChanges(found),
      unwatchedCount: unwatched,
      watermarks: shown,
    };
  }, [myJourneys, notices]);

  const acknowledge = useCallback(
    async (transportId: TransportId): Promise<void> => {
      const datetime = watermarks.get(transportId);

      if (tripId === undefined || datetime === undefined) {
        return;
      }

      await markTransportSeen(tripId, transportId, datetime);
    },
    [tripId, watermarks],
  );

  const acknowledgeAll = useCallback(async (): Promise<void> => {
    if (tripId === undefined) {
      return;
    }

    for (const [transportId, datetime] of watermarks) {
      await markTransportSeen(tripId, transportId, datetime);
    }
  }, [tripId, watermarks]);

  return useMemo(
    () => ({
      changes,
      isLoading:
        notices === undefined ||
        !isResolved ||
        isPersonsLoading ||
        isRidesLoading ||
        isTransportsLoading,
      unwatchedCount,
      acknowledge,
      acknowledgeAll,
    }),
    [
      acknowledge,
      acknowledgeAll,
      changes,
      isPersonsLoading,
      isResolved,
      isRidesLoading,
      isTransportsLoading,
      notices,
      unwatchedCount,
    ],
  );
}
