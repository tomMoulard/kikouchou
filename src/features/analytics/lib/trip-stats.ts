/**
 * @fileoverview The single Dexie read behind both analytics pages.
 *
 * `/trips/:tripId/analytics` and `/analytics` used to count the same rows two
 * different ways: the trip page read through `PersonContext` / `RoomContext` /
 * `AssignmentContext` / `TransportContext`, which are scoped to
 * `TripContext.currentTrip`, while the all-trips page read Dexie directly. The
 * contexts lag the URL during a trip switch — `setCurrentTrip` resolves, the
 * live queries re-subscribe, and until the new result arrives the contexts
 * still hand out the previous trip's rows — so walking between the two pages
 * could show two different totals for the same data.
 *
 * Both pages now call {@link loadTripStats}, keyed on the trip id they are
 * actually reporting on, so the numbers cannot disagree. The index ranges below
 * deliberately mirror the ones the contexts use, so an analytics total also
 * matches what the Guests / Rooms / Transport pages list.
 *
 * @module features/analytics/lib/trip-stats
 */

import {
  isTransportUpcoming,
  selectPickupsNeedingDriver,
  toTransportInstant,
} from '@/features/transports/utils/pickup-utils';
import { db } from '@/lib/db/database';
import { getPersonHeadcount } from '@/types';
import type { ISODateTimeString, Transport, TripId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Every number either analytics page shows for one trip, from one read.
 *
 * `guestCount` and `headcount` are deliberately both here: a guest row can
 * stand for a couple or a family, so "how many rows the Guests page lists" and
 * "how many people are coming" are different numbers and the UI must not call
 * them both "Guests".
 */
export interface TripStats {
  /** The trip these numbers describe. */
  readonly tripId: TripId;
  /** Guest rows — what `/trips/:tripId/persons` lists. */
  readonly guestCount: number;
  /** Real people, summing every guest row's headcount. */
  readonly headcount: number;
  /** Rooms in the trip. */
  readonly roomCount: number;
  /** Room assignments in the trip. */
  readonly assignmentCount: number;
  /** Transports of type `arrival`. */
  readonly arrivalCount: number;
  /** Transports of any other type. */
  readonly departureCount: number;
  /** All transports — always `arrivalCount + departureCount`. */
  readonly transportCount: number;
  /** Car journeys arranged for the trip. */
  readonly rideCount: number;
  /** Cars available to the trip. */
  readonly vehicleCount: number;
  /**
   * Upcoming transports flagged `needsPickup` that nobody is driving yet.
   *
   * "Nobody is driving" now spans three arrangements — no ride at all, a ride
   * with no driver, and no legacy `driverId` — which is why the count is taken
   * from `selectPickupsNeedingDriver` with the trip's rides rather than
   * recomputed here.
   */
  readonly pickupsNeedingDriver: number;
}

/** {@link TripStats} summed across trips, for the all-trips page. */
export type TripStatsTotals = Omit<TripStats, 'tripId'>;

/**
 * The outcome of an analytics read.
 *
 * `useLiveQuery` re-throws a rejected querier during render, which hands the
 * failure to the route's `ErrorBoundary` and replaces the whole page. Analytics
 * pages want the in-page `ErrorDisplay` every other list page uses, so the
 * queriers resolve with this instead of rejecting.
 */
export interface AnalyticsResult<TData> {
  /** The data, or `null` when the read failed. */
  readonly data: TData | null;
  /** The failure, or `null` when the read succeeded. */
  readonly error: Error | null;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Upper bound for a string component of a compound index range.
 * Matches the bound the contexts use, so the ranges select the same rows.
 */
const MAX_STRING_KEY = '\uffff';

// ============================================================================
// Reads
// ============================================================================

/**
 * Counts everything the analytics pages show for one trip.
 *
 * @param tripId - The trip to count, taken from the URL rather than from
 *   `currentTrip`, so the page always reports the trip it claims to.
 * @param now - ISO timestamp that separates upcoming pickups from past ones.
 * @returns The trip's counts.
 *
 * @example
 * ```ts
 * const stats = await loadTripStats(tripId, new Date().toISOString());
 * stats.transportCount === stats.arrivalCount + stats.departureCount; // always
 * ```
 */
export async function loadTripStats(
  tripId: TripId,
  now: ISODateTimeString,
): Promise<TripStats> {
  const [persons, roomCount, assignmentCount, transports, rides, vehicleCount] =
    await Promise.all([
      // Same compound ranges as PersonContext / RoomContext /
      // AssignmentContext / TransportContext, so the analytics totals match the
      // feature pages exactly.
      db.persons
        .where('[tripId+name]')
        .between([tripId, ''], [tripId, MAX_STRING_KEY])
        .toArray(),
      db.rooms
        .where('[tripId+order]')
        .between([tripId, 0], [tripId, Infinity])
        .count(),
      db.roomAssignments
        .where('[tripId+startDate]')
        .between([tripId, ''], [tripId, MAX_STRING_KEY])
        .count(),
      db.transports
        .where('[tripId+datetime]')
        .between([tripId, ''], [tripId, MAX_STRING_KEY])
        .toArray(),
      // Read whole rather than counted: "still needs a driver" depends on which
      // rides have one, not on how many there are.
      db.rides
        .where('[tripId+meetDatetime]')
        .between([tripId, ''], [tripId, MAX_STRING_KEY])
        .toArray(),
      db.vehicles.where('tripId').equals(tripId).count(),
    ]);

  // "Count people, not rows" — a guest row can stand for several real people.
  let headcount = 0;
  for (const person of persons) {
    headcount += getPersonHeadcount(person);
  }

  // One reference instant for the whole read, so two transports cannot be
  // measured against two different "now"s.
  const nowMs = toTransportInstant(now) ?? Date.now();

  let arrivalCount = 0;
  let departureCount = 0;
  const upcomingPickups: Transport[] = [];
  for (const transport of transports) {
    if (transport.type === 'arrival') {
      arrivalCount += 1;
    } else {
      departureCount += 1;
    }
    // Rebuilds `TransportContext.upcomingPickups` exactly: same predicate, same
    // instant-based comparison. Comparing the ISO strings, as this used to,
    // mis-reads any row written with a UTC offset instead of a `Z`.
    if (transport.needsPickup && isTransportUpcoming(transport.datetime, nowMs)) {
      upcomingPickups.push(transport);
    }
  }

  // The shared selection the pickup alert panel and the transport list's alert
  // gate use, so the badge here cannot report a number the panel contradicts.
  const pickupsNeedingDriver = selectPickupsNeedingDriver(
    upcomingPickups,
    rides,
  ).length;

  return {
    tripId,
    guestCount: persons.length,
    headcount,
    roomCount,
    assignmentCount,
    arrivalCount,
    departureCount,
    transportCount: transports.length,
    rideCount: rides.length,
    vehicleCount,
    pickupsNeedingDriver,
  };
}

/**
 * Runs an analytics read and turns a failure into a value instead of a throw.
 *
 * @param label - What was being read, for the console line.
 * @param read - The read to run.
 * @returns The data, or the error that stopped it.
 */
export async function readAnalytics<TData>(
  label: string,
  read: () => Promise<TData>,
): Promise<AnalyticsResult<TData>> {
  try {
    return { data: await read(), error: null };
  } catch (error) {
    console.error(`Failed to ${label}:`, error);
    return {
      data: null,
      error: error instanceof Error ? error : new Error(`Failed to ${label}`),
    };
  }
}

// ============================================================================
// Derivations
// ============================================================================

/**
 * Sums per-trip stats into the all-trips totals.
 *
 * @param rows - Per-trip stats.
 * @returns The totals, all zero for an empty list.
 */
export function sumTripStats(rows: readonly TripStats[]): TripStatsTotals {
  return rows.reduce<TripStatsTotals>(
    (totals, row) => ({
      guestCount: totals.guestCount + row.guestCount,
      headcount: totals.headcount + row.headcount,
      roomCount: totals.roomCount + row.roomCount,
      assignmentCount: totals.assignmentCount + row.assignmentCount,
      arrivalCount: totals.arrivalCount + row.arrivalCount,
      departureCount: totals.departureCount + row.departureCount,
      transportCount: totals.transportCount + row.transportCount,
      rideCount: totals.rideCount + row.rideCount,
      vehicleCount: totals.vehicleCount + row.vehicleCount,
      pickupsNeedingDriver:
        totals.pickupsNeedingDriver + row.pickupsNeedingDriver,
    }),
    {
      guestCount: 0,
      headcount: 0,
      roomCount: 0,
      assignmentCount: 0,
      arrivalCount: 0,
      departureCount: 0,
      transportCount: 0,
      rideCount: 0,
      vehicleCount: 0,
      pickupsNeedingDriver: 0,
    },
  );
}

/**
 * Whether a trip has nothing to summarise yet.
 *
 * A grid of zeros reads like a load failure; the page shows an empty state
 * instead. The condition lists every count that is read from a table of its
 * own — guests, rooms, assignments, transports, rides and vehicles — and
 * nothing else. The rest of {@link TripStats} is derived from those reads
 * (`headcount` from the guest rows, `arrivalCount` / `departureCount` /
 * `pickupsNeedingDriver` from the transports), so a derived figure cannot be
 * non-zero while its source is zero and adding it here would say nothing.
 *
 * Rides and vehicles belong in the list for the opposite reason: they are
 * genuinely independent. Cars are entered before anybody's train times are
 * known, so a trip holding two cars and nothing else would otherwise be told
 * it has nothing to add up on a page that was about to show it a 2.
 *
 * @param stats - The trip's stats.
 * @returns True when the trip holds none of the six.
 */
export function isTripStatsEmpty(stats: TripStats): boolean {
  return (
    stats.guestCount === 0 &&
    stats.roomCount === 0 &&
    stats.assignmentCount === 0 &&
    stats.transportCount === 0 &&
    stats.rideCount === 0 &&
    stats.vehicleCount === 0
  );
}
