/**
 * @fileoverview The timeline's time axis, at any zoom level.
 *
 * Every horizontal timeline in the app used to be a run of calendar days: one
 * column, one night. That is the right unit for a week in a house and the wrong
 * one for "when exactly does everyone land on Friday" and for "which of the last
 * five summers was this". This module generalises the axis into a run of
 * **columns**, each covering a half-open time range, so the same rows, pills and
 * lanes can be drawn at fifteen minutes per column or a month per column without
 * knowing which they are looking at.
 *
 * A day-per-column axis is still the default, and `columnsFromDays` builds
 * exactly the axis the timelines had before, so nothing about the month view
 * changes.
 *
 * @module lib/utils/timeline-scale
 */

import {
  addDays,
  addMinutes,
  addMonths,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
  type Locale,
} from 'date-fns';

import { toLocalISODateString } from '@/lib/db/utils';
import type { ISODateString } from '@/types';

// ============================================================================
// Types
// ============================================================================

/**
 * How much time one column covers.
 *
 * The unit matters as well as the amount: a month is 28 to 31 days and a
 * calendar day is 23 to 25 hours, so stepping the axis by minutes would drift
 * across a daylight-saving change and could not express a month at all.
 */
export type TimelineStepUnit = 'minute' | 'day' | 'month';

export type TimelineScaleId = 'hours' | 'day' | 'week' | 'month' | 'year' | 'fiveYears';

/** Every scale the dropdown offers, in the order it offers them. */
export const TIMELINE_SCALE_IDS: readonly TimelineScaleId[] = [
  'hours',
  'day',
  'week',
  'month',
  'year',
  'fiveYears',
] as const;

export interface TimelineScaleDefinition {
  readonly id: TimelineScaleId;
  readonly stepUnit: TimelineStepUnit;
  readonly stepAmount: number;
  /**
   * The fewest columns the axis shows.
   *
   * The axis always covers the whole trip: zooming in to a quarter of an hour
   * per column must not hide the rest of the week, it must make the week
   * longer to scroll. This is the floor under that, so picking "week" on a
   * two-night trip still shows a week rather than two columns, and picking
   * "5 years" shows five years.
   */
  readonly minColumnCount: number;
  /**
   * Column width the layout aims for before it starts compressing.
   *
   * A column labelled `14:15` needs more room than one labelled `07`, and a
   * column that has to be readable at all needs more than the 28px floor. Each
   * scale states the width its own labels need.
   */
  readonly preferredColumnWidthPx: number;
}

/**
 * One column of the axis: a half-open time range and how to label it.
 *
 * `[start, end)` — an event ending exactly at `end` belongs to the next column,
 * which is what makes a checkout at midnight the next day's business rather
 * than an extra night.
 */
export interface TimelineColumn {
  /** Stable React key, unique within one axis. */
  readonly key: string;
  readonly start: Date;
  /** Exclusive. */
  readonly end: Date;
  /** Muted line above the column's own label (weekday, month, year). */
  readonly topLabel: string;
  /** The column's own label (day number, clock time, month). */
  readonly bottomLabel: string;
  /** Hover text and assistive-tech name for the column. */
  readonly title: string;
  /** Saturday or Sunday, and only for a column of a day or less. */
  readonly isWeekend: boolean;
  /**
   * The calendar day this column *is*, set only when it covers exactly one.
   *
   * Anything keyed by day — the headcount under a day number, the "today"
   * highlight, the trip range shading — has an answer only for a column that is
   * one day. A 15-minute column is inside a day and a month column contains
   * thirty of them, and neither can carry a day key without lying.
   */
  readonly dayKey?: ISODateString;
}

/** Where the now-marker sits on the axis. */
export interface TimelineNowPosition {
  /** Index of the column containing the instant. */
  readonly columnIndex: number;
  /** How far through that column the instant falls, 0 to 1. */
  readonly fraction: number;
}

// ============================================================================
// Scale definitions
// ============================================================================

export const TIMELINE_SCALES: Readonly<Record<TimelineScaleId, TimelineScaleDefinition>> = {
  /** A quarter of an hour per column, a day of them at the very least. */
  hours: {
    id: 'hours',
    stepUnit: 'minute',
    stepAmount: 15,
    minColumnCount: 96,
    preferredColumnWidthPx: 56,
  },
  /** An hour per column, a day of them at the very least. */
  day: {
    id: 'day',
    stepUnit: 'minute',
    stepAmount: 60,
    minColumnCount: 24,
    preferredColumnWidthPx: 56,
  },
  /** A day per column, a week of them at the very least. */
  week: { id: 'week', stepUnit: 'day', stepAmount: 1, minColumnCount: 7, preferredColumnWidthPx: 64 },
  /** A day per column, exactly the trip — the axis every timeline had before scales. */
  month: { id: 'month', stepUnit: 'day', stepAmount: 1, minColumnCount: 1, preferredColumnWidthPx: 44 },
  /** A week per column, a year of them at the very least. */
  year: { id: 'year', stepUnit: 'day', stepAmount: 7, minColumnCount: 52, preferredColumnWidthPx: 48 },
  /** A month per column, five years of them at the very least. */
  fiveYears: {
    id: 'fiveYears',
    stepUnit: 'month',
    stepAmount: 1,
    minColumnCount: 60,
    preferredColumnWidthPx: 48,
  },
} as const;

/**
 * The most columns one axis may hold.
 *
 * Every column is a grid cell in the header and another in each row, so a long
 * trip at a quarter of an hour a column can ask the browser for tens of
 * thousands of elements. Past this the axis keeps the part of the trip around
 * the anchor instead, which is the part the reader is looking at.
 */
export const TIMELINE_MAX_COLUMNS = 1500;

// ============================================================================
// Internal helpers
// ============================================================================

function advance(from: Date, unit: TimelineStepUnit, amount: number): Date {
  switch (unit) {
    case 'minute':
      return addMinutes(from, amount);
    case 'day':
      return addDays(from, amount);
    case 'month':
      return addMonths(from, amount);
  }
}

/** True when a column covers one calendar day or less. */
function coversOneDayOrLess(definition: TimelineScaleDefinition): boolean {
  if (definition.stepUnit === 'month') {
    return false;
  }
  if (definition.stepUnit === 'day') {
    return definition.stepAmount <= 1;
  }
  return definition.stepAmount <= 24 * 60;
}

function isWeekendDay(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * The boundary a scale's first column may start on, at or before `date`.
 *
 * A column has to line up with something the reader recognises, or the labels
 * read as noise: the clock axes start at a midnight, the week axis on the
 * locale's first weekday, the five-year axis on the first of a month.
 */
function snapDown(scale: TimelineScaleId, date: Date, locale?: Locale): Date {
  switch (scale) {
    case 'hours':
    case 'day':
    case 'week':
    case 'month':
      return startOfDay(date);
    case 'year':
      return startOfWeek(date, { locale });
    case 'fiveYears':
      return startOfMonth(date);
  }
}

function labelsFor(
  scale: TimelineScaleId,
  start: Date,
  locale?: Locale,
): { topLabel: string; bottomLabel: string; title: string } {
  switch (scale) {
    case 'hours':
      return {
        // Only on the hour: four columns in a row all saying "Fri" is noise,
        // and the one that names the hour is the one worth reading.
        topLabel: start.getMinutes() === 0 ? format(start, 'EEE', { locale }) : '',
        bottomLabel: format(start, 'HH:mm', { locale }),
        title: format(start, 'PPPP HH:mm', { locale }),
      };
    case 'day':
      return {
        topLabel: format(start, 'EEE', { locale }),
        bottomLabel: format(start, 'HH:mm', { locale }),
        title: format(start, 'PPPP HH:mm', { locale }),
      };
    case 'week':
      return {
        topLabel: format(start, 'EEE', { locale }),
        bottomLabel: format(start, 'dd', { locale }),
        title: format(start, 'PPPP', { locale }),
      };
    case 'month':
      return {
        topLabel: format(start, 'MMM', { locale }),
        bottomLabel: format(start, 'dd', { locale }),
        title: format(start, 'PPPP', { locale }),
      };
    case 'year':
      return {
        topLabel: format(start, 'MMM', { locale }),
        bottomLabel: format(start, 'dd', { locale }),
        title: format(start, 'PPPP', { locale }),
      };
    case 'fiveYears':
      return {
        topLabel: format(start, 'yyyy', { locale }),
        bottomLabel: format(start, 'MMM', { locale }),
        title: format(start, 'MMMM yyyy', { locale }),
      };
  }
}

// ============================================================================
// Building an axis
// ============================================================================

/**
 * Wraps a run of calendar days as timeline columns.
 *
 * This is the axis every timeline drew before scales existed: one column per
 * local calendar day, labelled month over day number. Feed it the output of
 * `buildDayColumns` / `buildDayColumnsCovering` and its matching keys.
 *
 * @param days - Local midnights, one per column
 * @param dayKeys - The matching `YYYY-MM-DD` keys, one per column
 * @param locale - date-fns locale for the labels
 * @returns One column per day, each covering `[midnight, next midnight)`
 */
export function columnsFromDays(
  days: readonly Date[],
  dayKeys: readonly ISODateString[],
  locale?: Locale,
): readonly TimelineColumn[] {
  return days.map((start, index) => {
    const dayKey = dayKeys[index] ?? (toLocalISODateString(start) as ISODateString);
    const { topLabel, bottomLabel, title } = labelsFor('month', start, locale);
    return {
      key: `day-${dayKey}-${index}`,
      start,
      end: addDays(start, 1),
      topLabel,
      bottomLabel,
      title,
      isWeekend: isWeekendDay(start),
      dayKey,
    };
  });
}

/**
 * Builds the axis a scale shows over a span of time.
 *
 * The span is always covered: zooming in to a quarter of an hour per column
 * does not hide the rest of the trip, it makes the trip longer to scroll. The
 * scale's `minColumnCount` is a floor under that, so "week" on a two-night trip
 * still shows a week and "5 years" still shows five years.
 *
 * Two bounds shape the result. The first column starts on a boundary the reader
 * recognises - a midnight, the locale's first weekday, the first of a month -
 * which can be before `range.start`. The last one ends at or after `range.end`.
 * And a span that would need more than {@link TIMELINE_MAX_COLUMNS} columns is
 * narrowed to that many around `anchor`, because every column is a grid cell in
 * the header and another in every row.
 *
 * @param args - The scale, the span to cover, the instant to keep in view, and the locale
 * @returns The axis, earliest first, `[start, end)` per column and no gaps
 *
 * @example
 * ```typescript
 * // A four-day trip, a quarter of an hour a column: 4 x 96 columns.
 * buildTimelineColumns({
 *   scale: 'hours',
 *   anchor: new Date(),
 *   range: { start: tripStart, end: tripEnd },
 * }).length; // 384
 * ```
 */
export function buildTimelineColumns(args: {
  readonly scale: TimelineScaleId;
  /** Kept in view when the span is too long for one axis. */
  readonly anchor: Date;
  /**
   * The span to cover, `end` exclusive.
   *
   * Left out - a page with no trip - the axis is the scale's minimum window
   * starting at the anchor's own boundary.
   */
  readonly range?: { readonly start: Date; readonly end: Date };
  readonly locale?: Locale;
}): readonly TimelineColumn[] {
  const { scale, anchor, range, locale } = args;
  const definition = TIMELINE_SCALES[scale];
  const { stepUnit, stepAmount } = definition;

  const from = snapDown(scale, range?.start ?? anchor, locale);
  const until = range?.end ?? from;

  // How many steps it takes to cover the span, never fewer than the scale's
  // own floor. Counted by walking rather than by dividing: a month is 28 to 31
  // days and a calendar day is 23 to 25 hours, so there is no constant to
  // divide by.
  let count = 0;
  let cursor = from;
  while (cursor < until && count <= TIMELINE_MAX_COLUMNS) {
    cursor = advance(cursor, stepUnit, stepAmount);
    count++;
  }
  count = Math.max(count, definition.minColumnCount);

  let start = from;
  if (count > TIMELINE_MAX_COLUMNS) {
    // Too long to draw at once. Keep the columns around the anchor - the part
    // of the trip the reader is looking at - and let the rest stay off the
    // axis, the way a day too far outside the trip already does.
    const before = Math.floor(TIMELINE_MAX_COLUMNS / 2);
    let anchorStart = snapDown(scale, anchor < from ? from : anchor, locale);
    for (let i = 0; i < before; i++) {
      const previous = advance(anchorStart, stepUnit, -stepAmount);
      if (previous < from) {
        break;
      }
      anchorStart = previous;
    }
    start = anchorStart;
    count = TIMELINE_MAX_COLUMNS;
  }

  const dayWide = coversOneDayOrLess(definition);
  const isWholeDay = stepUnit === 'day' && stepAmount === 1;
  const columns: TimelineColumn[] = [];
  let columnStart = start;

  for (let index = 0; index < count; index++) {
    const columnEnd = advance(columnStart, stepUnit, stepAmount);
    const { topLabel, bottomLabel, title } = labelsFor(scale, columnStart, locale);

    columns.push({
      key: `${scale}-${columnStart.getTime()}`,
      start: columnStart,
      end: columnEnd,
      topLabel,
      bottomLabel,
      title,
      isWeekend: dayWide && isWeekendDay(columnStart),
      ...(isWholeDay ? { dayKey: toLocalISODateString(columnStart) as ISODateString } : {}),
    });

    columnStart = columnEnd;
  }

  return columns;
}

// ============================================================================
// Placing events on an axis
// ============================================================================

/**
 * The column containing an instant.
 *
 * @param columns - The axis, earliest first and without gaps
 * @param at - The instant to locate
 * @returns The column's index, or undefined when the instant is off the axis
 */
export function findColumnIndexAt(
  columns: readonly TimelineColumn[],
  at: Date,
): number | undefined {
  const time = at.getTime();
  let low = 0;
  let high = columns.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const column = columns[mid];
    if (!column) {
      return undefined;
    }
    if (time < column.start.getTime()) {
      high = mid - 1;
    } else if (time >= column.end.getTime()) {
      low = mid + 1;
    } else {
      return mid;
    }
  }

  return undefined;
}

/**
 * The columns a half-open time range covers, clipped to the axis.
 *
 * Clipping rather than dropping is what keeps a stay that started before the
 * window on screen: the reader sees the part of it that is in view, and the
 * off-screen arrows say the rest is out there. A range that misses the axis
 * entirely has nothing to draw and returns undefined.
 *
 * @param columns - The axis, earliest first and without gaps
 * @param startAt - First instant of the range, inclusive
 * @param endAt - Last instant of the range, exclusive
 * @returns Inclusive column index range, or undefined when the range is off the axis
 */
export function resolveColumnRange(
  columns: readonly TimelineColumn[],
  startAt: Date,
  endAt: Date,
): { readonly startIndex: number; readonly endIndex: number } | undefined {
  if (columns.length === 0) {
    return undefined;
  }

  const axisStart = columns[0]!.start.getTime();
  const axisEnd = columns[columns.length - 1]!.end.getTime();
  const from = startAt.getTime();
  // A zero-length range is a point in time, and a point still occupies the
  // column it falls in — otherwise every transport would vanish.
  const to = Math.max(endAt.getTime(), from + 1);

  if (to <= axisStart || from >= axisEnd) {
    return undefined;
  }

  let startIndex = 0;
  while (startIndex < columns.length && columns[startIndex]!.end.getTime() <= from) {
    startIndex++;
  }

  let endIndex = columns.length - 1;
  while (endIndex >= 0 && columns[endIndex]!.start.getTime() >= to) {
    endIndex--;
  }

  if (startIndex > endIndex || startIndex >= columns.length || endIndex < 0) {
    return undefined;
  }

  return { startIndex, endIndex };
}

/**
 * Where "now" falls on the axis, for the current-time marker.
 *
 * @param columns - The axis, earliest first and without gaps
 * @param now - The instant to place
 * @returns The column and the fraction through it, or undefined when now is off the axis
 */
export function resolveNowPosition(
  columns: readonly TimelineColumn[],
  now: Date,
): TimelineNowPosition | undefined {
  const columnIndex = findColumnIndexAt(columns, now);
  if (columnIndex === undefined) {
    return undefined;
  }

  const column = columns[columnIndex]!;
  const span = column.end.getTime() - column.start.getTime();
  if (span <= 0) {
    return { columnIndex, fraction: 0 };
  }

  const fraction = (now.getTime() - column.start.getTime()) / span;
  return { columnIndex, fraction: Math.min(1, Math.max(0, fraction)) };
}
