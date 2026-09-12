/**
 * @fileoverview The trip day axis: one Date per calendar day, keyed the way the
 * rest of the app stores days.
 *
 * ## One convention: the local calendar day
 *
 * A day key is the `YYYY-MM-DD` the viewer sees on their own wall calendar.
 * Room assignments are *written* that way (`RoomAssignmentSection` and
 * `QuickAssignmentDialog` both format the picker's Date with
 * `toLocalISODateString`), so every reader has to key the same way or a stay
 * lands one column off the night it was booked for.
 *
 * Concretely, use `parseLocalDayKey` to read a key back and
 * `toLocalISODateString` to write one. Never `toISODateString` (UTC). The two
 * disagree in both directions, and the app used to do both at once:
 *
 * - `toISODateString` of a local midnight is the *previous* day for a viewer
 *   ahead of UTC — Paris included, which is where this app's users are. That is
 *   how a month cell showing "6" ended up keyed 2026-04-05.
 * - `toLocalISODateString` of a UTC midnight — and `format()`, which also reads
 *   local components — is the previous day for a viewer behind UTC. That is how
 *   a UTC-stepped day column keyed 2024-07-15 printed "14".
 *
 * The Dates handed out here are local midnights, so date-fns `format()` — which
 * reads local components — prints the same calendar day the key names.
 *
 * @module lib/utils/trip-days
 */

import { addDays, isValid, parseISO } from 'date-fns';

import { isValidISODateString, toLocalISODateString } from '@/lib/db/utils';
import type { ISODateString, Trip } from '@/types';

/**
 * Reads a `YYYY-MM-DD` day key back as **local** midnight.
 *
 * The counterpart of `toLocalISODateString`: `toLocalISODateString(parseLocalDayKey(k))`
 * is `k` in every timezone. (`parseISODateString` is the UTC counterpart and
 * round-trips only through `toISODateString`.)
 *
 * @param key - A calendar day in `YYYY-MM-DD` form
 * @returns Local midnight on that day, or null when the key is not a real date
 *
 * @example
 * ```typescript
 * parseLocalDayKey('2024-07-15'); // 2024-07-15T00:00 local
 * parseLocalDayKey('2024-02-30'); // null
 * ```
 */
export function parseLocalDayKey(key: string): Date | null {
  if (!isValidISODateString(key)) {
    return null;
  }

  const [year, month, day] = key.split('-').map(Number) as [
    number,
    number,
    number,
  ];

  const date = new Date(0);
  // `setFullYear` with all three parts avoids the two-digit-year remapping the
  // `new Date(year, …)` constructor applies to years below 100.
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);

  // The setters roll over out-of-range days (Feb 30 becomes Mar 1), and a few
  // zones have no midnight on a DST-forward day, so confirm the calendar day
  // survived rather than trusting the components we passed in.
  if (isNaN(date.getTime()) || toLocalISODateString(date) !== key) {
    return null;
  }

  return date;
}

/**
 * The local calendar day a stored instant falls on.
 *
 * Instants (`Transport.datetime`, `Activity.startDatetime`) are written as UTC
 * — `TransportForm` stores `new Date(datetimeLocalInput).toISOString()` — so
 * slicing the first ten characters off the string yields the *UTC* day, which is
 * the previous one for anything the user entered in the small hours east of
 * Greenwich. Read the instant instead: a guest's 00:30 flight belongs on the day
 * they typed into the picker.
 *
 * @param datetime - An ISO datetime string, with or without an offset
 * @returns The local day key, or null when the value is unparseable
 *
 * @example
 * ```typescript
 * // In Europe/Paris:
 * localDayKeyOfInstant('2026-04-05T22:30:00.000Z'); // '2026-04-06'
 * ```
 */
export function localDayKeyOfInstant(datetime: string): ISODateString | null {
  const date = parseISO(datetime);
  return isValid(date) ? toLocalISODateString(date) : null;
}

/**
 * Builds one local-midnight Date per calendar day between two day keys,
 * both ends inclusive.
 *
 * Days are stepped as calendar days, so a daylight-saving transition never
 * skips or repeats a column.
 *
 * @param startKey - First day of the axis
 * @param endKey - Last day of the axis (inclusive)
 * @returns One Date per day, or an empty array when the keys are invalid or inverted
 *
 * @example
 * ```typescript
 * buildDayColumns(isoDate('2024-07-15'), isoDate('2024-07-17')).length; // 3
 * ```
 */
export function buildDayColumns(
  startKey: ISODateString,
  endKey: ISODateString,
): readonly Date[] {
  const start = parseLocalDayKey(startKey);
  const end = parseLocalDayKey(endKey);
  if (!start || !end) {
    return [];
  }

  const days: Date[] = [];
  let cursor = start;
  // Day keys are lexicographically ordered, so string comparison is the same
  // test as a date comparison — and it cannot drift with the time of day.
  while (toLocalISODateString(cursor) <= endKey) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }

  return days;
}

/**
 * Builds one Date per calendar day of a trip, from its start date to its end
 * date inclusive.
 *
 * @param trip - The trip whose span to enumerate
 * @returns One Date per trip day, or an empty array when the dates are invalid
 *
 * @example
 * ```typescript
 * buildTripDayColumns(trip).length; // nights + 1
 * ```
 */
export function buildTripDayColumns(trip: Trip): readonly Date[] {
  return buildDayColumns(trip.startDate, trip.endDate);
}

/**
 * Day keys for a run of day columns, in the canonical local convention.
 *
 * Pairs with `buildDayColumns` / `buildTripDayColumns` so a builder never has to
 * name the converter itself — and so it cannot pick the wrong one.
 *
 * @param days - Day columns, as returned by `buildDayColumns`
 * @returns The matching `YYYY-MM-DD` keys
 */
export function toDayKeys(days: readonly Date[]): readonly ISODateString[] {
  return days.map((day) => toLocalISODateString(day));
}

/**
 * How far outside the trip dates the day axis may stretch to reach an event,
 * in days, at each end.
 *
 * A transport dated a year off the trip is a typo, not a plan, and an axis that
 * followed it would render hundreds of day columns — every one of them a grid
 * cell, at 44px each — to show a single pill. Events past this limit stay off
 * the axis, as they were before it existed.
 */
export const TIMELINE_DAY_AXIS_MAX_EXTENSION_DAYS = 31;

/**
 * Builds the day columns of a timeline whose axis has to cover more than the
 * trip itself.
 *
 * The trip range is always on the axis; each key in `mustInclude` widens it
 * outwards, up to `maxExtensionDays` beyond either end. This is what puts a
 * transport dated the day before the trip starts — or a late flight home — on
 * screen: a day with no column cannot draw anything.
 *
 * @param args - The trip range, the day keys that must have a column, and how far the axis may stretch
 * @returns One local-midnight Date per day of the resulting axis
 *
 * @example
 * ```typescript
 * // Trip 15-18 July, a guest flying in on the 13th:
 * buildDayColumnsCovering({
 *   startKey: isoDate('2024-07-15'),
 *   endKey: isoDate('2024-07-18'),
 *   mustInclude: [isoDate('2024-07-13')],
 * }).length; // 6
 * ```
 */
export function buildDayColumnsCovering(args: {
  readonly startKey: ISODateString;
  readonly endKey: ISODateString;
  readonly mustInclude: readonly (string | null | undefined)[];
  readonly maxExtensionDays?: number;
}): readonly Date[] {
  const {
    startKey,
    endKey,
    mustInclude,
    maxExtensionDays = TIMELINE_DAY_AXIS_MAX_EXTENSION_DAYS,
  } = args;

  const start = parseLocalDayKey(startKey);
  const end = parseLocalDayKey(endKey);
  if (!start || !end || start > end) {
    // An unusable trip range has no axis to widen — same answer as
    // `buildTripDayColumns` gives, so callers keep one empty-model branch.
    return [];
  }

  const extension = Math.max(0, maxExtensionDays);
  const earliestAllowedKey = toLocalISODateString(addDays(start, -extension));
  const latestAllowedKey = toLocalISODateString(addDays(end, extension));

  let firstKey: ISODateString = toLocalISODateString(start);
  let lastKey: ISODateString = toLocalISODateString(end);

  for (const key of mustInclude) {
    // Day keys are lexicographically ordered, so these string comparisons are
    // the date comparisons — and they cannot drift with the time of day.
    if (!key || parseLocalDayKey(key) === null) {
      continue;
    }
    if (key < firstKey && key >= earliestAllowedKey) {
      firstKey = key as ISODateString;
    }
    if (key > lastKey && key <= latestAllowedKey) {
      lastKey = key as ISODateString;
    }
  }

  return buildDayColumns(firstKey, lastKey);
}
