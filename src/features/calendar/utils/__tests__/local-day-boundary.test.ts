/**
 * @fileoverview Regression tests for the calendar's day boundary.
 *
 * Transports are stored as UTC instants — `TransportForm` writes
 * `new Date(datetimeLocalInput).toISOString()` — so a 00:30 arrival in Paris is
 * persisted as `…T22:30:00.000Z` the evening before. Every reader that sliced
 * the first ten characters off that string was reading the **UTC** day, and put
 * the guest on the calendar one day early: one column left on the timeline, one
 * extra night in the headcount.
 *
 * These tests pin the day boundary itself, so they live apart from the
 * behavioural suites for the timeline and the headcounts. Every datetime is
 * built from a wall-clock day and time in the runner's own zone, so no
 * assertion here encodes the machine's offset.
 *
 * @module features/calendar/utils/__tests__/local-day-boundary.test
 */

import { describe, expect, it } from 'vitest';

import { localInstant } from '@/test/utils';
import type {
  HexColor,
  ISODateString,
  Person,
  PersonId,
  Transport,
  Trip,
  TripId,
} from '@/types';

import { buildDailyHeadcounts } from '../headcount-utils';
import { buildCalendarTimelineModel } from '../timeline-utils';

// ============================================================================
// Fixtures
// ============================================================================

function iso(value: string): ISODateString {
  return value as ISODateString;
}

const TRIP: Trip = {
  id: 'trip-1' as TripId,
  shareId: 'share-1' as Trip['shareId'],
  name: 'Trip',
  startDate: iso('2026-04-10'),
  endDate: iso('2026-04-14'),
  createdAt: 0,
  updatedAt: 0,
};

/** Day keys of `TRIP`, in order — index 0 is 10 April. */
const DAY_KEYS = [
  iso('2026-04-10'),
  iso('2026-04-11'),
  iso('2026-04-12'),
  iso('2026-04-13'),
  iso('2026-04-14'),
];

/** A guest with no stay dates, so their window comes from transports alone. */
const GUEST: Person = {
  id: 'p1' as PersonId,
  tripId: TRIP.id,
  name: 'Alex',
  color: '#3b82f6' as HexColor,
};

function transport(
  id: string,
  type: Transport['type'],
  day: string,
  time: string,
): Transport {
  return {
    id: id as Transport['id'],
    tripId: TRIP.id,
    personId: GUEST.id,
    type,
    datetime: localInstant(day, time),
    location: 'CDG',
    needsPickup: false,
  };
}

/** Lands just after midnight on 11 April — stored on 10 April UTC east of Greenwich. */
const LATE_ARRIVAL = transport('a1', 'arrival', '2026-04-11', '00:30');

/** Leaves just before midnight on 13 April — stored on 14 April UTC west of Greenwich. */
const LATE_DEPARTURE = transport('d1', 'departure', '2026-04-13', '23:30');

// ============================================================================
// Tests
// ============================================================================

describe('calendar day boundary', () => {
  it('starts the timeline stay span on the day the guest lands locally', () => {
    const model = buildCalendarTimelineModel({
      trip: TRIP,
      persons: [GUEST],
      rooms: [],
      assignments: [],
      arrivals: [LATE_ARRIVAL],
      departures: [LATE_DEPARTURE],
      unknownLabel: 'Unknown',
    });

    const row = model.rows[0];
    expect(row?.person.id).toBe(GUEST.id);
    // Index 1 is 11 April. Reading the UTC day gave index 0 for a viewer ahead
    // of UTC — the guest appeared a column early.
    expect(row?.staySpan?.startIndex).toBe(1);
    // Check-out is 13 April (index 3), so the last night slept is the 12th.
    expect(row?.staySpan?.endIndex).toBe(2);
    expect(row?.checkoutDayIndex).toBe(3);
  });

  it('counts the arrival night once, on the night the guest actually sleeps', () => {
    const counts = buildDailyHeadcounts({
      persons: [GUEST],
      arrivals: [LATE_ARRIVAL],
      departures: [LATE_DEPARTURE],
      assignments: [],
      tripWindow: { startDate: TRIP.startDate, endDate: TRIP.endDate },
      dayKeys: DAY_KEYS,
    });

    // Nobody on site the night before they land.
    expect(counts.get(iso('2026-04-10'))).toBeUndefined();
    expect(counts.get(iso('2026-04-11'))).toEqual({ guests: 1, people: 1 });
    expect(counts.get(iso('2026-04-12'))).toEqual({ guests: 1, people: 1 });
    // Departure day is not a night on site — and the 23:30 departure must not
    // roll into the 14th for a viewer behind UTC.
    expect(counts.get(iso('2026-04-13'))).toBeUndefined();
    expect(counts.get(iso('2026-04-14'))).toBeUndefined();
  });

  it('puts a late-evening transport marker in the day column it belongs to', () => {
    const model = buildCalendarTimelineModel({
      trip: TRIP,
      persons: [GUEST],
      rooms: [],
      assignments: [],
      arrivals: [LATE_ARRIVAL],
      departures: [LATE_DEPARTURE],
      unknownLabel: 'Unknown',
    });

    const indexByTransportId = new Map(
      (model.rows[0]?.items ?? [])
        .filter((item) => item.kind === 'transport')
        .map((item) => [item.transport.id, item.startIndex]),
    );

    expect(indexByTransportId.get(LATE_ARRIVAL.id)).toBe(1);
    expect(indexByTransportId.get(LATE_DEPARTURE.id)).toBe(3);
  });
});
