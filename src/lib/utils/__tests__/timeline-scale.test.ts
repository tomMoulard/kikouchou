/**
 * @fileoverview Tests for the timeline's time axis.
 * @module lib/utils/__tests__/timeline-scale.test
 */

import { describe, expect, it } from 'vitest';
import { enUS } from 'date-fns/locale';

import {
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

function dayAxis(startKey: string, endKey: string) {
  const days = buildDayColumns(startKey as ISODateString, endKey as ISODateString);
  return columnsFromDays(days, toDayKeys(days), enUS);
}

// ============================================================================
// Tests
// ============================================================================

describe('weekend columns', () => {
  it('marks Saturday and Sunday on a day axis', () => {
    // 2026-07-17 is a Friday, so the axis runs Fri, Sat, Sun, Mon.
    const columns = dayAxis('2026-07-17', '2026-07-20');

    expect(columns.map((column) => column.isWeekend)).toEqual([false, true, true, false]);
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
