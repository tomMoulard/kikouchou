/**
 * Unit tests for trip day column building.
 *
 * @module lib/utils/__tests__/trip-days.test
 */
import { describe, it, expect } from 'vitest';

import { toISODateString } from '@/lib/db/utils';
import { isoDate } from '@/test/utils';
import type { ShareId, Trip, TripId } from '@/types';

import { buildTripDayColumns } from '../trip-days';

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

describe('buildTripDayColumns', () => {
  it('returns one column per day, both ends inclusive', () => {
    const days = buildTripDayColumns(makeTrip('2024-07-15', '2024-07-18'));

    expect(days.map((day) => toISODateString(day))).toEqual([
      '2024-07-15',
      '2024-07-16',
      '2024-07-17',
      '2024-07-18',
    ]);
  });

  it('returns a single column for a one-day trip', () => {
    const days = buildTripDayColumns(makeTrip('2024-07-15', '2024-07-15'));

    expect(days).toHaveLength(1);
  });

  it('returns nothing when the end precedes the start', () => {
    expect(buildTripDayColumns(makeTrip('2024-07-18', '2024-07-15'))).toEqual([]);
  });

  it('returns nothing for unparseable dates', () => {
    expect(buildTripDayColumns(makeTrip('nope', '2024-07-15'))).toEqual([]);
  });

  it('does not skip or repeat a day across a DST transition', () => {
    // Europe/Paris springs forward on 2024-03-31
    const days = buildTripDayColumns(makeTrip('2024-03-29', '2024-04-02'));

    expect(days.map((day) => toISODateString(day))).toEqual([
      '2024-03-29',
      '2024-03-30',
      '2024-03-31',
      '2024-04-01',
      '2024-04-02',
    ]);
  });
});
