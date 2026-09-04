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
 * The trip's own dates, used as the stay window of a guest who has none.
 *
 * Required wherever it appears rather than optional: an absent window means
 * “this guest is nowhere”, which is the behaviour this type exists to remove,
 * and a default would let a new call site pick it up again in silence.
 */
export interface TripStayWindow {
  /**
   * First day of the trip — the check-in an undated guest is assumed to make.
   * `undefined` only while the trip itself is unknown (still loading, or dateless),
   * which leaves the guest with no stay window exactly as before.
   */
  readonly startDate: ISODateString | undefined;
  /** Last day of the trip — the check-out an undated guest is assumed to make. */
  readonly endDate: ISODateString | undefined;
}

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
  /** The trip's dates, standing in for a guest who has none of their own. */
  readonly tripWindow: TripStayWindow;
  /** The night in question. */
  readonly dateKey: ISODateString;
}

// ============================================================================
// Stay bounds
// ============================================================================

/**
 * What the guest's *own* records say about their stay: explicit
 * `stayStartDate` / `stayEndDate` first, then earliest arrival / latest
 * departure transport day, and `null` for a bound nothing accounts for.
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
 *
 * Reach for this only where a *stated* stay is the question — clipping a room
 * booking the host typed in, for instance, which a guess must never shorten.
 * To ask where a guest sleeps, use {@link resolveGuestStayWindow}.
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

/**
 * The guest's stay window as the app should read it: their own records, with
 * the trip's dates standing in for whatever they never filled in.
 *
 * Each bound falls back on its own, because the interesting case is the
 * half-known stay: a guest with a flight in and no flight out is here from the
 * day they land until the trip ends, and answering `null` erased them from the
 * timeline, the room maths and “guests tonight” alike. A guest with nothing
 * filled in is therefore taken to be there for the whole trip — the host added
 * them to *this* trip, so the trip is the best-supported guess, and it is the
 * trip whose guest list already shows them.
 *
 * The trip's last day is the check-out, matching what a host types when they do
 * fill the dates in, so the last night covered is the one before it.
 *
 * A trip with blank dates offers no fallback and the bound stays `null`.
 */
export function resolveGuestStayWindow(
  person: Person,
  arrivals: readonly Transport[],
  departures: readonly Transport[],
  tripWindow: TripStayWindow,
): { readonly arrival: ISODateString | null; readonly departure: ISODateString | null } {
  const { arrival, departure } = deriveGuestStayDateBounds(person, arrivals, departures);

  return {
    arrival: arrival ?? (tripWindow.startDate || null),
    departure: departure ?? (tripWindow.endDate || null),
  };
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
  tripWindow: TripStayWindow,
  dateKey: ISODateString,
): boolean {
  const { arrival, departure } = resolveGuestStayWindow(person, arrivals, departures, tripWindow);
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
 *   tripWindow: { startDate: '2026-04-10', endDate: '2026-04-20' },
 *   dateKey: '2026-04-10',
 * }); // true
 * ```
 */
export function isGuestOnSiteOnDate(args: GuestPresenceQuery): boolean {
  const { person, arrivals, departures, assignments, tripWindow, dateKey } = args;

  if (isWithinStayWindow(person, arrivals, departures, tripWindow, dateKey)) {
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
  readonly tripWindow: TripStayWindow;
  readonly dateKey: ISODateString;
}): readonly Person[] {
  const { persons, arrivals, departures, assignments, tripWindow, dateKey } = args;
  return persons.filter((person) =>
    isGuestOnSiteOnDate({ person, arrivals, departures, assignments, tripWindow, dateKey }),
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
  const tripWindow: TripStayWindow = { startDate: tripStartDate, endDate: tripEndDate };

  for (const key of toDayKeys(buildDayColumns(tripStartDate, tripEndDate))) {
    const ids = persons
      .filter((person) =>
        isGuestOnSiteOnDate({
          person,
          arrivals,
          departures,
          assignments,
          tripWindow,
          dateKey: key,
        }),
      )
      .map((p) => p.id);
    map.set(key, ids);
  }

  return map;
}
