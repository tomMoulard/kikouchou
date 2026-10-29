/**
 * @fileoverview Tests for the days the arrival question offers.
 *
 * The page tests click through the question; these pin the edges of the list,
 * which decide whether the question is asked at all: a guest with no day to
 * pick goes straight to the trip.
 *
 * @module features/sharing/utils/__tests__/arrival-days.test
 */

import { describe, expect, it } from 'vitest';

import { listArrivalDays } from '../arrival-days';

import type { ISODateString } from '@/types';

const day = (value: string): ISODateString => value as ISODateString;
const TRIP = { startDate: day('2026-07-15'), endDate: day('2026-07-18') };

describe('listArrivalDays', () => {
  it('offers every night of the trip, and not the day everybody leaves', () => {
    expect(listArrivalDays(TRIP, undefined)).toEqual(['2026-07-15', '2026-07-16', '2026-07-17']);
  });

  it('stops before the day the guest already said they leave', () => {
    expect(listArrivalDays(TRIP, day('2026-07-17'))).toEqual(['2026-07-15', '2026-07-16']);
  });

  it('ignores a leaving day after the trip ends', () => {
    expect(listArrivalDays(TRIP, day('2026-07-30'))).toEqual([
      '2026-07-15',
      '2026-07-16',
      '2026-07-17',
    ]);
  });

  it('offers the one day of a day trip', () => {
    expect(
      listArrivalDays({ startDate: day('2026-07-15'), endDate: day('2026-07-15') }, undefined),
    ).toEqual(['2026-07-15']);
  });

  it('offers nothing for a trip with no usable dates', () => {
    expect(listArrivalDays({ startDate: day(''), endDate: day('') }, undefined)).toEqual([]);
    expect(
      listArrivalDays({ startDate: day('soon'), endDate: day('later') }, undefined),
    ).toEqual([]);
  });
});
