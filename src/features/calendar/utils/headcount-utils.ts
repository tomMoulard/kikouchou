/**
 * @fileoverview Per-day headcounts for the calendar — how many real people are
 * on site each night, so hosts can plan meals and groceries.
 *
 * A guest entry can stand for several people (`Person.headcount`, e.g.
 * "Alice+Auré" = 2), so the people total is not the number of guest rows.
 *
 * @module features/calendar/utils/headcount-utils
 */

import {
  isGuestOnSiteOnDate,
  type TripStayWindow,
} from '@/features/persons/utils/guest-presence';
import { getPersonHeadcount } from '@/types';
import type { ISODateString, Person, RoomAssignment, Transport } from '@/types';

// ============================================================================
// Types
// ============================================================================

/**
 * Headcount for a single calendar night.
 */
export interface DailyHeadcount {
  /** Number of guest entries present that night */
  readonly guests: number;
  /** Number of real people present that night (sum of guest headcounts) */
  readonly people: number;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Re-exported so calendar code can ask about presence without reaching across
 * features. There is exactly one implementation — see
 * `features/persons/utils/guest-presence`.
 */
export { isGuestOnSiteOnDate };

/**
 * Maps each requested calendar day to the guests and people present that night.
 *
 * Days with nobody on site are omitted from the map — callers should treat a
 * missing key as zero.
 *
 * @example
 * ```typescript
 * // Tom (headcount 1) and "Alice+Auré" (headcount 2) both staying tonight
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
        !isGuestOnSiteOnDate({
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
