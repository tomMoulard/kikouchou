/**
 * @fileoverview Per-day headcounts for the calendar — how many real people are
 * on site each day, so hosts can plan meals and groceries.
 *
 * Days, not nights: a guest who leaves on the 13th eats breakfast there on the
 * 13th. The night rule (`isGuestOnSiteOnDate`) answers who has a bed, and it
 * still answers the sidebar's “guests tonight” list and the room maths.
 *
 * A guest entry can stand for several people (`Person.headcount`, e.g.
 * "Alice+Auré" = 2), so the people total is not the number of guest rows.
 *
 * @module features/calendar/utils/headcount-utils
 */

import {
  isGuestOnSiteDuringDay,
  isGuestOnSiteOnDate,
  type TripStayWindow,
} from '@/features/persons/utils/guest-presence';
import { getPersonHeadcount } from '@/types';
import type { ISODateString, Person, RoomAssignment, Transport } from '@/types';

// ============================================================================
// Types
// ============================================================================

/**
 * Headcount for a single calendar day.
 */
export interface DailyHeadcount {
  /** Number of guest entries on site that day */
  readonly guests: number;
  /** Number of real people on site that day (sum of guest headcounts) */
  readonly people: number;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Re-exported so calendar code can ask about presence without reaching across
 * features. There is exactly one implementation of each — see
 * `features/persons/utils/guest-presence`.
 */
export { isGuestOnSiteDuringDay, isGuestOnSiteOnDate };

/**
 * Maps each requested calendar day to the guests and people on site that day.
 *
 * A guest counts on every day of their stay, the day they arrive and the day
 * they leave included. Days with nobody on site are omitted from the map —
 * callers should treat a missing key as zero.
 *
 * @example
 * ```typescript
 * // Tom (headcount 1) and "Alice+Auré" (headcount 2) both on site that day
 * const counts = buildDailyHeadcounts({
 *   persons, arrivals, departures, assignments, tripWindow, dayKeys,
 * });
 * counts.get(todayKey); // { guests: 2, people: 3 }
 * ```
 */
export function buildDailyHeadcounts(args: {
  readonly persons: readonly Person[];
  readonly arrivals: readonly Transport[];
  readonly departures: readonly Transport[];
  readonly assignments: readonly RoomAssignment[];
  /** The trip's dates, standing in for guests who have none of their own. */
  readonly tripWindow: TripStayWindow;
  readonly dayKeys: readonly ISODateString[];
}): ReadonlyMap<ISODateString, DailyHeadcount> {
  const { persons, arrivals, departures, assignments, tripWindow, dayKeys } = args;

  const map = new Map<ISODateString, DailyHeadcount>();
  if (persons.length === 0 || dayKeys.length === 0) {
    return map;
  }

  for (const dateKey of dayKeys) {
    let guests = 0;
    let people = 0;

    for (const person of persons) {
      if (
        !isGuestOnSiteDuringDay({
          person,
          arrivals,
          departures,
          assignments,
          tripWindow,
          dateKey,
        })
      ) {
        continue;
      }
      guests += 1;
      people += getPersonHeadcount(person);
    }

    if (guests > 0) {
      map.set(dateKey, { guests, people });
    }
  }

  return map;
}
