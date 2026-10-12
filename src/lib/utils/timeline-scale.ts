/**
 * @fileoverview The timeline's time axis: a run of day columns, and where an
 * event or the present moment falls on it.
 *
 * Each column covers a half-open time range, so rows, pills and lanes place an
 * event by the span of time it covers rather than by the day keys it names.
 *
 * @module lib/utils/timeline-scale
 */

import { addDays, format, type Locale } from 'date-fns';

import { toLocalISODateString } from '@/lib/db/utils';
import type { ISODateString } from '@/types';

// ============================================================================
// Types
// ============================================================================

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
// Internal helpers
// ============================================================================

function isWeekendDay(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

// ============================================================================
// Building an axis
// ============================================================================

/**
 * Wraps a run of calendar days as timeline columns.
 *
 * One column per local calendar day, labelled month over day number. Feed it
 * the output of `buildDayColumns` / `buildDayColumnsCovering` and its matching
 * keys.
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
    return {
      key: `day-${dayKey}-${index}`,
      start,
      end: addDays(start, 1),
      topLabel: format(start, 'MMM', { locale }),
      bottomLabel: format(start, 'dd', { locale }),
      title: format(start, 'PPPP', { locale }),
      isWeekend: isWeekendDay(start),
      dayKey,
    };
  });
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
