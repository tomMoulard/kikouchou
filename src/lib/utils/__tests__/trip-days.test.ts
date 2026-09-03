/**
 * Unit tests for the trip day axis.
 *
 * These assert the day axis in the app's canonical convention: local calendar
 * days. They read the columns back with `toLocalISODateString` and, separately,
 * with `format()` — the two ways the app actually consumes a column — so a
 * column that keys as one day but *prints* as another fails here.
 *
 * @module lib/utils/__tests__/trip-days.test
 */
import { describe, it, expect } from 'vitest';
import { format } from 'date-fns';

import { toLocalISODateString } from '@/lib/db/utils';
import { isoDate } from '@/test/utils';
import type { ShareId, Trip, TripId } from '@/types';

import { buildDayColumns, buildTripDayColumns, parseLocalDayKey, toDayKeys } from '../trip-days';

function makeTrip(startDate: string, endDate: string): Trip {
  return {
    id: 'trip-1' as TripId,
    name: 'Trip',
    startDate: isoDate(startDate),
    endDate: isoDate(endDate),
    shareId: 'share-1' as ShareId,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('parseLocalDayKey', () => {
  it('round-trips through toLocalISODateString', () => {
    for (const key of ['2024-01-01', '2024-07-15', '2024-12-31', '2024-02-29']) {
      const parsed = parseLocalDayKey(key);
      expect(parsed).not.toBeNull();
      expect(toLocalISODateString(parsed!)).toBe(key);
    }
  });

  it('returns local midnight, not a UTC instant', () => {
    const parsed = parseLocalDayKey('2024-07-15');

    expect(parsed).not.toBeNull();
    expect(parsed!.getFullYear()).toBe(2024);
    expect(parsed!.getMonth()).toBe(6);
    expect(parsed!.getDate()).toBe(15);
    // Zones without a midnight on a DST-forward day resolve to 01:00; every
    // other zone is exactly midnight.
    expect(parsed!.getHours()).toBeLessThanOrEqual(1);
    expect(parsed!.getMinutes()).toBe(0);
    expect(parsed!.getSeconds()).toBe(0);
    expect(parsed!.getMilliseconds()).toBe(0);
  });

  it('prints the day it was given, in the viewer’s locale', () => {
    const parsed = parseLocalDayKey('2024-07-15');

    expect(format(parsed!, 'yyyy-MM-dd')).toBe('2024-07-15');
  });

  it('rejects days that are not on the calendar', () => {
    expect(parseLocalDayKey('2024-02-30')).toBeNull();
    expect(parseLocalDayKey('2023-02-29')).toBeNull();
    expect(parseLocalDayKey('2024-13-01')).toBeNull();
  });

  it('rejects malformed keys', () => {
    expect(parseLocalDayKey('nope')).toBeNull();
    expect(parseLocalDayKey('')).toBeNull();
    expect(parseLocalDayKey('15/07/2024')).toBeNull();
    expect(parseLocalDayKey('2024-07-15T10:00:00Z')).toBeNull();
  });
});

describe('buildTripDayColumns', () => {
  it('returns one column per day, both ends inclusive', () => {
    const days = buildTripDayColumns(makeTrip('2024-07-15', '2024-07-18'));

    expect(toDayKeys(days)).toEqual([
      '2024-07-15',
      '2024-07-16',
      '2024-07-17',
      '2024-07-18',
    ]);
  });

  it('labels each column with the day its key names', () => {
    // The header prints the column Date with date-fns, which reads LOCAL
    // components. A UTC-stepped column keyed '2024-07-15' printed "14" for
    // anyone west of Greenwich — the bug that forced a key→Date workaround
    // in TripTimelineFrame.
    const days = buildTripDayColumns(makeTrip('2024-07-15', '2024-07-18'));

    expect(days.map((day) => format(day, 'yyyy-MM-dd'))).toEqual(toDayKeys(days));
  });

  it('returns a single column for a one-day trip', () => {
    const days = buildTripDayColumns(makeTrip('2024-07-15', '2024-07-15'));

    expect(toDayKeys(days)).toEqual(['2024-07-15']);
  });

  it('returns nothing when the end precedes the start', () => {
    expect(buildTripDayColumns(makeTrip('2024-07-18', '2024-07-15'))).toEqual([]);
  });

  it('returns nothing for unparseable dates', () => {
    expect(buildTripDayColumns(makeTrip('nope', '2024-07-15'))).toEqual([]);
    expect(buildTripDayColumns(makeTrip('2024-07-15', '2024-02-30'))).toEqual([]);
  });

  it('does not skip or repeat a day across a DST transition', () => {
    // Europe/Paris springs forward on 2024-03-31; most of the US on 2024-03-10.
    const days = buildTripDayColumns(makeTrip('2024-03-08', '2024-04-02'));

    const keys = toDayKeys(days);
    expect(keys).toHaveLength(26);
    expect(new Set(keys).size).toBe(26);
    expect(keys[0]).toBe('2024-03-08');
    expect(keys[keys.length - 1]).toBe('2024-04-02');
    expect(days.map((day) => format(day, 'yyyy-MM-dd'))).toEqual(keys);
  });

  it('does not skip or repeat a day across a fall-back transition', () => {
    // Europe/Paris falls back on 2024-10-27; most of the US on 2024-11-03.
    const days = buildTripDayColumns(makeTrip('2024-10-25', '2024-11-05'));

    const keys = toDayKeys(days);
    expect(keys).toHaveLength(12);
    expect(new Set(keys).size).toBe(12);
    expect(keys[keys.length - 1]).toBe('2024-11-05');
  });

  it('spans a year boundary', () => {
    const days = buildTripDayColumns(makeTrip('2024-12-30', '2025-01-02'));

    expect(toDayKeys(days)).toEqual([
      '2024-12-30',
      '2024-12-31',
      '2025-01-01',
      '2025-01-02',
    ]);
  });
});

describe('buildDayColumns', () => {
  it('keys an arbitrary range the same way the trip axis does', () => {
    const range = buildDayColumns(isoDate('2024-07-15'), isoDate('2024-07-17'));

    expect(toDayKeys(range)).toEqual(['2024-07-15', '2024-07-16', '2024-07-17']);
    expect(toDayKeys(range)).toEqual(
      toDayKeys(buildTripDayColumns(makeTrip('2024-07-15', '2024-07-17'))),
    );
  });
});
