/**
 * @fileoverview Tests for calendar timeline utility functions.
 * @module features/calendar/utils/__tests__/timeline-utils.test
 */

import { describe, it, expect } from 'vitest';
import { buildCalendarTimelineModel } from '../timeline-utils';
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
      datetime: '2026-04-01T14:00:00Z',
      location: 'Airport',
      needsPickup: false,
    };

    const departure: Transport = {
      id: 'tr2' as Transport['id'],
      tripId: 'trip-1' as TripId,
      personId: 'p1' as PersonId,
      type: 'departure',
      datetime: '2026-04-05T10:00:00Z',
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
      datetime: '2026-04-01T14:00:00Z',
      location: 'Airport',
      needsPickup: false,
    };

    const departure: Transport = {
      id: 'tr2' as Transport['id'],
      tripId: 'trip-1' as TripId,
      personId: 'p1' as PersonId,
      type: 'departure',
      datetime: '2026-04-05T10:00:00Z',
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
      datetime: '2026-04-01T14:00:00Z',
      location: 'Airport',
      needsPickup: false,
    };
    const departure: Transport = {
      id: 'tr-explicit-2' as Transport['id'],
      tripId: 'trip-1' as TripId,
      personId: 'p1' as PersonId,
      type: 'departure',
      datetime: '2026-04-05T10:00:00Z',
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
      datetime: '2026-04-01T14:00:00Z',
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
      datetime: '2026-04-01T14:00:00Z',
      location: 'Airport',
      needsPickup: false,
    };

    const departure: Transport = {
      id: 'tr2' as Transport['id'],
      tripId: 'trip-1' as TripId,
      personId: 'p1' as PersonId,
      type: 'departure',
      datetime: '2026-04-05T10:00:00Z',
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
      datetime: '2026-04-01T14:00:00Z',
      location: 'Airport',
      needsPickup: false,
    };

    const departure: Transport = {
      id: 'tr2' as Transport['id'],
      tripId: 'trip-1' as TripId,
      personId: 'p1' as PersonId,
      type: 'departure',
      datetime: '2026-04-05T10:00:00Z',
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
      datetime: '2026-04-02T14:00:00Z',
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
      datetime: '2026-04-03T10:00:00Z',
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

  it('skips transports outside trip date range', () => {
    const arrival: Transport = {
      id: 'tr1' as Transport['id'],
      tripId: 'trip-1' as TripId,
      personId: 'p1' as PersonId,
      type: 'arrival',
      datetime: '2026-06-01T14:00:00Z', // Way outside trip range
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
  });
});
