/**
 * @fileoverview The single answer to “is this guest here?”, asked of a night or
 * of a day.
 *
 * A guest is on site when their stay window covers the night — from explicit
 * stay dates, or failing that from their arrival/departure transports — **or**
 * when a room assignment covers it. The room clause matters: a host can give
 * someone a bed without ever filling in stay dates or travel details, and that
 * guest is unmistakably there. Leaving them out made the sidebar's “guests
 * tonight” list disagree with the calendar's headcount for the same night.
 *
 * Two questions are asked of those same records, and they are not the same
 * question:
 *
 * - `isGuestOnSiteOnDate` — does the guest sleep here on this night? Check-in
 *   inclusive, check-out exclusive, matching the rooms model
 *   (`isDateInStayRange`). Beds and “guests tonight” read this.
 * - `isGuestOnSiteDuringDay` — is the guest here at some point on this day?
 *   Both ends included. Meal planning reads this, because a guest who leaves on
 *   the 13th has breakfast on the 13th.
 *
 * They differ on the check-out day alone. Pick by what the answer feeds: a bed
 * that can be given to somebody else that night, or a person who is in the
 * house that morning.
 *
 * ## A guest can stay several times
 *
 * A guest's stay is a list of periods, not one span: the first three weeks of
 * July, again in August, the last week of September. {@link resolveGuestStayPeriods}
 * is the one reader. Stated stays win (`stayStartDate`/`stayEndDate` as the
 * first, `extraStays` after it); a guest with none is read from their travel,
 * each arrival paired with the next departure; a guest with no travel either
 * stays for the whole trip. The presence questions ask whether *any* period
 * covers the night or the day, so a guest between two stays is not here.
 *
 * @module features/persons/utils/guest-presence
 */

import { isDateInStayRange } from '@/features/rooms/utils/capacity-utils';
import { normalizeExtraStays } from '@/lib/db/sanitize';
import {
  buildDayColumns,
  localDayKeyOfInstant,
  toDayKeys,
} from '@/lib/utils/trip-days';
import type {
  GuestStayPeriod,
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
 * One stay of a guest as the app reads it: each bound may be unknown (`null`)
 * when neither the guest's records nor the trip say it.
 */
export interface ResolvedStayPeriod {
  readonly arrival: ISODateString | null;
  readonly departure: ISODateString | null;
}

/**
 * The guest's further stays (`extraStays`), as usable periods: both bounds a
 * calendar day, the check-out on or after the check-in, sorted by check-in.
 * See `normalizeExtraStays`, which the sync bridge applies on the way in too.
 *
 * @param person - The guest
 * @returns The usable further stays, earliest first
 */
export function listExtraStayPeriods(person: Pick<Person, 'extraStays'>): GuestStayPeriod[] {
  return normalizeExtraStays(person.extraStays);
}

/**
 * Every stay the guest *stated*: the first (`stayStartDate` → `stayEndDate`)
 * when both of its dates are set, then the further ones. Sorted by check-in.
 *
 * Only what was typed: no travel, no trip. Reach for this to show or edit the
 * stays; to ask where the guest is, use {@link resolveGuestStayPeriods}.
 *
 * @param person - The guest
 * @returns The stated stays, earliest first
 */
export function listStatedStayPeriods(
  person: Pick<Person, 'stayStartDate' | 'stayEndDate' | 'extraStays'>,
): GuestStayPeriod[] {
  const periods = listExtraStayPeriods(person);
  if (
    person.stayStartDate &&
    person.stayEndDate &&
    person.stayStartDate <= person.stayEndDate
  ) {
    periods.push({ startDate: person.stayStartDate, endDate: person.stayEndDate });
  }
  return periods.sort((left, right) => left.startDate.localeCompare(right.startDate));
}

/**
 * The guest's stays read from their travel: each arrival opens a stay and the
 * next departure closes it.
 *
 * - A second arrival while a stay is open is a connecting leg, not a new stay.
 * - A departure with no open stay extends the previous stay (a second leg
 *   home), or, before any arrival, closes a stay whose start is unknown.
 * - An arrival never followed by a departure leaves the end unknown.
 *
 * Days are read with `localDayKeyOfInstant`, for the reason
 * {@link deriveGuestStayDateBounds} gives; an instant that does not parse is
 * skipped.
 *
 * @param person - The guest
 * @param arrivals - Arrival transports of the trip (filtered here)
 * @param departures - Departure transports of the trip (filtered here)
 * @returns The stays, in time order; empty when the guest has no usable travel
 */
export function pairTransportStays(
  person: Pick<Person, 'id'>,
  arrivals: readonly Transport[],
  departures: readonly Transport[],
): ResolvedStayPeriod[] {
  const events: { readonly at: number; readonly day: ISODateString; readonly kind: 'in' | 'out' }[] = [];
  const collect = (list: readonly Transport[], kind: 'in' | 'out'): void => {
    for (const transport of list) {
      if (transport.personId !== person.id) {
        continue;
      }
      const day = localDayKeyOfInstant(transport.datetime);
      const at = new Date(transport.datetime).getTime();
      if (day && !Number.isNaN(at)) {
        events.push({ at, day, kind });
      }
    }
  };
  collect(arrivals, 'in');
  collect(departures, 'out');
  events.sort((left, right) => left.at - right.at);

  const periods: { arrival: ISODateString | null; departure: ISODateString | null }[] = [];
  let open: { arrival: ISODateString | null; departure: ISODateString | null } | null = null;
  for (const event of events) {
    if (event.kind === 'in') {
      if (open === null) {
        open = { arrival: event.day, departure: null };
        periods.push(open);
      }
      continue;
    }
    if (open !== null) {
      open.departure = event.day;
      open = null;
      continue;
    }
    const previous = periods[periods.length - 1];
    if (previous) {
      previous.departure = event.day;
    } else {
      periods.push({ arrival: null, departure: event.day });
    }
  }
  return periods;
}

/**
 * The guest's stays as the app should read them, each bound falling back on
 * the trip's dates when nothing else says it.
 *
 * 1. Stated stays win. The first stay may be half filled in: a missing bound
 *    comes from the guest's travel (earliest arrival, latest departure) when
 *    it is their only stay, and from the trip otherwise.
 * 2. A guest with no stated stay is read from their travel, one stay per
 *    arrival and departure pair ({@link pairTransportStays}).
 * 3. A guest with neither is taken to be there for the whole trip.
 *
 * The trip's last day is the check-out, matching what a host types when they
 * do fill the dates in. A trip without dates offers no fallback, and a bound
 * nothing accounts for stays `null`.
 *
 * @returns At least one period (possibly all-null), earliest first
 */
export function resolveGuestStayPeriods(
  person: Person,
  arrivals: readonly Transport[],
  departures: readonly Transport[],
  tripWindow: TripStayWindow,
): readonly ResolvedStayPeriod[] {
  const tripStart = tripWindow.startDate || null;
  const tripEnd = tripWindow.endDate || null;
  const extras = listExtraStayPeriods(person);
  const hasFirst = Boolean(person.stayStartDate || person.stayEndDate);

  if (hasFirst || extras.length > 0) {
    const periods: ResolvedStayPeriod[] = extras.map((period) => ({
      arrival: period.startDate,
      departure: period.endDate,
    }));
    if (hasFirst) {
      if (extras.length === 0) {
        // The single-stay case reads exactly as it always did.
        const { arrival, departure } = deriveGuestStayDateBounds(person, arrivals, departures);
        periods.push({ arrival: arrival ?? tripStart, departure: departure ?? tripEnd });
      } else {
        periods.push({
          arrival: person.stayStartDate ?? tripStart,
          departure: person.stayEndDate ?? tripEnd,
        });
      }
    }
    return sortPeriods(periods);
  }

  const paired = pairTransportStays(person, arrivals, departures);
  if (paired.length === 0) {
    return [{ arrival: tripStart, departure: tripEnd }];
  }
  return paired.map((period) => ({
    arrival: period.arrival ?? tripStart,
    departure: period.departure ?? tripEnd,
  }));
}

/** Earliest check-in first; an unknown check-in sorts first. */
function sortPeriods(periods: ResolvedStayPeriod[]): ResolvedStayPeriod[] {
  return periods.sort((left, right) =>
    (left.arrival ?? '').localeCompare(right.arrival ?? ''),
  );
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
 *
 * A guest who stays several times gets the span of all their stays: the
 * earliest check-in to the latest check-out, gaps included. Ask presence
 * through {@link isGuestOnSiteOnDate} or {@link resolveGuestStayPeriods}, which
 * know about the gaps; this span is for sorting and for a window to draw.
 */
export function resolveGuestStayWindow(
  person: Person,
  arrivals: readonly Transport[],
  departures: readonly Transport[],
  tripWindow: TripStayWindow,
): { readonly arrival: ISODateString | null; readonly departure: ISODateString | null } {
  // The span of every stay: the earliest check-in to the latest check-out.
  // For a guest with one stay this is that stay, read as it always was.
  let arrival: ISODateString | null = null;
  let departure: ISODateString | null = null;
  for (const period of resolveGuestStayPeriods(person, arrivals, departures, tripWindow)) {
    if (period.arrival && (arrival === null || period.arrival < arrival)) {
      arrival = period.arrival;
    }
    if (period.departure && (departure === null || period.departure > departure)) {
      departure = period.departure;
    }
  }
  return { arrival, departure };
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
  return resolveGuestStayPeriods(person, arrivals, departures, tripWindow).some(
    ({ arrival, departure }) =>
      arrival !== null &&
      departure !== null &&
      arrival < departure &&
      isDateInStayRange(arrival, departure, dateKey),
  );
}

/**
 * True if the guest sleeps on `dateKey`, from either their stay window
 * (explicit dates or transports) or a room assignment covering that night.
 *
 * This is the app's definition of a *night* on site. The sidebar's “guests
 * tonight” list reads it, and so does every question about beds. To ask who is
 * in the house on a given day — the departure morning included — use
 * {@link isGuestOnSiteDuringDay}.
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
 * True if `dateKey` falls between a check-in and a check-out, both days
 * included.
 *
 * The day counterpart of `isDateInStayRange`, which ends at the check-out
 * because nobody sleeps that night. Day keys sort lexicographically, so string
 * comparison is the date comparison.
 */
function isDateInStayDays(
  startDate: string,
  endDate: string,
  dateKey: string,
): boolean {
  if (!startDate || !endDate || startDate > endDate) {
    return false;
  }
  return startDate <= dateKey && dateKey <= endDate;
}

/**
 * True if the guest is in the house at any point during `dateKey` — from their
 * stay window (explicit dates or transports) or from a room assignment.
 *
 * The same records as {@link isGuestOnSiteOnDate}, read as days rather than
 * nights, so the two differ on exactly one day of a stay: the check-out. A
 * guest booked 11 → 13 sleeps on the 11th and the 12th, and is on site on the
 * 11th, the 12th and the 13th. They eat breakfast there and someone drives them
 * to the station, which is why the headcounts that plan meals read this and the
 * room maths do not.
 *
 * A guest who arrives and leaves on one day sleeps nowhere and is on site that
 * day. That is the other case the night rule cannot express.
 *
 * @example
 * ```typescript
 * // A stay of two nights, and the morning after the second one.
 * isGuestOnSiteDuringDay({
 *   person,
 *   arrivals: [],
 *   departures: [],
 *   assignments: [],
 *   tripWindow: { startDate: '2026-09-11', endDate: '2026-09-13' },
 *   dateKey: '2026-09-13',
 * }); // true
 * ```
 */
export function isGuestOnSiteDuringDay(args: GuestPresenceQuery): boolean {
  const { person, arrivals, departures, assignments, tripWindow, dateKey } = args;

  const inAStay = resolveGuestStayPeriods(person, arrivals, departures, tripWindow).some(
    ({ arrival, departure }) =>
      arrival !== null && departure !== null && isDateInStayDays(arrival, departure, dateKey),
  );
  if (inAStay) {
    return true;
  }

  return assignments.some(
    (a) => a.personId === person.id && isDateInStayDays(a.startDate, a.endDate, dateKey),
  );
}

/**
 * Minutes after local midnight at which a meal is taken to happen.
 *
 * Fixed rather than per meal: they only decide who is counted on the day a
 * guest travels, and a guest landing at 15:00 misses lunch whether lunch is at
 * noon or at one.
 */
export const MEAL_TIME_MINUTES = {
  lunch: 12 * 60 + 30,
  dinner: 19 * 60 + 30,
} as const;

/**
 * Minutes after local midnight of a transport's instant, or null when it does
 * not parse. Read in local time for the reason `deriveGuestStayDateBounds`
 * gives: the instant is stored in UTC and the meal is eaten on the wall clock.
 */
function localMinutesOfInstant(datetime: string): number | null {
  const date = new Date(datetime);
  return Number.isNaN(date.getTime()) ? null : date.getHours() * 60 + date.getMinutes();
}

/**
 * True if the guest is in the house for the meal at `minutes` on `dateKey`.
 *
 * The day rule ({@link isGuestOnSiteDuringDay}) first, then the guest's own
 * transports on that day narrow it: a guest whose arrival that day is after
 * the meal has not arrived yet, and one whose departure that day is before it
 * has already left. A guest with no transport that day eats every meal of the
 * day, which is the honest default when nobody said when they come.
 *
 * Nothing else about the day is guessed. Stay dates and room bookings carry no
 * time, so they never take a guest away from a meal.
 *
 * @example
 * ```typescript
 * // Lands at 15:00 on the 10th: misses lunch, eats dinner.
 * isGuestAtMeal({ ...query, dateKey: '2026-04-10', minutes: MEAL_TIME_MINUTES.lunch });  // false
 * isGuestAtMeal({ ...query, dateKey: '2026-04-10', minutes: MEAL_TIME_MINUTES.dinner }); // true
 * ```
 */
export function isGuestAtMeal(
  args: GuestPresenceQuery & { readonly minutes: number },
): boolean {
  const { person, arrivals, departures, dateKey, minutes } = args;

  if (!isGuestOnSiteDuringDay(args)) {
    return false;
  }

  const onThatDay = (transport: Transport): number | null =>
    transport.personId === person.id && localDayKeyOfInstant(transport.datetime) === dateKey
      ? localMinutesOfInstant(transport.datetime)
      : null;

  const arrivalTimes = arrivals
    .map(onThatDay)
    .filter((value): value is number => value !== null);
  if (arrivalTimes.length > 0 && Math.min(...arrivalTimes) > minutes) {
    return false;
  }

  const departureTimes = departures
    .map(onThatDay)
    .filter((value): value is number => value !== null);
  if (departureTimes.length > 0 && Math.max(...departureTimes) < minutes) {
    return false;
  }

  return true;
}

/**
 * Guests sleeping on the given night, sorted by existing `persons` order
 * (typically by name). The night rule, so a guest who leaves that morning is
 * not on the list.
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
