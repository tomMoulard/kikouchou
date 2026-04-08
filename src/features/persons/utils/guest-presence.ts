/**
 * @fileoverview Derive which guests are “present” on a calendar day from stay dates and transports.
 * Aligns with the check-in / check-out model used for rooms (`isDateInStayRange`).
 *
 * @module features/persons/utils/guest-presence
 */

import { eachDayOfInterval, format, parseISO } from 'date-fns';

import { isDateInStayRange } from '@/features/rooms/utils/capacity-utils';
import type { ISODateString, Person, PersonId, Transport } from '@/types';

// ============================================================================
// Stay bounds
// ============================================================================

/**
 * Resolves arrival and departure calendar dates for a person.
 * Prefers explicit `stayStartDate` / `stayEndDate`; otherwise earliest arrival / latest departure transport day.
 */
export function deriveGuestStayDateBounds(
  person: Person,
  arrivals: readonly Transport[],
  departures: readonly Transport[],
): { readonly arrival: ISODateString | null; readonly departure: ISODateString | null } {
  let arrivalDate: ISODateString | null = person.stayStartDate ?? null;
  let departureDate: ISODateString | null = person.stayEndDate ?? null;

  const personArrivals = arrivals.filter((t) => t.personId === person.id);
  const personDepartures = departures.filter((t) => t.personId === person.id);

  if (!arrivalDate) {
    for (const arrival of personArrivals) {
      const date = arrival.datetime.slice(0, 10) as ISODateString;
      if (!arrivalDate || date < arrivalDate) {
        arrivalDate = date;
      }
    }
  }

  if (!departureDate) {
    for (const departure of personDepartures) {
      const date = departure.datetime.slice(0, 10) as ISODateString;
      if (!departureDate || date > departureDate) {
        departureDate = date;
      }
    }
  }

  return { arrival: arrivalDate, departure: departureDate };
}

/**
 * True if the person is staying overnight on `dateKey` (check-in ≤ dateKey &lt; check-out).
 */
export function isGuestPresentOnDate(
  person: Person,
  arrivals: readonly Transport[],
  departures: readonly Transport[],
  dateKey: ISODateString,
): boolean {
  const { arrival, departure } = deriveGuestStayDateBounds(person, arrivals, departures);
  if (!arrival || !departure || arrival >= departure) {
    return false;
  }
  return isDateInStayRange(arrival, departure, dateKey);
}

/**
 * Guests present on the given calendar day, sorted by existing `persons` order (typically by name).
 */
export function listGuestsPresentOnDate(
  persons: readonly Person[],
  arrivals: readonly Transport[],
  departures: readonly Transport[],
  dateKey: ISODateString,
): readonly Person[] {
  return persons.filter((p) => isGuestPresentOnDate(p, arrivals, departures, dateKey));
}

/**
 * Maps each trip calendar day (inclusive start…inclusive end) to guest IDs present that night.
 * Use for cache keys, batching, or prefetch: `map.get(isoDate)` → ids to load for that day.
 */
export function buildGuestIdsByTripDateMap(
  persons: readonly Person[],
  arrivals: readonly Transport[],
  departures: readonly Transport[],
  tripStartDate: ISODateString,
  tripEndDate: ISODateString,
): ReadonlyMap<ISODateString, readonly PersonId[]> {
  const map = new Map<ISODateString, PersonId[]>();
  const start = parseISO(tripStartDate);
  const end = parseISO(tripEndDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return map;
  }

  for (const d of eachDayOfInterval({ start, end })) {
    const key = format(d, 'yyyy-MM-dd') as ISODateString;
    const ids = persons
      .filter((p) => isGuestPresentOnDate(p, arrivals, departures, key))
      .map((p) => p.id);
    map.set(key, ids);
  }

  return map;
}
