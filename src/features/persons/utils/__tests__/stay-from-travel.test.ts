/**
 * @fileoverview Tests for moving a guest's stay to match a journey of theirs.
 */

import { describe, expect, it } from 'vitest';

import type { ISODateString } from '@/types';

import { stayFollowingTravel } from '../stay-from-travel';

const day = (value: string) => value as ISODateString;

/** One stated stay, 27 Nov to 2 Dec, as the sample guest had. */
const STAYING = { stayStartDate: day('2026-11-27'), stayEndDate: day('2026-12-02') };

describe('stayFollowingTravel', () => {
  // The bug: the booking moved the trip and added the trains, and the guest
  // stayed on the calendar from 27 Nov to 2 Dec.
  it('moves a stay to a booking, outbound then return', () => {
    const outbound = stayFollowingTravel(STAYING, 'arrival', '2026-12-17T11:10:00');
    expect(outbound).toEqual({ stayStartDate: '2026-12-17', stayEndDate: '2026-12-17' });

    const back = stayFollowingTravel({ ...STAYING, ...outbound }, 'departure', '2027-01-05T18:50:00');
    expect(back).toEqual({ stayStartDate: '2026-12-17', stayEndDate: '2027-01-05' });
  });

  it('moves only the start for an arrival inside the stay', () => {
    expect(stayFollowingTravel(STAYING, 'arrival', '2026-11-29T09:00:00')).toEqual({
      stayStartDate: '2026-11-29',
      stayEndDate: '2026-12-02',
    });
  });

  it('moves only the end for a departure inside the stay', () => {
    expect(stayFollowingTravel(STAYING, 'departure', '2026-11-30T18:00:00')).toEqual({
      stayStartDate: '2026-11-27',
      stayEndDate: '2026-11-30',
    });
  });

  it('carries the start back with a departure before the stay', () => {
    expect(stayFollowingTravel(STAYING, 'departure', '2026-11-20T18:00:00')).toEqual({
      stayStartDate: '2026-11-20',
      stayEndDate: '2026-11-20',
    });
  });

  it('leaves a stay that already matches', () => {
    expect(stayFollowingTravel(STAYING, 'arrival', '2026-11-27T22:00:00')).toBeNull();
    expect(stayFollowingTravel(STAYING, 'departure', '2026-12-02T07:00:00')).toBeNull();
  });

  // Their stay is already read from their travel.
  it('leaves a guest with no stated stay', () => {
    expect(stayFollowingTravel({}, 'arrival', '2026-12-17T11:10:00')).toBeNull();
    expect(
      stayFollowingTravel({ stayStartDate: day('2026-11-27') }, 'arrival', '2026-12-17T11:10:00'),
    ).toBeNull();
  });

  // Which stay the journey belongs to would be a guess.
  it('leaves a guest who stays several times', () => {
    expect(
      stayFollowingTravel(
        { ...STAYING, extraStays: [{ startDate: day('2026-12-20'), endDate: day('2026-12-24') }] },
        'arrival',
        '2026-12-19T11:10:00',
      ),
    ).toBeNull();
  });

  it('leaves a stay it cannot read, and a time it cannot parse', () => {
    expect(
      stayFollowingTravel(
        { stayStartDate: day('2026-12-02'), stayEndDate: day('2026-11-27') },
        'arrival',
        '2026-12-17T11:10:00',
      ),
    ).toBeNull();
    expect(stayFollowingTravel(STAYING, 'arrival', 'soon')).toBeNull();
  });
});
