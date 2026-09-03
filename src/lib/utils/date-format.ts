/**
 * @fileoverview Canonical calendar-date display formatting.
 *
 * The same trip date range used to render four different ways — `d - d MMM yyyy`
 * on the trip card, `MMM d - MMM d` (no year) in the sidebar, and `PP - PP` on
 * the share-import and room-assignment screens — and the full-date group header
 * was implemented twice, byte for byte. Both now live here so a change lands
 * once and every page agrees.
 *
 * Scope: whole-day formatting only. A time of day is not formatted here, and
 * day *keys* belong to `@/lib/db/utils` — this module never produces a key,
 * only text for a human.
 *
 * @module lib/utils/date-format
 */

import { type Locale, format, isValid, parseISO } from 'date-fns';

// ============================================================================
// Constants
// ============================================================================

/** Separator placed between the two ends of a range. */
const RANGE_SEPARATOR = ' - ';

/**
 * Day + abbreviated month + year, e.g. `15 Jul 2024` / `15 juil. 2024`.
 *
 * Day-first, in both languages. date-fns has no localized token for a
 * *collapsed* range, so a range needs a fixed pattern, and a fixed pattern has
 * to pick an order: French is the app's default language, and three of the four
 * implementations this replaces were already day-first. English readers see a
 * day-first range and a localized full date; that is the cost of collapsing.
 */
const DAY_MONTH_YEAR = 'd MMM yyyy';

/** Day + abbreviated month, e.g. `15 Jul` / `15 juil.`. */
const DAY_MONTH = 'd MMM';

/** Bare day number, used for the left end of a same-month range. */
const DAY = 'd';

/**
 * Localized full date: `Monday, January 5th, 2026` in English,
 * `lundi 5 janvier 2026` in French. Using the localized token rather than a
 * hardcoded `EEEE, MMMM d, yyyy` keeps French headers from reading as
 * `lundi, janvier 5, 2026`.
 */
const FULL_DATE = 'PPPP';

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parses a display date defensively.
 *
 * `parseISO` throws on anything that is not a string — date-fns v4 calls
 * `.split()` on its argument — and these helpers are fed rows out of IndexedDB
 * and Yjs, where a field can be missing however the types read. A row with a
 * missing date must render as text, not take the page down.
 *
 * @param value - The candidate date string
 * @returns The parsed local-midnight date, or `null` when unusable
 */
function parseDisplayDate(value: string): Date | null {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : null;
}

// ============================================================================
// Range Formatting
// ============================================================================

/**
 * Formats a whole-day date range for display, collapsing what is redundant.
 *
 * Redundancy is dropped from the left-hand end only, so the year is always
 * present exactly once:
 * - same day — `15 Jul 2024`
 * - same month — `15 - 22 Jul 2024`
 * - same year — `28 Jul - 5 Aug 2024`
 * - across years — `28 Dec 2024 - 5 Jan 2025`
 *
 * Dates are parsed with `parseISO`, which yields *local* midnight. `new Date()`
 * would read the string as UTC midnight and render the day before at any
 * negative offset.
 *
 * Invalid-date policy: the raw input is echoed back as `start - end`. A visibly
 * wrong date is a bug report; an empty string is a silent one.
 *
 * @param startDate - Start date, `YYYY-MM-DD` (a full ISO datetime also parses)
 * @param endDate - End date, `YYYY-MM-DD`
 * @param locale - date-fns locale, from `getDateLocale(i18n.language)`
 * @returns The formatted range, or `start - end` verbatim when either end is unusable
 *
 * @example
 * ```typescript
 * formatDateRange('2024-07-15', '2024-07-22', enUS); // "15 - 22 Jul 2024"
 * formatDateRange('2024-07-28', '2024-08-05', fr);   // "28 juil. - 5 août 2024"
 * formatDateRange('2024-07-15', '2024-07-15', enUS); // "15 Jul 2024"
 * formatDateRange('nope', '2024-07-22', enUS);       // "nope - 2024-07-22"
 * ```
 */
export function formatDateRange(
  startDate: string,
  endDate: string,
  locale: Locale,
): string {
  const start = parseDisplayDate(startDate);
  const end = parseDisplayDate(endDate);

  if (!start || !end) {
    return `${startDate}${RANGE_SEPARATOR}${endDate}`;
  }

  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();

  if (sameMonth && start.getDate() === end.getDate()) {
    return format(end, DAY_MONTH_YEAR, { locale });
  }

  if (sameMonth) {
    return `${format(start, DAY, { locale })}${RANGE_SEPARATOR}${format(end, DAY_MONTH_YEAR, { locale })}`;
  }

  if (sameYear) {
    return `${format(start, DAY_MONTH, { locale })}${RANGE_SEPARATOR}${format(end, DAY_MONTH_YEAR, { locale })}`;
  }

  return `${format(start, DAY_MONTH_YEAR, { locale })}${RANGE_SEPARATOR}${format(end, DAY_MONTH_YEAR, { locale })}`;
}

// ============================================================================
// Single-Date Formatting
// ============================================================================

/**
 * Formats a day key as a full, localized date header.
 *
 * Used by the grouped list pages (transports, activities) above each day's
 * rows.
 *
 * @param dateKey - Day key in `YYYY-MM-DD` form
 * @param locale - date-fns locale, from `getDateLocale(i18n.language)`
 * @returns The formatted date, or the raw key when it cannot be parsed
 *
 * @example
 * ```typescript
 * formatFullDate('2026-01-05', enUS); // "Monday, January 5th, 2026"
 * formatFullDate('2026-01-05', fr);   // "lundi 5 janvier 2026"
 * formatFullDate('nope', enUS);       // "nope"
 * ```
 */
export function formatFullDate(dateKey: string, locale: Locale): string {
  const parsed = parseDisplayDate(dateKey);
  if (!parsed) {
    return dateKey;
  }
  return format(parsed, FULL_DATE, { locale });
}
