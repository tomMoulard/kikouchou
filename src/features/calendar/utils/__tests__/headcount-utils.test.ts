/**
 * @fileoverview Tests for per-day calendar headcounts.
 *
 * @module features/calendar/utils/__tests__/headcount-utils.test
 */

import { describe, it, expect } from 'vitest';

import type {
  HexColor,
  ISODateString,
  Person,
  PersonId,
  RoomAssignment,
  RoomAssignmentId,
  RoomId,
  Transport,
  TransportId,
  TripId,
} from '@/types';
import { listGuestsOnSiteOnDate } from '@/features/persons/utils/guest-presence';

import { buildDailyHeadcounts, isGuestOnSiteOnDate } from '../headcount-utils';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_ID = 'trip-1' as TripId;

function makePerson(args: {
  readonly id: string;
  readonly name?: string;
  readonly headcount?: number;
  readonly stayStartDate?: ISODateString;
  readonly stayEndDate?: ISODateString;
}): Person {
  return {
    id: args.id as PersonId,
    tripId: TRIP_ID,
    name: args.name ?? 'Guest',
    color: '#3b82f6' as HexColor,
    headcount: args.headcount,
    stayStartDate: args.stayStartDate,
    stayEndDate: args.stayEndDate,
  };
}

function makeAssignment(args: {
  readonly id: string;
  readonly personId: string;
  readonly startDate: string;
  readonly endDate: string;
}): RoomAssignment {
  return {
    id: args.id as RoomAssignmentId,
    tripId: TRIP_ID,
    roomId: 'room-1' as RoomId,
    personId: args.personId as PersonId,
    startDate: args.startDate as ISODateString,
    endDate: args.endDate as ISODateString,
  };
}

function makeTransport(args: {
  readonly id: string;
  readonly personId: string;
  readonly type: 'arrival' | 'departure';
  readonly datetime: string;
}): Transport {
  return {
    id: args.id as TransportId,
    tripId: TRIP_ID,
    personId: args.personId as PersonId,
    type: args.type,
    datetime: args.datetime,
    location: 'Gare de Lyon',
    needsPickup: false,
  };
}

const day = (value: string): ISODateString => value as ISODateString;

/** The trip a guest with no dates of their own is assumed to be there for. */
const TRIP_WINDOW = { startDate: day('2024-07-15'), endDate: day('2024-07-20') };

/** A trip with no dates of its own: nothing for an undated guest to fall back on. */
const NO_TRIP_DATES = { startDate: undefined, endDate: undefined };

// ============================================================================
// buildDailyHeadcounts
// ============================================================================

describe('buildDailyHeadcounts', () => {
  it('counts a multi-person guest entry as several people', () => {
    // Tom counts for 1, "Alice+Auré" counts for 2 → 3 people on site.
    const tom = makePerson({
      id: 'p-tom',
      name: 'Tom',
      stayStartDate: day('2024-07-15'),
      stayEndDate: day('2024-07-20'),
    });
    const aliceAndAure = makePerson({
      id: 'p-alice',
      name: 'Alice+Auré',
      headcount: 2,
      stayStartDate: day('2024-07-15'),
      stayEndDate: day('2024-07-20'),
    });

    const counts = buildDailyHeadcounts({
      persons: [tom, aliceAndAure],
      arrivals: [],
      departures: [],
      assignments: [],
      tripWindow: TRIP_WINDOW,
      dayKeys: [day('2024-07-16')],
    });

    expect(counts.get(day('2024-07-16'))).toEqual({ guests: 2, people: 3 });
  });

  it('treats a guest without headcount as one person', () => {
    const person = makePerson({
      id: 'p-1',
      stayStartDate: day('2024-07-15'),
      stayEndDate: day('2024-07-17'),
    });

    const counts = buildDailyHeadcounts({
      persons: [person],
      arrivals: [],
      departures: [],
      assignments: [],
      tripWindow: TRIP_WINDOW,
      dayKeys: [day('2024-07-15'), day('2024-07-16')],
    });

    expect(counts.get(day('2024-07-15'))).toEqual({ guests: 1, people: 1 });
    expect(counts.get(day('2024-07-16'))).toEqual({ guests: 1, people: 1 });
  });

  it('excludes the checkout day (guests do not sleep the night they leave)', () => {
    const person = makePerson({
      id: 'p-1',
      headcount: 3,
      stayStartDate: day('2024-07-15'),
      stayEndDate: day('2024-07-17'),
    });

    const counts = buildDailyHeadcounts({
      persons: [person],
      arrivals: [],
      departures: [],
      assignments: [],
      tripWindow: TRIP_WINDOW,
      dayKeys: [day('2024-07-16'), day('2024-07-17')],
    });

    expect(counts.get(day('2024-07-16'))).toEqual({ guests: 1, people: 3 });
    expect(counts.has(day('2024-07-17'))).toBe(false);
  });

  // The guest's own dates stop before this night, so the bed is the only thing
  // that can put them on it.
  it('counts guests whose presence comes from a room assignment only', () => {
    const person = makePerson({
      id: 'p-1',
      headcount: 2,
      stayStartDate: day('2024-07-14'),
      stayEndDate: day('2024-07-15'),
    });
    const assignment = makeAssignment({
      id: 'a-1',
      personId: 'p-1',
      startDate: '2024-07-16',
      endDate: '2024-07-18',
    });

    const counts = buildDailyHeadcounts({
      persons: [person],
      arrivals: [],
      departures: [],
      assignments: [assignment],
      tripWindow: TRIP_WINDOW,
      dayKeys: [day('2024-07-16')],
    });

    expect(counts.get(day('2024-07-16'))).toEqual({ guests: 1, people: 2 });
  });

  it('counts guests whose presence comes from transports only', () => {
    const person = makePerson({ id: 'p-1', headcount: 2 });

    const counts = buildDailyHeadcounts({
      persons: [person],
      arrivals: [
        makeTransport({
          id: 't-1',
          personId: 'p-1',
          type: 'arrival',
          datetime: '2024-07-15T14:00:00.000Z',
        }),
      ],
      departures: [
        makeTransport({
          id: 't-2',
          personId: 'p-1',
          type: 'departure',
          datetime: '2024-07-18T09:00:00.000Z',
        }),
      ],
      assignments: [],
      tripWindow: TRIP_WINDOW,
      dayKeys: [day('2024-07-16')],
    });

    expect(counts.get(day('2024-07-16'))).toEqual({ guests: 1, people: 2 });
  });

  it('does not double count a guest with both a stay window and an assignment', () => {
    const person = makePerson({
      id: 'p-1',
      headcount: 2,
      stayStartDate: day('2024-07-15'),
      stayEndDate: day('2024-07-18'),
    });
    const assignment = makeAssignment({
      id: 'a-1',
      personId: 'p-1',
      startDate: '2024-07-15',
      endDate: '2024-07-18',
    });

    const counts = buildDailyHeadcounts({
      persons: [person],
      arrivals: [],
      departures: [],
      assignments: [assignment],
      tripWindow: TRIP_WINDOW,
      dayKeys: [day('2024-07-16')],
    });

    expect(counts.get(day('2024-07-16'))).toEqual({ guests: 1, people: 2 });
  });

  it('omits days with nobody on site', () => {
    const person = makePerson({
      id: 'p-1',
      stayStartDate: day('2024-07-15'),
      stayEndDate: day('2024-07-16'),
    });

    const counts = buildDailyHeadcounts({
      persons: [person],
      arrivals: [],
      departures: [],
      assignments: [],
      tripWindow: TRIP_WINDOW,
      dayKeys: [day('2024-07-14'), day('2024-07-15'), day('2024-07-20')],
    });

    expect(counts.has(day('2024-07-14'))).toBe(false);
    expect(counts.has(day('2024-07-20'))).toBe(false);
    expect(counts.size).toBe(1);
  });

  it('clamps invalid stored headcounts to at least one person', () => {
    const person = makePerson({
      id: 'p-1',
      headcount: 0,
      stayStartDate: day('2024-07-15'),
      stayEndDate: day('2024-07-17'),
    });

    const counts = buildDailyHeadcounts({
      persons: [person],
      arrivals: [],
      departures: [],
      assignments: [],
      tripWindow: TRIP_WINDOW,
      dayKeys: [day('2024-07-15')],
    });

    expect(counts.get(day('2024-07-15'))).toEqual({ guests: 1, people: 1 });
  });

  // A guest the host added and left blank is on site for the trip: counting
  // them as nobody made the calendar's nightly total disagree with the guest
  // list the host had just filled in.
  it('counts a guest with no dates of their own for the trip nights', () => {
    const blank = makePerson({ id: 'p-1', name: 'Julie', headcount: 2 });

    const counts = buildDailyHeadcounts({
      persons: [blank],
      arrivals: [],
      departures: [],
      assignments: [],
      tripWindow: TRIP_WINDOW,
      dayKeys: [day('2024-07-14'), day('2024-07-15'), day('2024-07-19'), day('2024-07-20')],
    });

    expect(counts.has(day('2024-07-14'))).toBe(false);
    expect(counts.get(day('2024-07-15'))).toEqual({ guests: 1, people: 2 });
    expect(counts.get(day('2024-07-19'))).toEqual({ guests: 1, people: 2 });
    // The trip's last day is the check-out, so it is not a night on site.
    expect(counts.has(day('2024-07-20'))).toBe(false);
  });

  it('returns an empty map when there are no guests or no days', () => {
    expect(
      buildDailyHeadcounts({
        persons: [],
        arrivals: [],
        departures: [],
        assignments: [],
        tripWindow: TRIP_WINDOW,
        dayKeys: [day('2024-07-15')],
      }).size,
    ).toBe(0);

    expect(
      buildDailyHeadcounts({
        persons: [makePerson({ id: 'p-1' })],
        arrivals: [],
        departures: [],
        assignments: [],
        tripWindow: TRIP_WINDOW,
        dayKeys: [],
      }).size,
    ).toBe(0);
  });
});

// ============================================================================
// isGuestOnSiteOnDate
// ============================================================================

describe('isGuestOnSiteOnDate', () => {
  it('is false when neither the guest nor the trip has any dates', () => {
    expect(
      isGuestOnSiteOnDate({
        person: makePerson({ id: 'p-1' }),
        arrivals: [],
        departures: [],
        assignments: [],
        tripWindow: NO_TRIP_DATES,
        dateKey: day('2024-07-16'),
      }),
    ).toBe(false);
  });

  it('is true for a guest with no dates on a night the trip covers', () => {
    expect(
      isGuestOnSiteOnDate({
        person: makePerson({ id: 'p-1' }),
        arrivals: [],
        departures: [],
        assignments: [],
        tripWindow: TRIP_WINDOW,
        dateKey: day('2024-07-16'),
      }),
    ).toBe(true);
  });

  it('ignores assignments belonging to other guests', () => {
    expect(
      isGuestOnSiteOnDate({
        // Dated, so the trip fallback is not what answers here.
        person: makePerson({
          id: 'p-1',
          stayStartDate: day('2024-07-14'),
          stayEndDate: day('2024-07-15'),
        }),
        arrivals: [],
        departures: [],
        assignments: [
          makeAssignment({
            id: 'a-1',
            personId: 'p-2',
            startDate: '2024-07-15',
            endDate: '2024-07-18',
          }),
        ],
        tripWindow: TRIP_WINDOW,
        dateKey: day('2024-07-16'),
      }),
    ).toBe(false);
  });
});

// ============================================================================
// Sidebar list vs calendar count
// ============================================================================

describe('sidebar list and calendar headcount agree', () => {
  // Regression: the sidebar read a stay-window-only definition of presence and
  // the calendar a room-aware one, so a guest with a bed and nothing else was
  // counted on the calendar and missing from the list beside it.
  it('names the same people it counts when a guest has only a room', () => {
    const dated = makePerson({
      id: 'p-dated',
      name: 'Tom',
      stayStartDate: day('2024-07-15'),
      stayEndDate: day('2024-07-18'),
    });
    // Zoe's own dates end before this night, so only her bed puts her on it.
    const roomOnly = makePerson({
      id: 'p-room-only',
      name: 'Zoe',
      stayStartDate: day('2024-07-14'),
      stayEndDate: day('2024-07-15'),
    });
    const assignments = [
      makeAssignment({
        id: 'a-1',
        personId: 'p-room-only',
        startDate: '2024-07-16',
        endDate: '2024-07-18',
      }),
    ];
    const dateKey = day('2024-07-16');

    const listed = listGuestsOnSiteOnDate({
      persons: [dated, roomOnly],
      arrivals: [],
      departures: [],
      assignments,
      tripWindow: TRIP_WINDOW,
      dateKey,
    });
    const counts = buildDailyHeadcounts({
      persons: [dated, roomOnly],
      arrivals: [],
      departures: [],
      assignments,
      tripWindow: TRIP_WINDOW,
      dayKeys: [dateKey],
    });

    expect(listed.map((p) => p.name)).toEqual(['Tom', 'Zoe']);
    expect(counts.get(dateKey)?.guests).toBe(listed.length);
  });

  it('keeps the people total above the row count for a multi-person entry', () => {
    const couple = makePerson({ id: 'p-couple', name: 'Alice+Auré', headcount: 2 });
    const assignments = [
      makeAssignment({
        id: 'a-1',
        personId: 'p-couple',
        startDate: '2024-07-15',
        endDate: '2024-07-18',
      }),
    ];
    const dateKey = day('2024-07-16');

    const listed = listGuestsOnSiteOnDate({
      persons: [couple],
      arrivals: [],
      departures: [],
      assignments,
      tripWindow: TRIP_WINDOW,
      dateKey,
    });
    const counts = buildDailyHeadcounts({
      persons: [couple],
      arrivals: [],
      departures: [],
      assignments,
      tripWindow: TRIP_WINDOW,
      dayKeys: [dateKey],
    });

    expect(listed).toHaveLength(1);
    expect(counts.get(dateKey)).toEqual({ guests: 1, people: 2 });
  });
});
