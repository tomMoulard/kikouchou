/**
 * @fileoverview The single answer to “is this guest here on this night?”.
 *
 * A guest is on site when their stay window covers the night — from explicit
 * stay dates, or failing that from their arrival/departure transports — **or**
 * when a room assignment covers it. The room clause matters: a host can give
 * someone a bed without ever filling in stay dates or travel details, and that
 * guest is unmistakably there. Leaving them out made the sidebar's “guests
 * tonight” list disagree with the calendar's headcount for the same night.
 *
 * Aligns with the check-in / check-out model used for rooms
 * (`isDateInStayRange`): check-in inclusive, check-out exclusive.
 *
 * @module features/persons/utils/guest-presence
 */

import { isDateInStayRange } from '@/features/rooms/utils/capacity-utils';
import {
  buildDayColumns,
  localDayKeyOfInstant,
  toDayKeys,
} from '@/lib/utils/trip-days';
import type {
  ISODateString,
  Person,
  PersonId,
  RoomAssignment,
  Transport,
} from '@/types';

// ============================================================================
// Types
// ============================================================================

/**
 * Everything needed to decide whether one guest sleeps on one calendar night.
 *
 * `assignments` is required rather than optional on purpose: an optional list
 * silently defaults to “no rooms”, which is exactly the narrower definition
 * this module exists to remove.
 */
export interface GuestPresenceQuery {
  /** The guest being asked about. */
  readonly person: Person;
  /** Arrival transports for the whole trip (filtered internally). */
  readonly arrivals: readonly Transport[];
  /** Departure transports for the whole trip (filtered internally). */
  readonly departures: readonly Transport[];
  /** Room assignments for the whole trip (filtered internally). */
  readonly assignments: readonly RoomAssignment[];
  /** The night in question. */
  readonly dateKey: ISODateString;
}

// ============================================================================
// Stay bounds
// ============================================================================

/**
 * Resolves arrival and departure calendar dates for a person.
 * Prefers explicit `stayStartDate` / `stayEndDate`; otherwise earliest arrival / latest departure transport day.
 *
 * Stay dates are already local day keys — `PersonForm` writes them from a date
 * picker. Transports are not: they are stored as UTC instants
 * (`new Date(datetimeLocalInput).toISOString()`), so their day has to be *read*
 * with `localDayKeyOfInstant` rather than sliced off the front of the string.
 * A 00:30 arrival in Paris is stored at 22:30Z the evening before, and slicing
 * started that guest's stay a day early — the timeline drew them a column left
 * of where they land and the room maths charged them an extra night.
 *
 * Transports whose datetime will not parse are skipped: a bound derived from an
 * unreadable instant is worse than no bound at all, because it silently wins the
 * min/max comparison.
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
      const date = localDayKeyOfInstant(arrival.datetime);
      if (date && (!arrivalDate || date < arrivalDate)) {
        arrivalDate = date;
      }
    }
  }

  if (!departureDate) {
    for (const departure of personDepartures) {
      const date = localDayKeyOfInstant(departure.datetime);
      if (date && (!departureDate || date > departureDate)) {
        departureDate = date;
      }
    }
  }

  return { arrival: arrivalDate, departure: departureDate };
}

// ============================================================================
// Presence
// ============================================================================

/**
 * True if the guest's stay window covers `dateKey` (check-in ≤ dateKey &lt; check-out).
 *
 * Internal: the stay window is only half the story — a guest with a bed and no
 * stay dates is still on site. Callers want {@link isGuestOnSiteOnDate}.
 */
function isWithinStayWindow(
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
 * True if the guest sleeps on `dateKey`, from either their stay window
 * (explicit dates or transports) or a room assignment covering that night.
 *
 * This is the app's one definition of presence. The sidebar's “guests tonight”
 * list and the calendar's per-day headcounts both read it, so they always name
 * the same people.
 *
 * @example
 * ```typescript
 * // No stay dates, no transports — but a bed for the night: on site.
 * isGuestOnSiteOnDate({
 *   person,
 *   arrivals: [],
 *   departures: [],
 *   assignments: [{ personId: person.id, startDate: '2026-04-10', endDate: '2026-04-12' }],
 *   dateKey: '2026-04-10',
 * }); // true
 * ```
 */
export function isGuestOnSiteOnDate(args: GuestPresenceQuery): boolean {
  const { person, arrivals, departures, assignments, dateKey } = args;

  if (isWithinStayWindow(person, arrivals, departures, dateKey)) {
    return true;
  }

  return assignments.some(
    (a) => a.personId === person.id && isDateInStayRange(a.startDate, a.endDate, dateKey),
  );
}

/**
 * Guests on site on the given calendar day, sorted by existing `persons` order (typically by name).
 */
export function listGuestsOnSiteOnDate(args: {
  readonly persons: readonly Person[];
  readonly arrivals: readonly Transport[];
  readonly departures: readonly Transport[];
  readonly assignments: readonly RoomAssignment[];
  readonly dateKey: ISODateString;
}): readonly Person[] {
  const { persons, arrivals, departures, assignments, dateKey } = args;
  return persons.filter((person) =>
    isGuestOnSiteOnDate({ person, arrivals, departures, assignments, dateKey }),
  );
}

/**
 * Maps each trip calendar day (inclusive start…inclusive end) to guest IDs on site that night.
 * Use for cache keys, batching, or prefetch: `map.get(isoDate)` → ids to load for that day.
 */
export function buildGuestIdsByTripDateMap(args: {
  readonly persons: readonly Person[];
  readonly arrivals: readonly Transport[];
  readonly departures: readonly Transport[];
  readonly assignments: readonly RoomAssignment[];
  readonly tripStartDate: ISODateString;
  readonly tripEndDate: ISODateString;
}): ReadonlyMap<ISODateString, readonly PersonId[]> {
  const { persons, arrivals, departures, assignments, tripStartDate, tripEndDate } = args;

  const map = new Map<ISODateString, PersonId[]>();

  // `buildDayColumns` owns the day axis: it rejects unparseable or inverted
  // bounds and hands back keys in the same local convention the callers ask
  // with, so this module never names a date converter of its own.
  for (const key of toDayKeys(buildDayColumns(tripStartDate, tripEndDate))) {
    const ids = persons
      .filter((person) =>
        isGuestOnSiteOnDate({ person, arrivals, departures, assignments, dateKey: key }),
      )
      .map((p) => p.id);
    map.set(key, ids);
  }

  return map;
}
