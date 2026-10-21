/**
 * @fileoverview Tests for calendar timeline utility functions.
 * @module features/calendar/utils/__tests__/timeline-utils.test
 */

import { describe, it, expect } from 'vitest';
import {
  buildCalendarTimelineModel,
  collectAssignmentDayKeys,
  collectTransportDayKeys,
} from '../timeline-utils';
import type {
  HexColor,
  ISODateString,
  Person,
  Room,
  RoomAssignment,
  Transport,
  Trip,
  TripId,
  PersonId,
  RoomId,
} from '@/types';

// ============================================================================
// Helpers
// ============================================================================

function iso(value: string): ISODateString {
  return value as ISODateString;
}

/**
 * A stored instant for a wall-clock time in the runner's timezone — the shape
 * `TransportForm` writes (`new Date(datetimeLocalInput).toISOString()`).
 *
 * A literal like `'2026-04-01T14:00:00Z'` would name a different calendar day
 * depending on the machine's offset (2 April at UTC+14, 1 April at UTC-11), so
 * a test asserting which day column it lands on would encode that offset.
 */
function localInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): Transport['datetime'] {
  return new Date(year, month - 1, day, hour, minute).toISOString() as Transport['datetime'];
}

function createTrip(overrides?: Partial<Trip>): Trip {
  return {
    id: 'trip-1' as TripId,
    shareId: 'share-1' as Trip['shareId'],
    name: 'Trip',
    startDate: iso('2026-04-01'),
    endDate: iso('2026-04-05'),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

const p1: Person = {
  id: 'p1' as PersonId,
  tripId: 'trip-1' as TripId,
  name: 'Alex',
  color: '#3b82f6' as HexColor,
};

const p2: Person = {
  id: 'p2' as PersonId,
  tripId: 'trip-1' as TripId,
  name: 'Sam',
  color: '#ef4444' as HexColor,
};

const room1: Room = {
  id: 'r1' as RoomId,
  tripId: 'trip-1' as TripId,
  name: 'Room 1',
  capacity: 2,
  order: 0,
};

// ============================================================================
// Tests
// ============================================================================

describe('buildCalendarTimelineModel', () => {
  it('builds empty model when no persons', () => {
    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [],
      rooms: [room1],
      assignments: [],
      arrivals: [],
      departures: [],
      unknownLabel: 'Unknown',
    });

    expect(model.rows).toHaveLength(0);
    expect(model.tripDays.length).toBeGreaterThan(0);
    expect(model.dayKeys.length).toBeGreaterThan(0);
  });

  it('generates trip days from trip date range', () => {
    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [p1],
      rooms: [],
      assignments: [],
      arrivals: [],
      departures: [],
      unknownLabel: 'Unknown',
    });

    // 5 days: Apr 1-5
    expect(model.dayKeys).toHaveLength(5);
    expect(model.dayKeys[0]).toBe('2026-04-01');
    expect(model.dayKeys[4]).toBe('2026-04-05');
  });

  it('creates a row for each person', () => {
    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [p1, p2],
      rooms: [],
      assignments: [],
      arrivals: [],
      departures: [],
      unknownLabel: 'Unknown',
    });

    expect(model.rows).toHaveLength(2);
    expect(model.rows[0]!.person.name).toBe('Alex');
    expect(model.rows[1]!.person.name).toBe('Sam');
  });

  it('maps room assignments to timeline items', () => {
    const assignment: RoomAssignment = {
      id: 'a1' as RoomAssignment['id'],
      tripId: 'trip-1' as TripId,
      roomId: 'r1' as RoomId,
      personId: 'p1' as PersonId,
      startDate: iso('2026-04-01'),
      endDate: iso('2026-04-03'),
    };

    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [p1],
      rooms: [room1],
      assignments: [assignment],
      arrivals: [],
      departures: [],
      unknownLabel: 'Unknown',
    });

    const row = model.rows[0]!;
    expect(row.items.length).toBe(1);
    expect(row.items[0]!.kind).toBe('assignment');
    expect(row.items[0]!.label).toBe('Room 1');
  });

  it('uses unknownLabel when room is not found', () => {
    const assignment: RoomAssignment = {
      id: 'a1' as RoomAssignment['id'],
      tripId: 'trip-1' as TripId,
      roomId: 'nonexistent' as RoomId,
      personId: 'p1' as PersonId,
      startDate: iso('2026-04-01'),
      endDate: iso('2026-04-03'),
    };

    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [p1],
      rooms: [room1],
      assignments: [assignment],
      arrivals: [],
      departures: [],
      unknownLabel: 'No Room',
    });

    const row = model.rows[0]!;
    expect(row.items.length).toBe(1);
    expect(row.items[0]!.label).toBe('No Room');
  });

  it('renders transport items for arrivals and departures', () => {
    const arrival: Transport = {
      id: 'tr1' as Transport['id'],
      tripId: 'trip-1' as TripId,
      personId: 'p1' as PersonId,
      type: 'arrival',
      datetime: localInstant(2026, 4, 1, 14),
      location: 'Airport',
      needsPickup: false,
    };

    const departure: Transport = {
      id: 'tr2' as Transport['id'],
      tripId: 'trip-1' as TripId,
      personId: 'p1' as PersonId,
      type: 'departure',
      datetime: localInstant(2026, 4, 5, 10),
      location: 'Train Station',
      needsPickup: false,
    };

    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [p1],
      rooms: [],
      assignments: [],
      arrivals: [arrival],
      departures: [departure],
      unknownLabel: 'Unknown',
    });

    const row = model.rows[0]!;
    // Both arrival and departure should show as items
    expect(row.items.length).toBe(2);
  });

  it('derives stay span from transports', () => {
    const arrival: Transport = {
      id: 'tr1' as Transport['id'],
      tripId: 'trip-1' as TripId,
      personId: 'p1' as PersonId,
      type: 'arrival',
      datetime: localInstant(2026, 4, 1, 14),
      location: 'Airport',
      needsPickup: false,
    };

    const departure: Transport = {
      id: 'tr2' as Transport['id'],
      tripId: 'trip-1' as TripId,
      personId: 'p1' as PersonId,
      type: 'departure',
      datetime: localInstant(2026, 4, 5, 10),
      location: 'Airport',
      needsPickup: false,
    };

    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [p1],
      rooms: [],
      assignments: [],
      arrivals: [arrival],
      departures: [departure],
      unknownLabel: 'Unknown',
    });

    const row = model.rows[0]!;
    // Stay span should be derived from arrival (Apr 1) to departure-1 (Apr 4)
    expect(row.staySpan).toBeDefined();
    expect(row.staySpan!.startIndex).toBe(0);
    expect(row.staySpan!.endIndex).toBe(3);
  });

  it('falls back to person stayStartDate/stayEndDate when no transports', () => {
    const personWithStay: Person = {
      ...p1,
      stayStartDate: iso('2026-04-02'),
      stayEndDate: iso('2026-04-04'),
    };

    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [personWithStay],
      rooms: [],
      assignments: [],
      arrivals: [],
      departures: [],
      unknownLabel: 'Unknown',
    });

    const row = model.rows[0]!;
    expect(row.staySpan).toBeDefined();
    expect(row.staySpan!.startIndex).toBe(1); // Apr 2
    expect(row.staySpan!.endIndex).toBe(2);   // Apr 3 (last night before checkout)
  });

  it('prefers explicit person stay dates over transport-derived bounds', () => {
    const personWithStay: Person = {
      ...p1,
      stayStartDate: iso('2026-04-03'),
      stayEndDate: iso('2026-04-04'),
    };
    const arrival: Transport = {
      id: 'tr-explicit-1' as Transport['id'],
      tripId: 'trip-1' as TripId,
      personId: 'p1' as PersonId,
      type: 'arrival',
      datetime: localInstant(2026, 4, 1, 14),
      location: 'Airport',
      needsPickup: false,
    };
    const departure: Transport = {
      id: 'tr-explicit-2' as Transport['id'],
      tripId: 'trip-1' as TripId,
      personId: 'p1' as PersonId,
      type: 'departure',
      datetime: localInstant(2026, 4, 5, 10),
      location: 'Airport',
      needsPickup: false,
    };

    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [personWithStay],
      rooms: [],
      assignments: [],
      arrivals: [arrival],
      departures: [departure],
      unknownLabel: 'Unknown',
    });

    const row = model.rows[0]!;
    expect(row.staySpan).toBeDefined();
    expect(row.staySpan!.startIndex).toBe(2); // Apr 3
    expect(row.staySpan!.endIndex).toBe(2);   // Apr 3 (checkout Apr 4)
  });

  it('clips assignment bars to explicit stay dates', () => {
    const personWithStay: Person = {
      ...p1,
      stayStartDate: iso('2026-04-03'),
      stayEndDate: iso('2026-04-05'),
    };
    const assignment: RoomAssignment = {
      id: 'clip-a1' as RoomAssignment['id'],
      tripId: 'trip-1' as TripId,
      roomId: 'r1' as RoomId,
      personId: 'p1' as PersonId,
      startDate: iso('2026-04-01'),
      endDate: iso('2026-04-06'),
    };

    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [personWithStay],
      rooms: [room1],
      assignments: [assignment],
      arrivals: [],
      departures: [],
      unknownLabel: 'Unknown',
    });

    const row = model.rows[0]!;
    const assignmentItem = row.items.find((i) => i.kind === 'assignment');
    expect(assignmentItem).toBeDefined();
    expect(assignmentItem!.startIndex).toBe(2); // Apr 3
    expect(assignmentItem!.endIndex).toBe(3);   // Apr 4 (last night before checkout Apr 5)
  });

  it('expands a single assignment bar to match explicit stay span', () => {
    const personWithStay: Person = {
      ...p1,
      stayStartDate: iso('2026-04-03'),
      stayEndDate: iso('2026-04-06'),
    };
    const assignment: RoomAssignment = {
      id: 'expand-a1' as RoomAssignment['id'],
      tripId: 'trip-1' as TripId,
      roomId: 'r1' as RoomId,
      personId: 'p1' as PersonId,
      startDate: iso('2026-04-03'),
      endDate: iso('2026-04-05'),
    };

    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [personWithStay],
      rooms: [room1],
      assignments: [assignment],
      arrivals: [],
      departures: [],
      unknownLabel: 'Unknown',
    });

    const row = model.rows[0]!;
    const assignmentItem = row.items.find((i) => i.kind === 'assignment');
    expect(assignmentItem).toBeDefined();
    expect(assignmentItem!.startIndex).toBe(2); // Apr 3
    expect(assignmentItem!.endIndex).toBe(4);   // Apr 5 (last night before checkout Apr 6)
    expect(row.staySpan).toBeUndefined();
  });

  it('merges transports into host assignment items', () => {
    const assignment: RoomAssignment = {
      id: 'a1' as RoomAssignment['id'],
      tripId: 'trip-1' as TripId,
      roomId: 'r1' as RoomId,
      personId: 'p1' as PersonId,
      startDate: iso('2026-04-01'),
      endDate: iso('2026-04-05'),
    };

    const arrival: Transport = {
      id: 'tr1' as Transport['id'],
      tripId: 'trip-1' as TripId,
      personId: 'p1' as PersonId,
      type: 'arrival',
      datetime: localInstant(2026, 4, 1, 14),
      location: 'Airport',
      needsPickup: false,
    };

    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [p1],
      rooms: [room1],
      assignments: [assignment],
      arrivals: [arrival],
      departures: [],
      unknownLabel: 'Unknown',
    });

    const row = model.rows[0]!;
    // Transport should be merged into the assignment
    const assignmentItem = row.items.find((i) => i.kind === 'assignment');
    expect(assignmentItem).toBeDefined();
  });

  it('skips assignments outside trip date range', () => {
    const assignment: RoomAssignment = {
      id: 'a1' as RoomAssignment['id'],
      tripId: 'trip-1' as TripId,
      roomId: 'r1' as RoomId,
      personId: 'p1' as PersonId,
      startDate: iso('2026-05-01'),
      endDate: iso('2026-05-05'),
    };

    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [p1],
      rooms: [room1],
      assignments: [assignment],
      arrivals: [],
      departures: [],
      unknownLabel: 'Unknown',
    });

    const row = model.rows[0]!;
    expect(row.items.length).toBe(0);
  });

  it('skips same-day assignments (0 nights)', () => {
    const assignment: RoomAssignment = {
      id: 'a1' as RoomAssignment['id'],
      tripId: 'trip-1' as TripId,
      roomId: 'r1' as RoomId,
      personId: 'p1' as PersonId,
      startDate: iso('2026-04-02'),
      endDate: iso('2026-04-02'), // Same day, 0 nights
    };

    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [p1],
      rooms: [room1],
      assignments: [assignment],
      arrivals: [],
      departures: [],
      unknownLabel: 'Unknown',
    });

    const row = model.rows[0]!;
    expect(row.items.length).toBe(0);
  });

  it('expands merged same-room assignments to explicit stay span when one pill remains', () => {
    const trip = createTrip({
      startDate: iso('2026-04-20'),
      endDate: iso('2026-04-28'),
    });
    const guest: Person = {
      id: 'p-marc' as PersonId,
      tripId: 'trip-1' as TripId,
      name: 'Marc',
      color: '#14b8a6' as HexColor,
      stayStartDate: iso('2026-04-21'),
      stayEndDate: iso('2026-04-27'),
    };
    const room2: Room = {
      id: 'r2' as RoomId,
      tripId: 'trip-1' as TripId,
      name: '2',
      capacity: 2,
      order: 1,
    };
    const firstStay: RoomAssignment = {
      id: 'a-first' as RoomAssignment['id'],
      tripId: 'trip-1' as TripId,
      roomId: 'r2' as RoomId,
      personId: 'p-marc' as PersonId,
      startDate: iso('2026-04-22'),
      endDate: iso('2026-04-24'),
    };
    const secondStay: RoomAssignment = {
      id: 'a-second' as RoomAssignment['id'],
      tripId: 'trip-1' as TripId,
      roomId: 'r2' as RoomId,
      personId: 'p-marc' as PersonId,
      startDate: iso('2026-04-24'),
      endDate: iso('2026-04-25'),
    };

    const model = buildCalendarTimelineModel({
      trip,
      persons: [guest],
      rooms: [room1, room2],
      assignments: [firstStay, secondStay],
      arrivals: [],
      departures: [],
      unknownLabel: 'Unknown',
    });

    const row = model.rows[0]!;
    const assignmentBars = row.items.filter((i) => i.kind === 'assignment');
    expect(assignmentBars).toHaveLength(1);
    // Stay nights Apr 21–Apr 26 (checkout Apr 27) within trip
    expect(assignmentBars[0]!.startIndex).toBe(1);
    expect(assignmentBars[0]!.endIndex).toBe(6);
  });

  it('merges consecutive same-room assignments into one pill for one guest', () => {
    const trip = createTrip({
      startDate: iso('2026-04-20'),
      endDate: iso('2026-04-28'),
    });
    const guest: Person = {
      id: 'p-marc' as PersonId,
      tripId: 'trip-1' as TripId,
      name: 'Marc',
      color: '#14b8a6' as HexColor,
    };
    const room2: Room = {
      id: 'r2' as RoomId,
      tripId: 'trip-1' as TripId,
      name: '2',
      capacity: 2,
      order: 1,
    };
    // Checkout morning Apr 24 then same room again: two rows that share one calendar night
    const firstStay: RoomAssignment = {
      id: 'a-first' as RoomAssignment['id'],
      tripId: 'trip-1' as TripId,
      roomId: 'r2' as RoomId,
      personId: 'p-marc' as PersonId,
      startDate: iso('2026-04-22'),
      endDate: iso('2026-04-24'),
    };
    const secondStay: RoomAssignment = {
      id: 'a-second' as RoomAssignment['id'],
      tripId: 'trip-1' as TripId,
      roomId: 'r2' as RoomId,
      personId: 'p-marc' as PersonId,
      startDate: iso('2026-04-24'),
      endDate: iso('2026-04-25'),
    };

    const model = buildCalendarTimelineModel({
      trip,
      persons: [guest],
      rooms: [room1, room2],
      assignments: [firstStay, secondStay],
      arrivals: [],
      departures: [],
      unknownLabel: 'Unknown',
    });

    const row = model.rows[0]!;
    const assignmentBars = row.items.filter((i) => i.kind === 'assignment');
    expect(assignmentBars).toHaveLength(1);
    expect(assignmentBars[0]!.startIndex).toBe(2); // Apr 22
    expect(assignmentBars[0]!.endIndex).toBe(4); // Apr 24 night (checkout Apr 25)
  });

  it('does not merge same-room assignments when there is a gap night', () => {
    const a1: RoomAssignment = {
      id: 'a-gap-1' as RoomAssignment['id'],
      tripId: 'trip-1' as TripId,
      roomId: 'r1' as RoomId,
      personId: 'p1' as PersonId,
      startDate: iso('2026-04-01'),
      endDate: iso('2026-04-03'),
    };
    const a2: RoomAssignment = {
      id: 'a-gap-2' as RoomAssignment['id'],
      tripId: 'trip-1' as TripId,
      roomId: 'r1' as RoomId,
      personId: 'p1' as PersonId,
      startDate: iso('2026-04-04'),
      endDate: iso('2026-04-05'),
    };

    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [p1],
      rooms: [room1],
      assignments: [a1, a2],
      arrivals: [],
      departures: [],
      unknownLabel: 'Unknown',
    });

    const row = model.rows[0]!;
    expect(row.items.filter((i) => i.kind === 'assignment')).toHaveLength(2);
  });

  it('allocates lanes for overlapping assignments', () => {
    const a1: RoomAssignment = {
      id: 'a1' as RoomAssignment['id'],
      tripId: 'trip-1' as TripId,
      roomId: 'r1' as RoomId,
      personId: 'p1' as PersonId,
      startDate: iso('2026-04-01'),
      endDate: iso('2026-04-04'),
    };

    const room2: Room = { id: 'r2' as RoomId, tripId: 'trip-1' as TripId, name: 'Room 2', capacity: 2, order: 1 };
    const a2: RoomAssignment = {
      id: 'a2' as RoomAssignment['id'],
      tripId: 'trip-1' as TripId,
      roomId: 'r2' as RoomId,
      personId: 'p1' as PersonId,
      startDate: iso('2026-04-02'),
      endDate: iso('2026-04-05'),
    };

    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [p1],
      rooms: [room1, room2],
      assignments: [a1, a2],
      arrivals: [],
      departures: [],
      unknownLabel: 'Unknown',
    });

    const row = model.rows[0]!;
    expect(row.laneCount).toBeGreaterThanOrEqual(2);
  });

  it('suppresses stay span when fully covered by assignments', () => {
    // Person stays Apr 1-5, has a room assignment covering all nights
    const arrival: Transport = {
      id: 'tr1' as Transport['id'],
      tripId: 'trip-1' as TripId,
      personId: 'p1' as PersonId,
      type: 'arrival',
      datetime: localInstant(2026, 4, 1, 14),
      location: 'Airport',
      needsPickup: false,
    };

    const departure: Transport = {
      id: 'tr2' as Transport['id'],
      tripId: 'trip-1' as TripId,
      personId: 'p1' as PersonId,
      type: 'departure',
      datetime: localInstant(2026, 4, 5, 10),
      location: 'Airport',
      needsPickup: false,
    };

    const assignment: RoomAssignment = {
      id: 'a1' as RoomAssignment['id'],
      tripId: 'trip-1' as TripId,
      roomId: 'r1' as RoomId,
      personId: 'p1' as PersonId,
      startDate: iso('2026-04-01'),
      endDate: iso('2026-04-05'), // Covers all nights (Apr 1 checkout Apr 5)
    };

    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [p1],
      rooms: [room1],
      assignments: [assignment],
      arrivals: [arrival],
      departures: [departure],
      unknownLabel: 'Unknown',
    });

    const row = model.rows[0]!;
    // Stay span should be undefined since assignment covers entire stay
    expect(row.staySpan).toBeUndefined();
  });

  it('keeps stay span when there is a gap in assignment coverage', () => {
    const arrival: Transport = {
      id: 'tr1' as Transport['id'],
      tripId: 'trip-1' as TripId,
      personId: 'p1' as PersonId,
      type: 'arrival',
      datetime: localInstant(2026, 4, 1, 14),
      location: 'Airport',
      needsPickup: false,
    };

    const departure: Transport = {
      id: 'tr2' as Transport['id'],
      tripId: 'trip-1' as TripId,
      personId: 'p1' as PersonId,
      type: 'departure',
      datetime: localInstant(2026, 4, 5, 10),
      location: 'Airport',
      needsPickup: false,
    };

    // Only covers Apr 1-2 (checkout Apr 3), leaving Apr 3-4 uncovered
    const assignment: RoomAssignment = {
      id: 'a1' as RoomAssignment['id'],
      tripId: 'trip-1' as TripId,
      roomId: 'r1' as RoomId,
      personId: 'p1' as PersonId,
      startDate: iso('2026-04-01'),
      endDate: iso('2026-04-03'),
    };

    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [p1],
      rooms: [room1],
      assignments: [assignment],
      arrivals: [arrival],
      departures: [departure],
      unknownLabel: 'Unknown',
    });

    const row = model.rows[0]!;
    // Stay span should still be shown because there's a gap
    expect(row.staySpan).toBeDefined();
  });

  it('handles transport with no location using unknownLabel', () => {
    const arrival: Transport = {
      id: 'tr1' as Transport['id'],
      tripId: 'trip-1' as TripId,
      personId: 'p1' as PersonId,
      type: 'arrival',
      datetime: localInstant(2026, 4, 2, 14),
      location: '',
      needsPickup: false,
    };

    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [p1],
      rooms: [],
      assignments: [],
      arrivals: [arrival],
      departures: [],
      unknownLabel: 'Where?',
    });

    const row = model.rows[0]!;
    expect(row.items.length).toBe(1);
    expect(row.items[0]!.label).toBe('Where?');
  });

  it('handles trip with invalid dates', () => {
    const model = buildCalendarTimelineModel({
      trip: createTrip({ startDate: 'bad' as ISODateString, endDate: 'bad' as ISODateString }),
      persons: [p1],
      rooms: [],
      assignments: [],
      arrivals: [],
      departures: [],
      unknownLabel: 'Unknown',
    });

    expect(model.tripDays).toHaveLength(0);
    expect(model.dayKeys).toHaveLength(0);
  });

  it('computes checkout day index', () => {
    const departure: Transport = {
      id: 'tr2' as Transport['id'],
      tripId: 'trip-1' as TripId,
      personId: 'p1' as PersonId,
      type: 'departure',
      datetime: localInstant(2026, 4, 3, 10),
      location: 'Airport',
      needsPickup: false,
    };

    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [p1],
      rooms: [],
      assignments: [],
      arrivals: [],
      departures: [departure],
      unknownLabel: 'Unknown',
    });

    const row = model.rows[0]!;
    expect(row.checkoutDayIndex).toBeDefined();
    expect(row.checkoutDayIndex).toBe(2); // Apr 3 is index 2
  });

  it('computes maxLaneCount across all rows', () => {
    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [p1, p2],
      rooms: [],
      assignments: [],
      arrivals: [],
      departures: [],
      unknownLabel: 'Unknown',
    });

    expect(model.maxLaneCount).toBeGreaterThanOrEqual(1);
  });

  it('gives a transport before the trip start its own day column', () => {
    // A guest flying in the day before everybody else had no column to be drawn
    // in, so the timeline simply did not show the flight.
    const arrival: Transport = {
      id: 'tr1' as Transport['id'],
      tripId: 'trip-1' as TripId,
      personId: 'p1' as PersonId,
      type: 'arrival',
      datetime: localInstant(2026, 3, 30, 14),
      location: 'Airport',
      needsPickup: false,
    };

    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [p1],
      rooms: [],
      assignments: [],
      arrivals: [arrival],
      departures: [],
      unknownLabel: 'Unknown',
    });

    expect(model.dayKeys[0]).toBe('2026-03-30');
    expect(model.dayKeys).toContain('2026-04-05');

    const row = model.rows[0]!;
    const transportItem = row.items.find((i) => i.kind === 'transport');
    expect(transportItem).toBeDefined();
    expect(transportItem?.startIndex).toBe(0);
  });

  it('gives a transport after the trip end its own day column', () => {
    const departure: Transport = {
      id: 'tr2' as Transport['id'],
      tripId: 'trip-1' as TripId,
      personId: 'p1' as PersonId,
      type: 'departure',
      datetime: localInstant(2026, 4, 8, 9),
      location: 'Airport',
      needsPickup: false,
    };

    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [p1],
      rooms: [],
      assignments: [],
      arrivals: [],
      departures: [departure],
      unknownLabel: 'Unknown',
    });

    expect(model.dayKeys[model.dayKeys.length - 1]).toBe('2026-04-08');

    const row = model.rows[0]!;
    const transportItem = row.items.find((i) => i.kind === 'transport');
    expect(transportItem).toBeDefined();
    expect(transportItem?.startIndex).toBe(model.dayKeys.length - 1);
  });

  it('covers a whole run of out-of-trip transports on one axis', () => {
    const arrival: Transport = {
      id: 'tr1' as Transport['id'],
      tripId: 'trip-1' as TripId,
      personId: 'p1' as PersonId,
      type: 'arrival',
      datetime: localInstant(2026, 3, 28, 20),
      location: 'Airport',
      needsPickup: false,
    };
    const departure: Transport = {
      id: 'tr2' as Transport['id'],
      tripId: 'trip-1' as TripId,
      personId: 'p2' as PersonId,
      type: 'departure',
      datetime: localInstant(2026, 4, 9, 6),
      location: 'Station',
      needsPickup: false,
    };

    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [p1, p2],
      rooms: [],
      assignments: [],
      arrivals: [arrival],
      departures: [departure],
      unknownLabel: 'Unknown',
    });

    expect(model.dayKeys[0]).toBe('2026-03-28');
    expect(model.dayKeys[model.dayKeys.length - 1]).toBe('2026-04-09');
    expect(model.dayKeys).toHaveLength(13);
  });

  it('extends the axis for a transport the caller asks for in extraDayKeys', () => {
    // The calendar draws the activity bands on this same axis, so a caller can
    // hand the builder days its own events do not cover.
    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [p1],
      rooms: [],
      assignments: [],
      arrivals: [],
      departures: [],
      unknownLabel: 'Unknown',
      extraDayKeys: [iso('2026-04-07')],
    });

    expect(model.dayKeys[model.dayKeys.length - 1]).toBe('2026-04-07');
  });

  it('leaves a transport too far out for the axis off the timeline', () => {
    const arrival: Transport = {
      id: 'tr1' as Transport['id'],
      tripId: 'trip-1' as TripId,
      personId: 'p1' as PersonId,
      type: 'arrival',
      // Two months out: a typo, not a plan. Stretching the axis to it would
      // cost sixty day columns to show one pill.
      datetime: localInstant(2026, 6, 1, 14),
      location: 'Airport',
      needsPickup: false,
    };

    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [p1],
      rooms: [],
      assignments: [],
      arrivals: [arrival],
      departures: [],
      unknownLabel: 'Unknown',
    });

    const row = model.rows[0]!;
    expect(row.items.length).toBe(0);
    expect(model.dayKeys).toHaveLength(5);
  });
});

// ============================================================================
// Which stay a leg is drawn in
// ============================================================================

describe('buildCalendarTimelineModel: legs inside stays', () => {
  const room2: Room = { ...room1, id: 'r2' as RoomId, name: 'Room 2' };

  /** A guest whose own dates cover the whole trip, so no stay is clipped. */
  const guest: Person = {
    ...p1,
    stayStartDate: iso('2026-04-01'),
    stayEndDate: iso('2026-04-11'),
  };

  function stay(id: string, roomId: string, startDate: string, endDate: string): RoomAssignment {
    return {
      id: id as RoomAssignment['id'],
      tripId: 'trip-1' as TripId,
      roomId: roomId as RoomId,
      personId: guest.id,
      startDate: iso(startDate),
      endDate: iso(endDate),
    };
  }

  function leg(id: string, type: Transport['type'], day: number): Transport {
    return {
      id: id as Transport['id'],
      tripId: 'trip-1' as TripId,
      personId: guest.id,
      type,
      datetime: localInstant(2026, 4, day, 10),
      location: id,
      needsPickup: false,
    };
  }

  function build(assignments: RoomAssignment[], transports: Transport[], rooms = [room1, room2]) {
    return buildCalendarTimelineModel({
      trip: createTrip({ endDate: iso('2026-04-10') }),
      persons: [guest],
      rooms,
      assignments,
      arrivals: transports.filter((t) => t.type === 'arrival'),
      departures: transports.filter((t) => t.type === 'departure'),
      unknownLabel: 'Unknown',
    }).rows[0]!;
  }

  /** Which legs each stay carries, and which legs stand on their own. */
  function layout(row: ReturnType<typeof build>) {
    const stays: Record<string, string[]> = {};
    const loose: string[] = [];
    for (const item of row.items) {
      if (item.kind === 'assignment') {
        stays[item.id] = (item.timelineTransports ?? []).map((m) => m.transport.id);
      } else {
        loose.push(item.id);
      }
    }
    return { stays, loose };
  }

  it('draws a departure on check-out day, and an arrival the day before, inside the stay', () => {
    // A sleeps the 2nd to the 4th, B the 7th and the 8th.
    const row = build(
      [stay('A', 'r1', '2026-04-02', '2026-04-05'), stay('B', 'r2', '2026-04-07', '2026-04-09')],
      [
        leg('out-on-checkout', 'departure', 5),
        leg('in-on-checkout', 'arrival', 5),
        leg('in-day-before', 'arrival', 6),
        leg('out-day-before', 'departure', 6),
      ],
    );

    expect(layout(row)).toEqual({
      stays: { A: ['out-on-checkout'], B: ['in-day-before'] },
      loose: ['in-on-checkout', 'out-day-before'],
    });
  });

  it('draws a leg on the last night of a stay inside it, and leaves a legless stay bare', () => {
    const row = build(
      [stay('A', 'r1', '2026-04-02', '2026-04-05'), stay('B', 'r2', '2026-04-07', '2026-04-09')],
      [leg('in-last-night', 'arrival', 4)],
    );

    expect(layout(row).stays.A).toEqual(['in-last-night']);
    const bare = row.items.find((item) => item.id === 'B');
    expect(bare).toMatchObject({ kind: 'assignment' });
    expect(bare && 'timelineTransports' in bare ? bare.timelineTransports : undefined).toBeUndefined();
    expect(row.items.find((item) => item.id === 'A')).toMatchObject({ person: guest });
  });

  it('hands a leg two stays could carry to the one that starts first', () => {
    const row = build(
      [stay('B', 'r2', '2026-04-04', '2026-04-07'), stay('A', 'r1', '2026-04-02', '2026-04-04')],
      [leg('out', 'departure', 4)],
    );

    expect(layout(row).stays).toEqual({ A: ['out'], B: [] });
  });

  it('orders the legs of a stay by time', () => {
    const late = { ...leg('late', 'arrival', 3), datetime: localInstant(2026, 4, 3, 18) };
    const early = { ...leg('early', 'arrival', 3), datetime: localInstant(2026, 4, 3, 8) };
    const row = build(
      [stay('A', 'r1', '2026-04-02', '2026-04-05'), stay('B', 'r2', '2026-04-07', '2026-04-09')],
      [late, early],
    );

    expect(layout(row).stays.A).toEqual(['early', 'late']);
  });

  it('joins same-room stays given out of order into one bar, named in order', () => {
    const row = build(
      [
        stay('second', 'r1', '2026-04-05', '2026-04-07'),
        stay('first', 'r1', '2026-04-02', '2026-04-05'),
        stay('other', 'r2', '2026-04-08', '2026-04-10'),
      ],
      [],
    );

    const bar = row.items.find((item) => item.kind === 'assignment' && item.id.includes('+'));
    expect(bar).toMatchObject({ id: 'first+second', startIndex: 1, endIndex: 5 });
  });
});

describe('collectAssignmentDayKeys and collectTransportDayKeys', () => {
  function nights(id: string, startDate: string, endDate: string): RoomAssignment {
    return {
      id: id as RoomAssignment['id'],
      tripId: 'trip-1' as TripId,
      roomId: 'r1' as RoomId,
      personId: 'p1' as PersonId,
      startDate: iso(startDate),
      endDate: iso(endDate),
    };
  }

  function travel(id: string, datetime: Transport['datetime']): Transport {
    return {
      id: id as Transport['id'],
      tripId: 'trip-1' as TripId,
      personId: 'p1' as PersonId,
      type: 'arrival',
      datetime,
      location: '',
      needsPickup: false,
    };
  }

  it('names the first and the last night of each stay, and skips what it cannot draw', () => {
    const keys = collectAssignmentDayKeys([
      nights('a', '2026-04-02', '2026-04-05'),
      nights('zero', '2026-04-06', '2026-04-06'),
      nights('bad', 'nope', '2026-04-06'),
      nights('bad-end', '2026-04-06', 'nope'),
    ]);

    expect(keys).toEqual(['2026-04-02', '2026-04-04']);
  });

  it('names the day of each leg it can read', () => {
    const keys = collectTransportDayKeys([
      travel('t', localInstant(2026, 4, 3, 10)),
      travel('bad', 'nope' as Transport['datetime']),
    ]);

    expect(keys).toEqual(['2026-04-03']);
  });

  it('keeps a one-night stay', () => {
    expect(collectAssignmentDayKeys([nights('one', '2026-04-02', '2026-04-03')])).toEqual([
      '2026-04-02',
      '2026-04-02',
    ]);
  });
});

// ============================================================================
// Stay bars, check-out and the dashed stay window
// ============================================================================

describe('buildCalendarTimelineModel: bars and the stay window', () => {
  const room2: Room = { ...room1, id: 'r2' as RoomId, name: 'Room 2' };

  function stayFor(
    personId: string,
    id: string,
    roomId: string,
    startDate: string,
    endDate: string,
  ): RoomAssignment {
    return {
      id: id as RoomAssignment['id'],
      tripId: 'trip-1' as TripId,
      roomId: roomId as RoomId,
      personId: personId as PersonId,
      startDate: iso(startDate),
      endDate: iso(endDate),
    };
  }

  function rowFor(person: Person, assignments: RoomAssignment[], trip = createTrip()) {
    return buildCalendarTimelineModel({
      trip,
      persons: [person],
      rooms: [room1, room2],
      assignments,
      arrivals: [],
      departures: [],
      unknownLabel: 'Unknown',
    }).rows[0]!;
  }

  /** The bars of a row as [id, start column, end column]. */
  function bars(row: ReturnType<typeof rowFor>): [string, number, number][] {
    return row.items
      .filter((item) => item.kind === 'assignment')
      .map((item) => [item.id, item.startIndex, item.endIndex]);
  }

  it('adds no leg list to a stay when the guest travels nowhere', () => {
    const row = rowFor(p1, [stayFor('p1', 'a', 'r1', '2026-04-02', '2026-04-04')]);

    expect(Object.prototype.hasOwnProperty.call(row.items[0], 'timelineTransports')).toBe(false);
  });

  it('draws nothing for a stay whose first night cannot be read', () => {
    const row = rowFor(p1, [stayFor('p1', 'a', 'r1', 'nope', '2026-04-04')]);

    expect(row.items).toEqual([]);
  });

  it('hatches nothing for a check-out date that cannot be read', () => {
    const odd = { ...p1, stayStartDate: iso('2026-04-02'), stayEndDate: iso('nope') };

    expect(rowFor(odd, []).checkoutDayIndex).toBeUndefined();
  });

  it('drops a leg whose time cannot be read', () => {
    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [p1],
      rooms: [],
      assignments: [],
      arrivals: [
        {
          id: 'unreadable' as Transport['id'],
          tripId: 'trip-1' as TripId,
          personId: p1.id,
          type: 'arrival',
          datetime: 'not a time' as Transport['datetime'],
          location: 'Station',
          needsPickup: false,
        },
      ],
      departures: [],
      unknownLabel: 'Unknown',
    });

    expect(model.rows[0]!.items).toEqual([]);
  });

  it('names a bar after its room', () => {
    const row = rowFor(p1, [stayFor('p1', 'a', 'r2', '2026-04-02', '2026-04-04')]);

    expect(row.items[0]).toMatchObject({ kind: 'assignment', label: 'Room 2' });
  });

  it('draws nothing for a stay whose check-out cannot be read', () => {
    const row = rowFor(p1, [stayFor('p1', 'a', 'r1', '2026-04-02', 'nope')]);

    expect(row.items).toEqual([]);
  });

  it('keeps each of two stays its own length when the guest gave dates', () => {
    const dated = { ...p1, stayStartDate: iso('2026-04-01'), stayEndDate: iso('2026-04-06') };
    const row = rowFor(dated, [
      stayFor('p1', 'a', 'r1', '2026-04-02', '2026-04-03'),
      stayFor('p1', 'b', 'r2', '2026-04-04', '2026-04-05'),
    ]);

    expect(bars(row)).toEqual([
      ['a', 1, 1],
      ['b', 3, 3],
    ]);
  });

  it.each([
    ['no dates of their own', {}],
    ['only a check-out date', { stayEndDate: iso('2026-04-06') }],
    ['only a check-in date', { stayStartDate: iso('2026-04-01') }],
  ])('does not stretch a single stay for a guest with %s', (_, dates) => {
    const row = rowFor({ ...p1, ...dates }, [stayFor('p1', 'a', 'r1', '2026-04-02', '2026-04-04')]);

    expect(bars(row)).toEqual([['a', 1, 2]]);
  });

  it('drops the dashed window once two stays cover every night of it', () => {
    // The guest is there the 2nd to the 4th; one night in each room.
    const dated = { ...p1, stayStartDate: iso('2026-04-02'), stayEndDate: iso('2026-04-05') };
    const row = rowFor(dated, [
      stayFor('p1', 'a', 'r1', '2026-04-02', '2026-04-03'),
      stayFor('p1', 'b', 'r2', '2026-04-03', '2026-04-05'),
    ]);

    expect(row.staySpan).toBeUndefined();
  });

  it('keeps the dashed window over a night no stay covers', () => {
    const dated = { ...p1, stayStartDate: iso('2026-04-02'), stayEndDate: iso('2026-04-06') };
    const row = rowFor(dated, [
      stayFor('p1', 'a', 'r1', '2026-04-02', '2026-04-03'),
      stayFor('p1', 'b', 'r2', '2026-04-04', '2026-04-06'),
    ]);

    expect(row.staySpan).toEqual({ startIndex: 1, endIndex: 4 });
  });

  it('keeps the dashed window when only the last night is uncovered', () => {
    const dated = { ...p1, stayStartDate: iso('2026-04-02'), stayEndDate: iso('2026-04-06') };
    const row = rowFor(dated, [
      stayFor('p1', 'a', 'r1', '2026-04-02', '2026-04-04'),
      stayFor('p1', 'b', 'r2', '2026-04-04', '2026-04-05'),
    ]);

    expect(row.staySpan).toEqual({ startIndex: 1, endIndex: 4 });
  });

  it('hatches the only column of a one-day trip', () => {
    const row = rowFor(p1, [], createTrip({ endDate: iso('2026-04-01') }));

    expect(row.checkoutDayIndex).toBe(0);
  });

  it('hatches the last column for a check-out past the end of the axis', () => {
    const late = { ...p1, stayStartDate: iso('2026-04-02'), stayEndDate: iso('2026-04-20') };

    expect(rowFor(late, []).checkoutDayIndex).toBe(4);
  });

  it('hatches nothing for a check-out before the axis begins', () => {
    const early = { ...p1, stayStartDate: iso('2026-03-20'), stayEndDate: iso('2026-03-25') };

    expect(rowFor(early, []).checkoutDayIndex).toBeUndefined();
  });

  it('keeps another guest’s travel off the row', () => {
    const model = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [p1, p2],
      rooms: [room1],
      assignments: [],
      arrivals: [
        {
          id: 'sam-in' as Transport['id'],
          tripId: 'trip-1' as TripId,
          personId: p2.id,
          type: 'arrival',
          datetime: localInstant(2026, 4, 2, 10),
          location: 'Station',
          needsPickup: false,
        },
      ],
      departures: [],
      unknownLabel: 'Unknown',
    });

    expect(model.rows[0]!.items).toEqual([]);
    expect(model.rows[1]!.items.map((item) => item.id)).toEqual(['sam-in']);
  });

  it('lists the days of the axis, and keys only the columns that are one day', () => {
    const full = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [],
      rooms: [],
      assignments: [],
      arrivals: [],
      departures: [],
      unknownLabel: 'Unknown',
    });
    expect(full.tripDays[0]).toEqual(new Date(2026, 3, 1));
    expect(full.tripDays).toHaveLength(5);

    const hour = full.columns[0]!;
    const partial = buildCalendarTimelineModel({
      trip: createTrip(),
      persons: [],
      rooms: [],
      assignments: [],
      arrivals: [],
      departures: [],
      unknownLabel: 'Unknown',
      columns: [hour, { ...hour, key: 'hour', dayKey: undefined }],
    });
    expect(partial.dayKeys).toEqual(['2026-04-01']);
  });
});
