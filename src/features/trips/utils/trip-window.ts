/**
 * @fileoverview The date window a trip is planned in, whether or not the trip
 * has dates of its own.
 *
 * A trip is created without dates, and the organiser sets them later from the
 * calendar's setup checklist. Until then, every screen that needs a span of
 * days (the room timeline, the meal planner, the night split, the glance
 * panel) works from the guests' own stays instead: the earliest arrival to the
 * latest departure. Once the trip has dates, the trip dates win.
 *
 * One module, so every screen answers "which days is this trip?" the same way.
 *
 * @module features/trips/utils/trip-window
 */

import { addDays } from 'date-fns';

import { deriveGuestStayDateBounds } from '@/features/persons/utils/guest-presence';
import { isCalendarDayString } from '@/lib/db/sanitize';
import { toLocalISODateString } from '@/lib/db/utils';
import { parseLocalDayKey } from '@/lib/utils/trip-days';
import type { ISODateString, Person, Transport, Trip } from '@/types';

// ============================================================================
// Types
// ============================================================================

/** A span of calendar days, both bounds set. `endDate` is the check-out day. */
export interface DatedWindow {
  readonly startDate: ISODateString;
  readonly endDate: ISODateString;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Days shown on a timeline that has nothing to cover: no trip dates and no
 * dated guest, transport or booking. One week from today.
 */
export const UNDATED_TIMELINE_DEFAULT_DAYS = 7;

/**
 * The widest axis a trip without dates may draw, in days.
 *
 * With trip dates the axis is anchored and an outlier is clamped against it
 * (`TIMELINE_DAY_AXIS_MAX_EXTENSION_DAYS`). Without them nothing anchors it,
 * so a transport typed a year off would draw hundreds of columns. The axis
 * keeps the earliest days up to this many.
 */
export const UNDATED_TIMELINE_MAX_DAYS = 92;

// ============================================================================
// Public API
// ============================================================================

/**
 * The trip's own dates, when it has both.
 *
 * @param trip - The trip, or a trip-shaped pair of dates
 * @returns The window, or null for a trip without dates (or not loaded yet)
 */
export function getTripDates(
  trip: Pick<Trip, 'startDate' | 'endDate'> | null | undefined,
): DatedWindow | null {
  const startDate = trip?.startDate;
  const endDate = trip?.endDate;
  if (
    !startDate ||
    !endDate ||
    !isCalendarDayString(startDate) ||
    !isCalendarDayString(endDate) ||
    endDate < startDate
  ) {
    return null;
  }
  return { startDate: startDate as ISODateString, endDate: endDate as ISODateString };
}

/**
 * True when the trip has its own dates.
 *
 * @param trip - The trip
 * @returns False for a trip without dates, or one not loaded yet
 */
export function tripHasDates(
  trip: Pick<Trip, 'startDate' | 'endDate'> | null | undefined,
): boolean {
  return getTripDates(trip) !== null;
}

/**
 * The span of the guests' own stays: the earliest day any guest is known to
 * arrive, to the latest day any guest is known to leave.
 *
 * A guest's bounds come from {@link deriveGuestStayDateBounds}: stated stay
 * dates first, then their transports. A guest with only one known bound still
 * counts, so one arrival alone gives a one-day window.
 *
 * @param persons - The trip's guests
 * @param arrivals - Arrival transports of the trip
 * @param departures - Departure transports of the trip
 * @returns The window, or null when no guest has a known date
 */
export function inferGuestStayWindow(
  persons: readonly Person[],
  arrivals: readonly Transport[] = [],
  departures: readonly Transport[] = [],
): DatedWindow | null {
  let first: ISODateString | null = null;
  let last: ISODateString | null = null;

  for (const person of persons) {
    const { arrival, departure } = deriveGuestStayDateBounds(person, arrivals, departures);
    for (const key of [arrival, departure]) {
      if (!key || !isCalendarDayString(key)) {
        continue;
      }
      const day = key as ISODateString;
      if (first === null || day < first) {
        first = day;
      }
      if (last === null || day > last) {
        last = day;
      }
    }
  }

  if (first === null || last === null) {
    return null;
  }
  return { startDate: first, endDate: last };
}

/**
 * The window a screen plans in: the trip's dates when it has them, otherwise
 * the span of the guests' stays.
 *
 * @param trip - The trip
 * @param persons - The trip's guests
 * @param arrivals - Arrival transports of the trip
 * @param departures - Departure transports of the trip
 * @returns The window, or null for a trip without dates whose guests have none either
 */
export function resolveTripWorkingWindow(
  trip: Pick<Trip, 'startDate' | 'endDate'> | null | undefined,
  persons: readonly Person[],
  arrivals: readonly Transport[] = [],
  departures: readonly Transport[] = [],
): DatedWindow | null {
  return getTripDates(trip) ?? inferGuestStayWindow(persons, arrivals, departures);
}

/**
 * The day range of a timeline for a trip without dates: the span of every
 * known event, or one week from today when there is none.
 *
 * @param keys - Day keys that must be on the axis (stays, travel days, booking nights)
 * @param today - The current day, as a local day key
 * @returns The first and last day of the axis, both inclusive
 */
export function resolveUndatedTimelineRange(
  keys: readonly (string | null | undefined)[],
  today: ISODateString,
): DatedWindow {
  let first: ISODateString | null = null;
  let last: ISODateString | null = null;

  for (const key of keys) {
    if (!key || parseLocalDayKey(key) === null) {
      continue;
    }
    const day = key as ISODateString;
    if (first === null || day < first) {
      first = day;
    }
    if (last === null || day > last) {
      last = day;
    }
  }

  if (first === null || last === null) {
    const start = parseLocalDayKey(today) ?? new Date();
    return {
      startDate: toLocalISODateString(start),
      endDate: toLocalISODateString(addDays(start, UNDATED_TIMELINE_DEFAULT_DAYS - 1)),
    };
  }

  const start = parseLocalDayKey(first);
  if (start) {
    const latestAllowed = toLocalISODateString(addDays(start, UNDATED_TIMELINE_MAX_DAYS - 1));
    if (last > latestAllowed) {
      last = latestAllowed;
    }
  }

  return { startDate: first, endDate: last };
}
