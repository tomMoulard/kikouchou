/**
 * @fileoverview One renderer for a transport's stored instant.
 *
 * A transport's `datetime` is one stored instant, but it used to be rendered
 * seven different ways — `'EEE d MMM'`, `'d MMM'`, `'PPP'`, a bare `'HH:mm'`
 * and a native `Intl` `dateStyle: 'medium' / timeStyle: 'short'` — so the same
 * departure read differently on every page that showed it, and the sharing
 * wizard even switched to a 12-hour clock.
 *
 * This module is the renderer they all go through now. Pick the variant by how
 * much room the surface has, never by which file you are in:
 *
 * - `timeOnly` — the day is already established by the surrounding UI
 *   (calendar pills, timeline rows, a time range).
 * - `dayAndTime` — cards, list rows and map popups: enough room for the
 *   weekday and month, not for the year.
 * - `fullDayAndTime` — detail dialogs and the sharing review steps, where the
 *   year matters and there is room to spell the date out.
 *
 * The clock is always 24-hour (`HH:mm`), matching every other time in the app.
 *
 * The instant is rendered in the viewer's timezone, which is only meaningful
 * for a datetime that carries an offset. Every writer now stores one: the
 * transport repository normalises through `lib/db/transport-datetime` and
 * rejects what it cannot parse, so a row written by the share wizard and one
 * written by `TransportForm` reach this renderer in the same shape. Rows
 * persisted before that rule can still be offset-less, and this renderer has
 * no choice but to read those as its own wall clock — see the migration note
 * in `transport-repository`.
 *
 * @module lib/utils/datetime-format
 */

import { format, isValid, parseISO } from 'date-fns';
import type { Locale } from 'date-fns';

// ============================================================================
// Variants
// ============================================================================

/**
 * The rendering variants of a transport datetime, ordered from tightest to
 * roomiest surface.
 */
export const TRANSPORT_DATETIME_VARIANTS = {
  /** `14:30` — for surfaces whose context already states the day. */
  timeOnly: 'timeOnly',
  /** `Wed 15 Jul, 14:30` — for cards, rows and popups. */
  dayAndTime: 'dayAndTime',
  /** `July 15th, 2026, 14:30` — for detail views. */
  fullDayAndTime: 'fullDayAndTime',
} as const;

/**
 * A rendering variant of a transport datetime.
 */
export type TransportDatetimeVariant =
  (typeof TRANSPORT_DATETIME_VARIANTS)[keyof typeof TRANSPORT_DATETIME_VARIANTS];

/**
 * The rendered pieces of a transport datetime.
 *
 * `date` and `time` exist because several surfaces style them differently (a
 * bold day beside a muted clock). `full` is the same value joined the one way
 * the app joins it, for `aria-label`s, tooltips and single-line rows.
 */
export interface TransportDatetimeParts {
  /** The day, or `''` for {@link TRANSPORT_DATETIME_VARIANTS.timeOnly}. */
  readonly date: string;
  /** The wall-clock time in 24-hour form, e.g. `14:30`. */
  readonly time: string;
  /** `date` and `time` joined, or just `time` when there is no date. */
  readonly full: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Returned for an empty, malformed or otherwise unparseable datetime. */
const EMPTY_PARTS: TransportDatetimeParts = { date: '', time: '', full: '' };

/** The canonical 24-hour clock pattern used by every surface. */
const TIME_PATTERN = 'HH:mm';

/**
 * Returns the date-fns pattern for a variant's date half.
 *
 * @param variant - The rendering variant
 * @returns The date pattern, or `undefined` when the variant omits the date
 */
function getDatePattern(variant: TransportDatetimeVariant): string | undefined {
  switch (variant) {
    case 'dayAndTime':
      return 'EEE d MMM';
    case 'fullDayAndTime':
      return 'PPP';
    case 'timeOnly':
    default:
      return undefined;
  }
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Renders a transport's stored instant as its display pieces, in the viewer's
 * local timezone.
 *
 * @param datetime - The stored ISO datetime (a UTC instant)
 * @param locale - The date-fns locale; English when omitted
 * @param variant - How much of the datetime to show (defaults to `dayAndTime`)
 * @returns The rendered pieces, all empty strings when `datetime` is unusable
 *
 * @example
 * ```typescript
 * formatTransportDatetimeParts('2026-07-15T12:30:00.000Z', fr, 'dayAndTime');
 * // → { date: 'mer. 15 juil.', time: '14:30', full: 'mer. 15 juil., 14:30' }
 * ```
 */
export function formatTransportDatetimeParts(
  datetime: string,
  locale?: Locale,
  variant: TransportDatetimeVariant = 'dayAndTime',
): TransportDatetimeParts {
  if (!datetime) {
    return EMPTY_PARTS;
  }
  try {
    const parsed = parseISO(datetime);
    if (!isValid(parsed)) {
      return EMPTY_PARTS;
    }
    const time = format(parsed, TIME_PATTERN, { locale });
    const datePattern = getDatePattern(variant);
    if (datePattern === undefined) {
      return { date: '', time, full: time };
    }
    const date = format(parsed, datePattern, { locale });
    return { date, time, full: `${date}, ${time}` };
  } catch {
    return EMPTY_PARTS;
  }
}

/**
 * Renders a transport's stored instant as a single string.
 *
 * Shorthand for the `full` piece of {@link formatTransportDatetimeParts}, for
 * the surfaces that do not style the day and the clock separately.
 *
 * @param datetime - The stored ISO datetime (a UTC instant)
 * @param locale - The date-fns locale; English when omitted
 * @param variant - How much of the datetime to show (defaults to `dayAndTime`)
 * @returns The rendered datetime, or `''` when `datetime` is unusable
 *
 * @example
 * ```typescript
 * formatTransportDatetime('2026-07-15T12:30:00.000Z', enUS, 'timeOnly'); // '14:30'
 * ```
 */
export function formatTransportDatetime(
  datetime: string,
  locale?: Locale,
  variant: TransportDatetimeVariant = 'dayAndTime',
): string {
  return formatTransportDatetimeParts(datetime, locale, variant).full;
}
