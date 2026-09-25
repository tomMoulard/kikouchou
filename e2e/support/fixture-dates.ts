/**
 * @fileoverview Fixture dates for the E2E suite, derived from today.
 *
 * Dates pinned to a literal month rot, and they rot silently. Two families of
 * failure have already been paid for here:
 *
 *   - **Rendered but hidden.** Once March 2026 passed, the transport list
 *     folded every fixture transport into its collapsed "Past transports"
 *     accordion, and the assertions hunted for rows that were real, rendered
 *     and invisible. The a11y suite lost the same way from the other side: axe
 *     cannot tell "no violations" from "nothing rendered".
 *   - **Out of reach entirely.** The trip form's date picker is walked month by
 *     month from today under a 24-click ceiling. A 2024 fixture ran out of
 *     clicks, the walk gave up without a word, and the spec then clicked the
 *     15th of whatever month happened to be on screen — creating trips with
 *     dates nobody asked for, under assertions that only ever looked at the URL.
 *
 * Both are fixed the same way: name a *month relative to today* and index days
 * inside it, so every offset a spec depends on survives the calendar moving on.
 *
 * @module e2e/support/fixture-dates
 */

/**
 * How far ahead of today the fixture month sits, in months.
 *
 * Two, not one: a one-month offset evaluated on the 31st leaves fixtures only
 * hours in the future, and "is this trip past?" is exactly what these dates
 * exist to pin down. Two is still near enough that a spec walking the trip
 * form's picker gets there in two clicks.
 */
const DEFAULT_MONTHS_AHEAD = 2;

/**
 * The largest day-of-month a fixture may name.
 *
 * February has no 29th in three years out of four, and `Date` answers an
 * overflowing day by rolling into the next month rather than complaining — so a
 * fixture asking for the 30th would quietly land in a different month for part
 * of the year. Ask for the end of the month with {@link fixtureMonthEnd}.
 */
const MAX_FIXTURE_DAY = 28;

/**
 * `YYYY-MM-DD` for a day of a month offset from today, with no range check.
 *
 * Built and read back in UTC throughout: the result is a calendar-day string,
 * and going via local fields would shift it by a day either side of midnight.
 */
function isoDate(dayOfMonth: number, monthsAhead: number): string {
  const date = fixtureMonthStart(monthsAhead);
  date.setUTCDate(dayOfMonth);
  return date.toISOString().slice(0, 10);
}

/**
 * First day (UTC) of the fixture month — a month that is always ahead of today.
 *
 * @param monthsAhead - Months past the current one; defaults to two
 * @returns Midnight UTC on the 1st of that month
 */
export function fixtureMonthStart(monthsAhead: number = DEFAULT_MONTHS_AHEAD): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthsAhead, 1));
}

/**
 * `YYYY-MM-DD` for the given 1-based day of the fixture month.
 *
 * @param dayOfMonth - Day of the month, 1 to 28
 * @param monthsAhead - Months past the current one; defaults to two
 * @returns The ISO calendar day
 * @throws RangeError if the day could not exist in every month
 *
 * @example
 * ```ts
 * const TRIP = { startDate: fixtureDate(1), endDate: fixtureDate(10) };
 * // A second trip, a month after the first:
 * const NEXT = { startDate: fixtureDate(1, 3), endDate: fixtureDate(8, 3) };
 * ```
 */
export function fixtureDate(
  dayOfMonth: number,
  monthsAhead: number = DEFAULT_MONTHS_AHEAD,
): string {
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > MAX_FIXTURE_DAY) {
    throw new RangeError(
      `fixtureDate: day ${dayOfMonth} is not safe in every month — use 1 to ${MAX_FIXTURE_DAY}, or fixtureMonthEnd() for the last day`,
    );
  }
  return isoDate(dayOfMonth, monthsAhead);
}

/**
 * `YYYY-MM-DD` for the last day of the fixture month, whatever its length.
 *
 * @param monthsAhead - Months past the current one; defaults to two
 * @returns The ISO calendar day of the 28th, 29th, 30th or 31st
 */
export function fixtureMonthEnd(monthsAhead: number = DEFAULT_MONTHS_AHEAD): string {
  // Day 0 of the following month is the last day of this one.
  return isoDate(0, monthsAhead + 1);
}

/**
 * An ISO timestamp for the given day of the fixture month at a UTC time.
 *
 * @param dayOfMonth - Day of the month, 1 to 28
 * @param utcTime - The time part, e.g. `'10:00'` or `'10:00:00.000Z'`
 * @param monthsAhead - Months past the current one; defaults to two
 * @returns `YYYY-MM-DDTHH:mm…`, the two parts joined
 */
export function fixtureDatetime(
  dayOfMonth: number,
  utcTime: string,
  monthsAhead: number = DEFAULT_MONTHS_AHEAD,
): string {
  return `${fixtureDate(dayOfMonth, monthsAhead)}T${utcTime}`;
}
