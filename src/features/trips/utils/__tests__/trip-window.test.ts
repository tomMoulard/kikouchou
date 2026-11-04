/**
 * @fileoverview The window a trip is planned in, with or without its own dates.
 *
 * @module features/trips/utils/__tests__/trip-window.test
 */

import { describe, expect, it } from 'vitest';

import {
  getTripDates,
  inferGuestStayWindow,
  resolveTripWorkingWindow,
  resolveUndatedTimelineRange,
  tripHasDates,
  UNDATED_TIMELINE_DEFAULT_DAYS,
  UNDATED_TIMELINE_MAX_DAYS,
} from '../trip-window';
import { buildDayColumns } from '@/lib/utils/trip-days';
import { hexColor, isoDate } from '@/test/utils';
import type { ISODateString, Person, PersonId, Transport, TransportId, TripId } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_ID = 'trip-1' as TripId;

function person(id: string, stay: Partial<Pick<Person, 'stayStartDate' | 'stayEndDate'>> = {}): Person {
  return {
    id: id as PersonId,
    tripId: TRIP_ID,
    name: id,
    color: hexColor('#6366f1'),
    createdAt: 0,
    updatedAt: 0,
    ...stay,
  } as Person;
}

function transport(id: string, personId: string, type: Transport['type'], datetime: string): Transport {
  return {
    id: id as TransportId,
    tripId: TRIP_ID,
    personId: personId as PersonId,
    type,
    datetime,
    location: 'Station',
    needsPickup: false,
    createdAt: 0,
    updatedAt: 0,
  } as Transport;
}

// ============================================================================
// getTripDates / tripHasDates
// ============================================================================

describe('getTripDates', () => {
  it('returns both dates of a dated trip', () => {
    expect(
      getTripDates({ startDate: isoDate('2026-07-10'), endDate: isoDate('2026-07-15') }),
    ).toEqual({ startDate: '2026-07-10', endDate: '2026-07-15' });
  });

  it.each([
    ['no trip', undefined],
    ['a null trip', null],
    ['a trip without dates', {}],
    ['one date alone', { startDate: isoDate('2026-07-10') }],
    ['empty strings, the old "not set yet"', { startDate: '' as ISODateString, endDate: '' as ISODateString }],
    ['an unreadable date', { startDate: 'soon' as ISODateString, endDate: isoDate('2026-07-15') }],
    ['an inverted window', { startDate: isoDate('2026-07-15'), endDate: isoDate('2026-07-10') }],
  ])('answers null for %s', (_label, trip) => {
    expect(getTripDates(trip)).toBeNull();
    expect(tripHasDates(trip)).toBe(false);
  });

  it('says a dated trip has dates', () => {
    expect(tripHasDates({ startDate: isoDate('2026-07-10'), endDate: isoDate('2026-07-10') })).toBe(true);
  });
});

// ============================================================================
// inferGuestStayWindow
// ============================================================================

describe('inferGuestStayWindow', () => {
  it('spans the earliest arrival to the latest departure of the guests', () => {
    const window = inferGuestStayWindow([
      person('a', { stayStartDate: isoDate('2026-07-12'), stayEndDate: isoDate('2026-07-14') }),
      person('b', { stayStartDate: isoDate('2026-07-10'), stayEndDate: isoDate('2026-07-13') }),
      person('c', { stayStartDate: isoDate('2026-07-11'), stayEndDate: isoDate('2026-07-18') }),
    ]);

    expect(window).toEqual({ startDate: '2026-07-10', endDate: '2026-07-18' });
  });

  it('counts a guest known by one bound only', () => {
    expect(inferGuestStayWindow([person('a', { stayStartDate: isoDate('2026-07-12') })])).toEqual({
      startDate: '2026-07-12',
      endDate: '2026-07-12',
    });
  });

  it('reads a guest with no stay dates from their transports', () => {
    const window = inferGuestStayWindow(
      [person('a')],
      [transport('t1', 'a', 'arrival', '2026-07-12T10:00:00')],
      [transport('t2', 'a', 'departure', '2026-07-16T10:00:00')],
    );

    expect(window).toEqual({ startDate: '2026-07-12', endDate: '2026-07-16' });
  });

  it("reaches a guest's further stays", () => {
    const window = inferGuestStayWindow([
      {
        ...person('a', { stayStartDate: isoDate('2026-07-01'), stayEndDate: isoDate('2026-07-22') }),
        extraStays: [{ startDate: isoDate('2026-09-24'), endDate: isoDate('2026-09-30') }],
      },
    ]);

    expect(window).toEqual({ startDate: '2026-07-01', endDate: '2026-09-30' });
  });

  it('answers null when no guest has a known date', () => {
    expect(inferGuestStayWindow([])).toBeNull();
    expect(inferGuestStayWindow([person('a'), person('b')])).toBeNull();
  });

  it('skips a stay date that is not a calendar day', () => {
    const window = inferGuestStayWindow([
      person('a', { stayStartDate: 'soon' as ISODateString, stayEndDate: isoDate('2026-07-14') }),
    ]);

    expect(window).toEqual({ startDate: '2026-07-14', endDate: '2026-07-14' });
  });
});

// ============================================================================
// resolveTripWorkingWindow
// ============================================================================

describe('resolveTripWorkingWindow', () => {
  const guests = [
    person('a', { stayStartDate: isoDate('2026-07-12'), stayEndDate: isoDate('2026-07-14') }),
  ];

  it('prefers the trip dates over the guests', () => {
    expect(
      resolveTripWorkingWindow(
        { startDate: isoDate('2026-08-01'), endDate: isoDate('2026-08-05') },
        guests,
      ),
    ).toEqual({ startDate: '2026-08-01', endDate: '2026-08-05' });
  });

  it('falls back on the guests for a trip without dates', () => {
    expect(resolveTripWorkingWindow({}, guests)).toEqual({
      startDate: '2026-07-12',
      endDate: '2026-07-14',
    });
  });

  it('answers null when neither the trip nor a guest has dates', () => {
    expect(resolveTripWorkingWindow(undefined, [person('a')])).toBeNull();
  });
});

// ============================================================================
// resolveUndatedTimelineRange
// ============================================================================

describe('resolveUndatedTimelineRange', () => {
  const today = isoDate('2026-11-04');

  it('shows one week from today when nothing is known', () => {
    const range = resolveUndatedTimelineRange([], today);

    expect(range).toEqual({ startDate: '2026-11-04', endDate: '2026-11-10' });
    expect(buildDayColumns(range.startDate, range.endDate)).toHaveLength(
      UNDATED_TIMELINE_DEFAULT_DAYS,
    );
  });

  it('spans every known day, in any order, ignoring blanks and junk', () => {
    expect(
      resolveUndatedTimelineRange(
        ['2026-07-14', null, undefined, '', 'nope', '2026-07-10', '2026-07-12'],
        today,
      ),
    ).toEqual({ startDate: '2026-07-10', endDate: '2026-07-14' });
  });

  it('keeps the earliest days when the known span is too wide to draw', () => {
    const range = resolveUndatedTimelineRange(['2026-01-01', '2027-12-31'], today);

    expect(range.startDate).toBe('2026-01-01');
    expect(buildDayColumns(range.startDate, range.endDate)).toHaveLength(
      UNDATED_TIMELINE_MAX_DAYS,
    );
  });

  it('falls back on today when today itself is unreadable', () => {
    const range = resolveUndatedTimelineRange([], 'nope' as ISODateString);

    expect(buildDayColumns(range.startDate, range.endDate)).toHaveLength(
      UNDATED_TIMELINE_DEFAULT_DAYS,
    );
  });
});
