/**
 * @fileoverview Tests for the timeline's time axis at every zoom level.
 * @module lib/utils/__tests__/timeline-scale.test
 */

import { describe, expect, it } from 'vitest';
import { enUS } from 'date-fns/locale';

import {
  TIMELINE_MAX_COLUMNS,
  TIMELINE_SCALES,
  buildTimelineColumns,
  columnsFromDays,
  findColumnIndexAt,
  resolveColumnRange,
  resolveNowPosition,
} from '../timeline-scale';
import { buildDayColumns, toDayKeys } from '../trip-days';
import type { ISODateString } from '@/types';

// ============================================================================
// Helpers
// ============================================================================

/** 14 July 2026, a Tuesday, at 09:30 local time. */
const ANCHOR = new Date(2026, 6, 14, 9, 30);

function dayAxis(startKey: string, endKey: string) {
  const days = buildDayColumns(startKey as ISODateString, endKey as ISODateString);
  return columnsFromDays(days, toDayKeys(days), enUS);
}

// ============================================================================
// Tests
// ============================================================================

describe('buildTimelineColumns', () => {
  it('gives the hours scale a full day of quarter-hour columns', () => {
    const columns = buildTimelineColumns({ scale: 'hours', anchor: ANCHOR, locale: enUS });

    expect(columns).toHaveLength(TIMELINE_SCALES.hours.minColumnCount);
    expect(columns[0]?.start.getHours()).toBe(0);
    expect(columns[0]?.start.getMinutes()).toBe(0);
    expect(columns[1]?.start.getMinutes()).toBe(15);
    expect(columns[columns.length - 1]?.start.getHours()).toBe(23);
    expect(columns[columns.length - 1]?.start.getMinutes()).toBe(45);
  });

  it('labels a quarter-hour column with its clock time', () => {
    const columns = buildTimelineColumns({ scale: 'hours', anchor: ANCHOR, locale: enUS });

    expect(columns[1]?.bottomLabel).toBe('00:15');
    // The weekday is printed on the hour only: four columns in a row all
    // saying "Tue" is noise, and the one naming the hour is the one to read.
    expect(columns[0]?.topLabel).not.toBe('');
    expect(columns[1]?.topLabel).toBe('');
  });

  it('gives the day scale twenty-four hourly columns', () => {
    const columns = buildTimelineColumns({ scale: 'day', anchor: ANCHOR, locale: enUS });

    expect(columns).toHaveLength(24);
    expect(columns[13]?.bottomLabel).toBe('13:00');
  });

  it('gives the week scale seven day columns', () => {
    const columns = buildTimelineColumns({ scale: 'week', anchor: ANCHOR, locale: enUS });

    expect(columns).toHaveLength(7);
    expect(columns.every((column) => column.dayKey !== undefined)).toBe(true);
  });

  it('gives the year scale fifty-two week columns', () => {
    const columns = buildTimelineColumns({ scale: 'year', anchor: ANCHOR, locale: enUS });

    expect(columns).toHaveLength(52);
    const first = columns[0]!;
    const second = columns[1]!;
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    expect(second.start.getTime() - first.start.getTime()).toBe(weekMs);
  });

  it('gives the five-year scale sixty month columns from the first of a month', () => {
    const columns = buildTimelineColumns({ scale: 'fiveYears', anchor: ANCHOR, locale: enUS });

    expect(columns).toHaveLength(60);
    expect(columns[0]?.start.getDate()).toBe(1);
    expect(columns[0]?.start.getMonth()).toBe(ANCHOR.getMonth());
  });

  it('gives the trip scale one column when it has no span to cover', () => {
    expect(buildTimelineColumns({ scale: 'month', anchor: ANCHOR, locale: enUS })).toHaveLength(1);
  });
});

// Zooming in must not cut the trip down to the day around the anchor: the
// reader asked for finer columns, not for less trip.
describe('covering a span', () => {
  /** 14 to 18 July 2026, checkout morning excluded. */
  const TRIP = { start: new Date(2026, 6, 14), end: new Date(2026, 6, 18) };

  it('covers every quarter of an hour of a four-day trip', () => {
    const columns = buildTimelineColumns({
      scale: 'hours',
      anchor: ANCHOR,
      range: TRIP,
      locale: enUS,
    });

    expect(columns).toHaveLength(4 * 96);
    expect(columns[0]?.start).toEqual(TRIP.start);
    expect(columns[columns.length - 1]?.end).toEqual(TRIP.end);
  });

  it('covers every hour of the same trip on the day scale', () => {
    const columns = buildTimelineColumns({
      scale: 'day',
      anchor: ANCHOR,
      range: TRIP,
      locale: enUS,
    });

    expect(columns).toHaveLength(4 * 24);
  });

  it('still shows a whole week for a trip shorter than one', () => {
    const columns = buildTimelineColumns({
      scale: 'week',
      anchor: ANCHOR,
      range: { start: new Date(2026, 6, 14), end: new Date(2026, 6, 16) },
      locale: enUS,
    });

    expect(columns).toHaveLength(7);
  });

  it('gives the trip scale exactly the trip, one column a day', () => {
    const columns = buildTimelineColumns({
      scale: 'month',
      anchor: ANCHOR,
      range: TRIP,
      locale: enUS,
    });

    expect(columns).toHaveLength(4);
    expect(columns.every((column) => column.dayKey !== undefined)).toBe(true);
  });

  it('starts the first column on a boundary at or before the span', () => {
    // A Tuesday start, on an axis whose columns are whole weeks.
    const columns = buildTimelineColumns({
      scale: 'year',
      anchor: ANCHOR,
      range: TRIP,
      locale: enUS,
    });

    expect(columns[0]!.start.getTime()).toBeLessThanOrEqual(TRIP.start.getTime());
  });

  it('refuses to draw more columns than a browser can hold', () => {
    // Ten years at a quarter of an hour a column is a third of a million
    // columns; the axis keeps the part around the anchor instead.
    const columns = buildTimelineColumns({
      scale: 'hours',
      anchor: ANCHOR,
      range: { start: new Date(2020, 0, 1), end: new Date(2030, 0, 1) },
      locale: enUS,
    });

    expect(columns).toHaveLength(TIMELINE_MAX_COLUMNS);
    // And the anchor is still on it, which is the point of narrowing around it.
    expect(columns[0]!.start.getTime()).toBeLessThanOrEqual(ANCHOR.getTime());
    expect(columns[columns.length - 1]!.end.getTime()).toBeGreaterThan(ANCHOR.getTime());
  });
});

describe('weekend columns', () => {
  it('marks Saturday and Sunday on a day axis', () => {
    // 2026-07-17 is a Friday, so the axis runs Fri, Sat, Sun, Mon.
    const columns = dayAxis('2026-07-17', '2026-07-20');

    expect(columns.map((column) => column.isWeekend)).toEqual([false, true, true, false]);
  });

  it('marks no column a weekend once one column is a whole month', () => {
    const columns = buildTimelineColumns({ scale: 'fiveYears', anchor: ANCHOR, locale: enUS });

    expect(columns.some((column) => column.isWeekend)).toBe(false);
  });

  it('marks no column a weekend once one column is a whole week', () => {
    const columns = buildTimelineColumns({ scale: 'year', anchor: ANCHOR, locale: enUS });

    expect(columns.some((column) => column.isWeekend)).toBe(false);
  });
});

describe('findColumnIndexAt', () => {
  const columns = dayAxis('2026-07-14', '2026-07-18');

  it('finds the column an instant falls in', () => {
    expect(findColumnIndexAt(columns, new Date(2026, 6, 16, 13, 0))).toBe(2);
  });

  it('puts an instant on a column boundary in the later column', () => {
    expect(findColumnIndexAt(columns, new Date(2026, 6, 16, 0, 0))).toBe(2);
  });

  it('returns undefined for an instant off the axis', () => {
    expect(findColumnIndexAt(columns, new Date(2026, 6, 1))).toBeUndefined();
    expect(findColumnIndexAt(columns, new Date(2026, 7, 1))).toBeUndefined();
  });
});

describe('resolveColumnRange', () => {
  const columns = dayAxis('2026-07-14', '2026-07-18');

  it('covers the nights of a half-open stay, not its checkout day', () => {
    // 14 July to 16 July is two nights: the 14th and the 15th.
    const range = resolveColumnRange(columns, new Date(2026, 6, 14), new Date(2026, 6, 16));

    expect(range).toEqual({ startIndex: 0, endIndex: 1 });
  });

  it('gives a point in time the one column it falls in', () => {
    const at = new Date(2026, 6, 17, 6, 5);
    const range = resolveColumnRange(columns, at, at);

    expect(range).toEqual({ startIndex: 3, endIndex: 3 });
  });

  it('clips a range that starts before the axis', () => {
    const range = resolveColumnRange(columns, new Date(2026, 5, 1), new Date(2026, 6, 16));

    expect(range).toEqual({ startIndex: 0, endIndex: 1 });
  });

  it('clips a range that runs past the end of the axis', () => {
    const range = resolveColumnRange(columns, new Date(2026, 6, 17), new Date(2026, 8, 1));

    expect(range).toEqual({ startIndex: 3, endIndex: 4 });
  });

  it('returns undefined for a range that misses the axis entirely', () => {
    expect(
      resolveColumnRange(columns, new Date(2026, 0, 1), new Date(2026, 0, 5)),
    ).toBeUndefined();
  });

  it('returns undefined on an empty axis', () => {
    expect(resolveColumnRange([], new Date(2026, 6, 14), new Date(2026, 6, 16))).toBeUndefined();
  });

  it('spans every quarter-hour column between two midnights', () => {
    const quarters = buildTimelineColumns({
      scale: 'hours',
      anchor: new Date(2026, 6, 14, 12),
      locale: enUS,
    });
    const range = resolveColumnRange(quarters, new Date(2026, 6, 14), new Date(2026, 6, 15));

    expect(range).toEqual({ startIndex: 0, endIndex: 95 });
  });
});

describe('resolveNowPosition', () => {
  it('reports how far through its column the instant falls', () => {
    const columns = dayAxis('2026-07-14', '2026-07-16');
    const position = resolveNowPosition(columns, new Date(2026, 6, 15, 6, 0));

    expect(position?.columnIndex).toBe(1);
    expect(position?.fraction).toBeCloseTo(0.25, 5);
  });

  it('returns undefined when now is off the axis', () => {
    const columns = dayAxis('2026-07-14', '2026-07-16');

    expect(resolveNowPosition(columns, new Date(2027, 0, 1))).toBeUndefined();
  });
});
