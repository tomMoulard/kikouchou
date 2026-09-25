/**
 * @fileoverview How many nights each guest slept there, which is the one number
 * a rent split needs.
 *
 * The trip description field invites a Tricount link, and the group then counts
 * the nights by hand off the calendar. The app already holds every stay, so it
 * can hand out the counts instead: this read turns the stays into one row per
 * guest with their nights, the people that guest row stands for, and their
 * share of the total.
 *
 * Two rules decide a number here, and both come from elsewhere in the app so
 * this page cannot contradict the rooms timeline it was read from:
 *
 * - a *night* is `listStayNights`' night, check-in inclusive and check-out
 *   exclusive, so a guest booked the 1st to the 3rd slept two nights;
 * - a guest is on site for a night when `isGuestOnSiteOnDate` says so, which
 *   reads their stay dates, their transports and their room bookings, and falls
 *   back on the trip's own dates for a guest who filled in nothing.
 *
 * Only the trip's own nights are counted. A stay typed one week too wide would
 * otherwise charge its guest for nights the house was not rented for.
 *
 * Like `loadTripSummary`, the read is keyed on the trip id in the URL rather
 * than on `currentTrip`, which lags the URL during a trip switch.
 *
 * @module features/money/lib/night-split
 */

import { isGuestOnSiteOnDate } from '@/features/persons/utils/guest-presence';
import type { TripStayWindow } from '@/features/persons/utils/guest-presence';
import { listStayNights } from '@/features/rooms/utils/capacity-utils';
import { db } from '@/lib/db/database';
import { getPersonHeadcount } from '@/types';
import type { ISODateString, Person, PersonId, TripId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * One guest row and the nights it accounts for.
 */
export interface NightSplitGuest {
  /** The guest, used as the render key. */
  readonly personId: PersonId;
  /** Display name. */
  readonly name: string;
  /** How many real people this guest row stands for. */
  readonly headcount: number;
  /** Nights of the trip this guest slept there. */
  readonly nights: number;
  /** `nights` times `headcount`: the unit a rent split divides by. */
  readonly personNights: number;
  /**
   * This row's fraction of the trip's person nights, between 0 and 1.
   *
   * Zero for everybody when nobody slept anywhere, which is a real trip: a
   * group that books one day out has no nights to split.
   */
  readonly share: number;
}

/**
 * The night counts of one trip, ready to divide a bill by.
 */
export interface TripNightSplit {
  /** The trip these counts describe. */
  readonly tripId: TripId;
  /** Trip name. */
  readonly name: string;
  /** First day of the trip. */
  readonly startDate: ISODateString;
  /** Last day of the trip, the check-out morning. */
  readonly endDate: ISODateString;
  /** Nights the house was rented for. */
  readonly nights: number;
  /** Every guest's nights added up, weighted by headcount. */
  readonly personNights: number;
  /** One row per guest, longest stay first, then by name. */
  readonly guests: readonly NightSplitGuest[];
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Upper bound for a string component of a compound index range.
 * Matches the bound the other trip reads use, so the ranges select the same rows.
 */
const MAX_STRING_KEY = '\uffff';

// ============================================================================
// Reads
// ============================================================================

/**
 * Counts each guest's nights on one trip.
 *
 * @param tripId - The trip to count, taken from the URL
 * @returns The counts, or `null` when no trip carries that id
 *
 * @example
 * ```ts
 * const split = await loadTripNightSplit(tripId);
 * split?.guests[0]?.personNights; // nights × people, for the biggest payer
 * ```
 */
export async function loadTripNightSplit(
  tripId: TripId,
): Promise<TripNightSplit | null> {
  const trip = await db.trips.get(tripId);
  if (trip === undefined) {
    return null;
  }

  const [persons, assignments, transports] = await Promise.all([
    db.persons
      .where('[tripId+name]')
      .between([tripId, ''], [tripId, MAX_STRING_KEY])
      .toArray(),
    db.roomAssignments
      .where('[tripId+startDate]')
      .between([tripId, ''], [tripId, MAX_STRING_KEY])
      .toArray(),
    db.transports
      .where('[tripId+datetime]')
      .between([tripId, ''], [tripId, MAX_STRING_KEY])
      .toArray(),
  ]);

  const arrivals = transports.filter((transport) => transport.type === 'arrival');
  const departures = transports.filter((transport) => transport.type !== 'arrival');
  const tripWindow: TripStayWindow = {
    startDate: trip.startDate,
    endDate: trip.endDate,
  };

  // The nights the house was rented for. Everything below is counted inside
  // this list, so a stay typed wider than the trip cannot charge its guest for
  // a night nobody paid rent on.
  const tripNights = listStayNights(trip.startDate, trip.endDate) as readonly ISODateString[];

  const counted = persons.map((person: Person) => {
    let nights = 0;
    for (const dateKey of tripNights) {
      if (
        isGuestOnSiteOnDate({
          person,
          arrivals,
          departures,
          assignments,
          tripWindow,
          dateKey,
        })
      ) {
        nights += 1;
      }
    }

    const headcount = getPersonHeadcount(person);
    return {
      personId: person.id,
      name: person.name,
      headcount,
      nights,
      personNights: nights * headcount,
    };
  });

  let personNights = 0;
  for (const guest of counted) {
    personNights += guest.personNights;
  }

  const guests: NightSplitGuest[] = counted
    .map((guest) => ({
      ...guest,
      share: personNights === 0 ? 0 : guest.personNights / personNights,
    }))
    // Biggest payer first: the row somebody checks is the one that owes most.
    .sort(
      (left, right) =>
        right.personNights - left.personNights || left.name.localeCompare(right.name),
    );

  return {
    tripId: trip.id,
    name: trip.name,
    startDate: trip.startDate,
    endDate: trip.endDate,
    nights: tripNights.length,
    personNights,
    guests,
  };
}
