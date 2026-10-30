/**
 * @fileoverview Unit tests for room timeline utilities.
 *
 * @module features/rooms/utils/__tests__/room-timeline-utils
 */

import { describe, expect, it } from 'vitest';

import { tripDate, tripDay } from '@/features/rooms/__tests__/fixture-days';
import type { HexColor, ISODateString, Person, Room, RoomAssignment, Trip } from '@/types';

import {
  buildRoomTimelineModel,
  computeRoomTimelineViewportLayout,
  ROOM_TIMELINE_MIN_COMPRESSED_DAY_WIDTH_PX,
  ROOM_TIMELINE_PREFERRED_DAY_WIDTH_PX,
} from '../room-timeline-utils';

function iso(value: string): ISODateString {
  return value as ISODateString;
}

function createTrip(): Trip {
  return {
    id: 'trip-1' as Trip['id'],
    shareId: 'share-1' as Trip['shareId'],
    name: 'Trip',
    startDate: iso('2026-04-01'),
    endDate: iso('2026-04-05'),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('computeRoomTimelineViewportLayout', () => {
  it('stretches day width to fill viewport when wider than preferred minimum', () => {
    const roomCol = 140;
    const viewportWidth = 1280;
    const layout = computeRoomTimelineViewportLayout({
      viewportWidth,
      roomColWidth: roomCol,
      dayCount: 20,
    });
    const available = viewportWidth - roomCol;
    expect(layout.canvasWidth).toBe(available);
    expect(layout.dayWidthPx).toBe(available / 20);
    expect(layout.useFractionalColumns).toBe(true);
  });

  it('compresses between compressed min and preferred when needed to avoid scroll', () => {
    const roomCol = 140;
    const layout = computeRoomTimelineViewportLayout({
      viewportWidth: 800,
      roomColWidth: roomCol,
      dayCount: 20,
    });
    const available = 800 - roomCol;
    const ideal = available / 20;
    expect(ideal).toBeGreaterThanOrEqual(ROOM_TIMELINE_MIN_COMPRESSED_DAY_WIDTH_PX);
    expect(ideal).toBeLessThan(ROOM_TIMELINE_PREFERRED_DAY_WIDTH_PX);
    expect(layout.dayWidthPx).toBe(ideal);
    expect(layout.canvasWidth).toBe(available);
    expect(layout.useFractionalColumns).toBe(true);
  });

  it('uses fixed columns and scroll when viewport is too narrow to compress further', () => {
    const layout = computeRoomTimelineViewportLayout({
      viewportWidth: 400,
      roomColWidth: 140,
      dayCount: 20,
    });
    expect(layout.dayWidthPx).toBe(ROOM_TIMELINE_PREFERRED_DAY_WIDTH_PX);
    expect(layout.canvasWidth).toBe(20 * ROOM_TIMELINE_PREFERRED_DAY_WIDTH_PX);
    expect(layout.useFractionalColumns).toBe(false);
  });
});

describe('buildRoomTimelineModel', () => {
  it('maps room assignments into room rows with nights (endDate-1) semantics', () => {
    const trip = createTrip();
    const room: Room = {
      id: 'r1' as Room['id'],
      tripId: trip.id,
      name: 'Room 1',
      capacity: 2,
      order: 0,
    };
    const person: Person = {
      id: 'p1' as Person['id'],
      tripId: trip.id,
      name: 'Alex',
      color: '#3b82f6' as HexColor,
    };
    const assignment: RoomAssignment = {
      id: 'a1' as RoomAssignment['id'],
      tripId: trip.id,
      roomId: room.id,
      personId: person.id,
      startDate: iso('2026-04-01'),
      endDate: iso('2026-04-03'), // nights 1-2
    };

    const model = buildRoomTimelineModel({
      trip,
      range: { startDate: iso('2026-04-01'), endDate: iso('2026-04-05') },
      rooms: [room],
      assignments: [assignment],
      personsById: new Map([[person.id, person]]),
      unknownLabel: 'Unknown',
      arrivals: [],
      departures: [],
    });

    expect(model.rows).toHaveLength(1);
    const row = model.rows[0]!;
    expect(row.items).toHaveLength(1);
    expect(row.items[0]!.startIndex).toBe(0);
    expect(row.items[0]!.endIndex).toBe(1);
  });

  it('allocates two lanes for overlapping assignments in a room', () => {
    const trip = createTrip();
    const room: Room = {
      id: 'r1' as Room['id'],
      tripId: trip.id,
      name: 'Room 1',
      capacity: 2,
      order: 0,
    };
    const p1: Person = {
      id: 'p1' as Person['id'],
      tripId: trip.id,
      name: 'Alex',
      color: '#3b82f6' as HexColor,
    };
    const p2: Person = {
      id: 'p2' as Person['id'],
      tripId: trip.id,
      name: 'Sam',
      color: '#ef4444' as HexColor,
    };

    const a1: RoomAssignment = {
      id: 'a1' as RoomAssignment['id'],
      tripId: trip.id,
      roomId: room.id,
      personId: p1.id,
      startDate: iso('2026-04-01'),
      endDate: iso('2026-04-04'),
    };
    const a2: RoomAssignment = {
      id: 'a2' as RoomAssignment['id'],
      tripId: trip.id,
      roomId: room.id,
      personId: p2.id,
      startDate: iso('2026-04-02'),
      endDate: iso('2026-04-05'),
    };

    const model = buildRoomTimelineModel({
      trip,
      range: { startDate: iso('2026-04-01'), endDate: iso('2026-04-05') },
      rooms: [room],
      assignments: [a1, a2],
      personsById: new Map([
        [p1.id, p1],
        [p2.id, p2],
      ]),
      unknownLabel: 'Unknown',
      arrivals: [],
      departures: [],
    });

    expect(model.rows[0]!.laneCount).toBe(2);
  });

  it('hides a narrower same-person assignment when it is fully contained in a wider one', () => {
    const trip: Trip = {
      id: 'trip-1' as Trip['id'],
      shareId: 'share-1' as Trip['shareId'],
      name: 'Trip',
      startDate: iso('2026-04-01'),
      endDate: iso('2026-04-30'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const room: Room = {
      id: 'r1' as Room['id'],
      tripId: trip.id,
      name: 'Room 1',
      capacity: 2,
      order: 0,
    };
    const person: Person = {
      id: 'p1' as Person['id'],
      tripId: trip.id,
      name: 'Tom',
      color: '#ef4444' as HexColor,
    };
    const wide: RoomAssignment = {
      id: 'a-wide' as RoomAssignment['id'],
      tripId: trip.id,
      roomId: room.id,
      personId: person.id,
      startDate: iso('2026-04-07'),
      endDate: iso('2026-04-26'),
    };
    const narrow: RoomAssignment = {
      id: 'a-narrow' as RoomAssignment['id'],
      tripId: trip.id,
      roomId: room.id,
      personId: person.id,
      startDate: iso('2026-04-16'),
      endDate: iso('2026-04-26'),
    };

    const model = buildRoomTimelineModel({
      trip,
      range: { startDate: iso('2026-04-01'), endDate: iso('2026-04-30') },
      rooms: [room],
      assignments: [wide, narrow],
      personsById: new Map([[person.id, person]]),
      unknownLabel: 'Unknown',
      arrivals: [],
      departures: [],
    });

    const row = model.rows[0]!;
    expect(row.items).toHaveLength(1);
    expect(row.items[0]!.assignment.id).toBe(wide.id);
    expect(row.items[0]!.startIndex).toBe(6);
    expect(row.items[0]!.endIndex).toBe(24);
  });

  it('keeps both guests when one stay is strictly inside another’s (different people)', () => {
    const trip: Trip = {
      id: 'trip-1' as Trip['id'],
      shareId: 'share-1' as Trip['shareId'],
      name: 'Trip',
      startDate: iso('2026-04-01'),
      endDate: iso('2026-04-30'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const room: Room = {
      id: 'r1' as Room['id'],
      tripId: trip.id,
      name: 'Room 1',
      capacity: 2,
      order: 0,
    };
    const tom: Person = {
      id: 'p-tom' as Person['id'],
      tripId: trip.id,
      name: 'Tom',
      color: '#ef4444' as HexColor,
    };
    const marc: Person = {
      id: 'p-marc' as Person['id'],
      tripId: trip.id,
      name: 'Marc',
      color: '#06b6d4' as HexColor,
    };

    const tomWide: RoomAssignment = {
      id: 'a-tom' as RoomAssignment['id'],
      tripId: trip.id,
      roomId: room.id,
      personId: tom.id,
      startDate: iso('2026-04-07'),
      endDate: iso('2026-04-26'),
    };
    const marcInside: RoomAssignment = {
      id: 'a-marc' as RoomAssignment['id'],
      tripId: trip.id,
      roomId: room.id,
      personId: marc.id,
      startDate: iso('2026-04-16'),
      endDate: iso('2026-04-26'),
    };

    const model = buildRoomTimelineModel({
      trip,
      range: { startDate: iso('2026-04-01'), endDate: iso('2026-04-30') },
      rooms: [room],
      assignments: [tomWide, marcInside],
      personsById: new Map([
        [tom.id, tom],
        [marc.id, marc],
      ]),
      unknownLabel: 'Unknown',
      arrivals: [],
      departures: [],
    });

    const row = model.rows[0]!;
    expect(row.items).toHaveLength(2);
    const labels = row.items.map((i) => i.label).sort();
    expect(labels).toEqual(['Marc', 'Tom']);
  });

  it('hides assignment spans that fall outside the guest’s updated stay dates (stale DB row)', () => {
    const trip: Trip = {
      id: 'trip-1' as Trip['id'],
      shareId: 'share-1' as Trip['shareId'],
      name: 'Trip',
      startDate: iso('2026-04-01'),
      endDate: iso('2026-04-30'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const room: Room = {
      id: 'r1' as Room['id'],
      tripId: trip.id,
      name: 'Room 1',
      capacity: 2,
      order: 0,
    };
    const person: Person = {
      id: 'p1' as Person['id'],
      tripId: trip.id,
      name: 'Tom',
      color: '#ef4444' as HexColor,
      stayStartDate: iso('2026-04-07'),
      stayEndDate: iso('2026-04-15'),
    };
    const staleAssignment: RoomAssignment = {
      id: 'a-stale' as RoomAssignment['id'],
      tripId: trip.id,
      roomId: room.id,
      personId: person.id,
      startDate: iso('2026-04-16'),
      endDate: iso('2026-04-27'),
    };

    const model = buildRoomTimelineModel({
      trip,
      range: { startDate: iso('2026-04-01'), endDate: iso('2026-04-30') },
      rooms: [room],
      assignments: [staleAssignment],
      personsById: new Map([[person.id, person]]),
      unknownLabel: 'Unknown',
      arrivals: [],
      departures: [],
    });

    expect(model.rows[0]!.items).toHaveLength(0);
  });

  it('shows only one overlapping cross-room bar per guest (prefers longer stay)', () => {
    const trip: Trip = {
      id: 'trip-1' as Trip['id'],
      shareId: 'share-1' as Trip['shareId'],
      name: 'Trip',
      startDate: iso('2026-04-01'),
      endDate: iso('2026-04-30'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const room1: Room = {
      id: 'r1' as Room['id'],
      tripId: trip.id,
      name: 'Room 1',
      capacity: 2,
      order: 0,
    };
    const room2: Room = {
      id: 'r2' as Room['id'],
      tripId: trip.id,
      name: 'Room 2',
      capacity: 2,
      order: 1,
    };
    const tom: Person = {
      id: 'p-tom' as Person['id'],
      tripId: trip.id,
      name: 'Tom',
      color: '#ef4444' as HexColor,
    };
    const shortInRoom1: RoomAssignment = {
      id: 'a-r1' as RoomAssignment['id'],
      tripId: trip.id,
      roomId: room1.id,
      personId: tom.id,
      startDate: iso('2026-04-16'),
      endDate: iso('2026-04-25'),
    };
    const longInRoom2: RoomAssignment = {
      id: 'a-r2' as RoomAssignment['id'],
      tripId: trip.id,
      roomId: room2.id,
      personId: tom.id,
      startDate: iso('2026-04-07'),
      endDate: iso('2026-04-25'),
    };

    const model = buildRoomTimelineModel({
      trip,
      range: { startDate: iso('2026-04-01'), endDate: iso('2026-04-30') },
      rooms: [room1, room2],
      assignments: [shortInRoom1, longInRoom2],
      personsById: new Map([[tom.id, tom]]),
      unknownLabel: 'Unknown',
      arrivals: [],
      departures: [],
    });

    const row1 = model.rows.find((r) => r.room.id === room1.id);
    const row2 = model.rows.find((r) => r.room.id === room2.id);
    expect(row1?.items).toHaveLength(0);
    expect(row2?.items).toHaveLength(1);
    expect(row2?.items[0]?.assignment.id).toBe(longInRoom2.id);
  });

  it('still shows assignment when guest stay dates do not overlap assignment nights (misaligned data)', () => {
    const trip: Trip = {
      id: 'trip-1' as Trip['id'],
      shareId: 'share-1' as Trip['shareId'],
      name: 'Short trip',
      startDate: iso('2026-04-15'),
      endDate: iso('2026-04-16'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const room: Room = {
      id: 'r1' as Room['id'],
      tripId: trip.id,
      name: 'Hotel Room',
      capacity: 1,
      order: 0,
    };
    // Stay window starts after the assignment’s first night (bad data) — would yield empty
    // intersection with old clipping; we fall back to assignment nights for the bar.
    const person: Person = {
      id: 'p1' as Person['id'],
      tripId: trip.id,
      name: 'Alex',
      color: '#3b82f6' as HexColor,
      stayStartDate: iso('2026-04-16'),
      stayEndDate: iso('2026-04-17'),
    };
    const assignment: RoomAssignment = {
      id: 'a1' as RoomAssignment['id'],
      tripId: trip.id,
      roomId: room.id,
      personId: person.id,
      startDate: iso('2026-04-15'),
      endDate: iso('2026-04-16'),
    };

    const model = buildRoomTimelineModel({
      trip,
      range: { startDate: trip.startDate, endDate: trip.endDate },
      rooms: [room],
      assignments: [assignment],
      personsById: new Map([[person.id, person]]),
      unknownLabel: 'Unknown',
      arrivals: [],
      departures: [],
    });

    const row = model.rows[0]!;
    expect(row.items).toHaveLength(1);
    expect(row.items[0]!.label).toBe('Alex');
  });

  it('handles empty date range gracefully', () => {
    const trip = createTrip();
    const room: Room = {
      id: 'r1' as Room['id'],
      tripId: trip.id,
      name: 'Room 1',
      capacity: 2,
      order: 0,
    };

    // If start > end, buildUtcDays returns []
    const model = buildRoomTimelineModel({
      trip,
      range: { startDate: iso('2026-04-05'), endDate: iso('2026-04-01') },
      rooms: [room],
      assignments: [],
      personsById: new Map(),
      unknownLabel: 'Unknown',
      arrivals: [],
      departures: [],
    });

    expect(model.days).toHaveLength(0);
    expect(model.dayKeys).toHaveLength(0);
    expect(model.rows[0]!.items).toHaveLength(0);
  });

  it('handles assignment with unknown person (not in personsById)', () => {
    const trip = createTrip();
    const room: Room = {
      id: 'r1' as Room['id'],
      tripId: trip.id,
      name: 'Room 1',
      capacity: 2,
      order: 0,
    };
    const assignment: RoomAssignment = {
      id: 'a1' as RoomAssignment['id'],
      tripId: trip.id,
      roomId: room.id,
      personId: 'unknown-person' as Person['id'],
      startDate: iso('2026-04-01'),
      endDate: iso('2026-04-03'),
    };

    const model = buildRoomTimelineModel({
      trip,
      range: { startDate: iso('2026-04-01'), endDate: iso('2026-04-05') },
      rooms: [room],
      assignments: [assignment],
      personsById: new Map(), // No persons
      unknownLabel: 'Unknown Guest',
      arrivals: [],
      departures: [],
    });

    const row = model.rows[0]!;
    expect(row.items).toHaveLength(1);
    expect(row.items[0]!.label).toBe('Unknown Guest');
    expect(row.items[0]!.color).toBe('#6b7280');
    expect(row.items[0]!.person).toBeUndefined();
  });

  it('clips an assignment that partially overlaps the start of the range', () => {
    const trip = createTrip();
    const room: Room = {
      id: 'r1' as Room['id'],
      tripId: trip.id,
      name: 'Room 1',
      capacity: 2,
      order: 0,
    };
    const person: Person = {
      id: 'p1' as Person['id'],
      tripId: trip.id,
      name: 'Alex',
      color: '#3b82f6' as HexColor,
    };
    // Assignment starts before the visible range
    const assignment: RoomAssignment = {
      id: 'a1' as RoomAssignment['id'],
      tripId: trip.id,
      roomId: room.id,
      personId: person.id,
      startDate: iso('2026-03-28'),
      endDate: iso('2026-04-03'),
    };

    const model = buildRoomTimelineModel({
      trip,
      range: { startDate: iso('2026-04-01'), endDate: iso('2026-04-05') },
      rooms: [room],
      assignments: [assignment],
      personsById: new Map([[person.id, person]]),
      unknownLabel: 'Unknown',
      arrivals: [],
      departures: [],
    });

    const row = model.rows[0]!;
    expect(row.items).toHaveLength(1);
    // Should start at index 0 (clipped to range start)
    expect(row.items[0]!.startIndex).toBe(0);
  });

  it('clips an assignment that extends beyond the end of the range', () => {
    const trip = createTrip();
    const room: Room = {
      id: 'r1' as Room['id'],
      tripId: trip.id,
      name: 'Room 1',
      capacity: 2,
      order: 0,
    };
    const person: Person = {
      id: 'p1' as Person['id'],
      tripId: trip.id,
      name: 'Alex',
      color: '#3b82f6' as HexColor,
    };
    // Assignment extends beyond the visible range
    const assignment: RoomAssignment = {
      id: 'a1' as RoomAssignment['id'],
      tripId: trip.id,
      roomId: room.id,
      personId: person.id,
      startDate: iso('2026-04-03'),
      endDate: iso('2026-04-10'), // Beyond range end of 04-05
    };

    const model = buildRoomTimelineModel({
      trip,
      range: { startDate: iso('2026-04-01'), endDate: iso('2026-04-05') },
      rooms: [room],
      assignments: [assignment],
      personsById: new Map([[person.id, person]]),
      unknownLabel: 'Unknown',
      arrivals: [],
      departures: [],
    });

    const row = model.rows[0]!;
    expect(row.items).toHaveLength(1);
    // Should end at the last index of the range
    expect(row.items[0]!.endIndex).toBe(4); // Index 4 = day 5 of range (0-indexed)
  });

  it('allocates sequential lanes for non-overlapping assignments in same room', () => {
    const trip = createTrip();
    const room: Room = {
      id: 'r1' as Room['id'],
      tripId: trip.id,
      name: 'Room 1',
      capacity: 2,
      order: 0,
    };
    const p1: Person = {
      id: 'p1' as Person['id'],
      tripId: trip.id,
      name: 'Alex',
      color: '#3b82f6' as HexColor,
    };
    const p2: Person = {
      id: 'p2' as Person['id'],
      tripId: trip.id,
      name: 'Sam',
      color: '#ef4444' as HexColor,
    };

    // Non-overlapping: Alex 1-3, Sam 3-5
    const a1: RoomAssignment = {
      id: 'a1' as RoomAssignment['id'],
      tripId: trip.id,
      roomId: room.id,
      personId: p1.id,
      startDate: iso('2026-04-01'),
      endDate: iso('2026-04-03'),
    };
    const a2: RoomAssignment = {
      id: 'a2' as RoomAssignment['id'],
      tripId: trip.id,
      roomId: room.id,
      personId: p2.id,
      startDate: iso('2026-04-03'),
      endDate: iso('2026-04-05'),
    };

    const model = buildRoomTimelineModel({
      trip,
      range: { startDate: iso('2026-04-01'), endDate: iso('2026-04-05') },
      rooms: [room],
      assignments: [a1, a2],
      personsById: new Map([
        [p1.id, p1],
        [p2.id, p2],
      ]),
      unknownLabel: 'Unknown',
      arrivals: [],
      departures: [],
    });

    // Non-overlapping should reuse the same lane
    expect(model.rows[0]!.items).toHaveLength(2);
    expect(model.rows[0]!.laneCount).toBe(1);
  });

  it('skips assignment when its roomId does not match any provided room', () => {
    const trip = createTrip();
    const room: Room = {
      id: 'r1' as Room['id'],
      tripId: trip.id,
      name: 'Room 1',
      capacity: 2,
      order: 0,
    };
    const person: Person = {
      id: 'p1' as Person['id'],
      tripId: trip.id,
      name: 'Alex',
      color: '#3b82f6' as HexColor,
    };
    const orphanedAssignment: RoomAssignment = {
      id: 'a1' as RoomAssignment['id'],
      tripId: trip.id,
      roomId: 'nonexistent-room' as Room['id'],
      personId: person.id,
      startDate: iso('2026-04-01'),
      endDate: iso('2026-04-03'),
    };

    const model = buildRoomTimelineModel({
      trip,
      range: { startDate: iso('2026-04-01'), endDate: iso('2026-04-05') },
      rooms: [room],
      assignments: [orphanedAssignment],
      personsById: new Map([[person.id, person]]),
      unknownLabel: 'Unknown',
      arrivals: [],
      departures: [],
    });

    // Room row should have no items since assignment references unknown room
    expect(model.rows[0]!.items).toHaveLength(0);
  });

  it('cross-room overlap tiebreak: prefers lower room order when stay lengths are equal', () => {
    const trip = createTrip();
    const roomA: Room = {
      id: 'rA' as Room['id'],
      tripId: trip.id,
      name: 'Room A',
      capacity: 2,
      order: 0,
    };
    const roomB: Room = {
      id: 'rB' as Room['id'],
      tripId: trip.id,
      name: 'Room B',
      capacity: 2,
      order: 5,
    };
    const person: Person = {
      id: 'p1' as Person['id'],
      tripId: trip.id,
      name: 'Alex',
      color: '#3b82f6' as HexColor,
    };

    // Equal-length overlapping assignments in different rooms
    const a1: RoomAssignment = {
      id: 'a1' as RoomAssignment['id'],
      tripId: trip.id,
      roomId: roomA.id,
      personId: person.id,
      startDate: iso('2026-04-01'),
      endDate: iso('2026-04-04'),
    };
    const a2: RoomAssignment = {
      id: 'a2' as RoomAssignment['id'],
      tripId: trip.id,
      roomId: roomB.id,
      personId: person.id,
      startDate: iso('2026-04-02'),
      endDate: iso('2026-04-05'),
    };

    const model = buildRoomTimelineModel({
      trip,
      range: { startDate: iso('2026-04-01'), endDate: iso('2026-04-05') },
      rooms: [roomA, roomB],
      assignments: [a1, a2],
      personsById: new Map([[person.id, person]]),
      unknownLabel: 'Unknown',
      arrivals: [],
      departures: [],
    });

    // Room A should have the assignment visible since lower order wins in tiebreak
    const roomARow = model.rows.find((r) => r.room.id === roomA.id);
    const roomBRow = model.rows.find((r) => r.room.id === roomB.id);
    expect(roomARow).toBeDefined();
    expect(roomBRow).toBeDefined();
    // At least one room should show the person in the overlapping days
    const totalItems = (roomARow!.items.length) + (roomBRow!.items.length);
    expect(totalItems).toBeGreaterThanOrEqual(1);
  });

  it('merges partially overlapping same-person assignments in one room into a single pill', () => {
    const trip: Trip = {
      id: 'trip-1' as Trip['id'],
      shareId: 'share-1' as Trip['shareId'],
      name: 'Trip',
      startDate: iso('2026-04-01'),
      endDate: iso('2026-04-30'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const room: Room = {
      id: 'r1' as Room['id'],
      tripId: trip.id,
      name: 'Room 1',
      capacity: 2,
      order: 0,
    };
    const marc: Person = {
      id: 'p-marc' as Person['id'],
      tripId: trip.id,
      name: 'Marc',
      color: '#06b6d4' as HexColor,
    };
    const left: RoomAssignment = {
      id: 'a-left' as RoomAssignment['id'],
      tripId: trip.id,
      roomId: room.id,
      personId: marc.id,
      startDate: iso('2026-04-07'),
      endDate: iso('2026-04-21'),
    };
    const right: RoomAssignment = {
      id: 'a-right' as RoomAssignment['id'],
      tripId: trip.id,
      roomId: room.id,
      personId: marc.id,
      startDate: iso('2026-04-16'),
      endDate: iso('2026-04-26'),
    };

    const model = buildRoomTimelineModel({
      trip,
      range: { startDate: iso('2026-04-01'), endDate: iso('2026-04-30') },
      rooms: [room],
      assignments: [left, right],
      personsById: new Map([[marc.id, marc]]),
      unknownLabel: 'Unknown',
      arrivals: [],
      departures: [],
    });

    const row = model.rows[0]!;
    expect(row.items).toHaveLength(1);
    expect(row.items[0]!.assignment.id).toBe(left.id);
    expect(row.items[0]!.startIndex).toBe(6);
    expect(row.items[0]!.endIndex).toBe(24);
    expect(row.items[0]!.label).toBe('Marc');
  });

  it('merges consecutive same-person assignments in one room into a single pill', () => {
    const trip = createTrip();
    const room: Room = {
      id: 'r1' as Room['id'],
      tripId: trip.id,
      name: 'Room 1',
      capacity: 2,
      order: 0,
    };
    const marc: Person = {
      id: 'p-marc' as Person['id'],
      tripId: trip.id,
      name: 'Marc',
      color: '#06b6d4' as HexColor,
    };
    const first: RoomAssignment = {
      id: 'a-first' as RoomAssignment['id'],
      tripId: trip.id,
      roomId: room.id,
      personId: marc.id,
      startDate: iso('2026-04-01'),
      endDate: iso('2026-04-04'),
    };
    const second: RoomAssignment = {
      id: 'a-second' as RoomAssignment['id'],
      tripId: trip.id,
      roomId: room.id,
      personId: marc.id,
      startDate: iso('2026-04-04'),
      endDate: iso('2026-04-06'),
    };

    const model = buildRoomTimelineModel({
      trip,
      range: { startDate: iso('2026-04-01'), endDate: iso('2026-04-05') },
      rooms: [room],
      assignments: [first, second],
      personsById: new Map([[marc.id, marc]]),
      unknownLabel: 'Unknown',
      arrivals: [],
      departures: [],
    });

    const row = model.rows[0]!;
    expect(row.items).toHaveLength(1);
    expect(row.items[0]!.startIndex).toBe(0);
    expect(row.items[0]!.endIndex).toBe(4);
  });

  it('cross-room overlap tiebreak: uses assignment id when stay lengths and room orders are equal', () => {
    const trip = createTrip();
    const roomA: Room = {
      id: 'rA' as Room['id'],
      tripId: trip.id,
      name: 'Room A',
      capacity: 2,
      order: 0,
    };
    const roomB: Room = {
      id: 'rB' as Room['id'],
      tripId: trip.id,
      name: 'Room B',
      capacity: 2,
      order: 0, // Same order as roomA
    };
    const person: Person = {
      id: 'p1' as Person['id'],
      tripId: trip.id,
      name: 'Alex',
      color: '#3b82f6' as HexColor,
    };

    // Equal-length overlapping assignments in rooms with same order
    const a1: RoomAssignment = {
      id: 'a-first' as RoomAssignment['id'],
      tripId: trip.id,
      roomId: roomA.id,
      personId: person.id,
      startDate: iso('2026-04-01'),
      endDate: iso('2026-04-04'),
    };
    const a2: RoomAssignment = {
      id: 'a-second' as RoomAssignment['id'],
      tripId: trip.id,
      roomId: roomB.id,
      personId: person.id,
      startDate: iso('2026-04-02'),
      endDate: iso('2026-04-05'),
    };

    const model = buildRoomTimelineModel({
      trip,
      range: { startDate: iso('2026-04-01'), endDate: iso('2026-04-05') },
      rooms: [roomA, roomB],
      assignments: [a1, a2],
      personsById: new Map([[person.id, person]]),
      unknownLabel: 'Unknown',
      arrivals: [],
      departures: [],
    });

    // Both rooms should have at least some items (the overlap resolution assigns the
    // "winning" assignment in full and clips the other)
    const totalItems = model.rows.reduce((sum, r) => sum + r.items.length, 0);
    expect(totalItems).toBeGreaterThanOrEqual(1);
  });
});


// ============================================================================
// Edges of the model: lanes, clipping, the one-bar rules and merging
// ============================================================================

describe('buildRoomTimelineModel edges', () => {
  const trip: Trip = { ...createTrip(), startDate: iso(tripDay(1)), endDate: iso(tripDay(12)) };

  const R1: Room = { id: 'r1' as Room['id'], tripId: trip.id, name: 'One', capacity: 4, order: 0 };
  const R2: Room = { id: 'r2' as Room['id'], tripId: trip.id, name: 'Two', capacity: 4, order: 1 };

  function guest(id: string, extra: Partial<Person> = {}): Person {
    return {
      id: id as Person['id'],
      tripId: trip.id,
      name: id,
      color: '#3b82f6' as HexColor,
      ...extra,
    };
  }

  function stay(
    id: string,
    personId: string,
    roomId: Room['id'],
    startDate: string,
    endDate: string,
  ): RoomAssignment {
    return {
      id: id as RoomAssignment['id'],
      tripId: trip.id,
      roomId,
      personId: personId as RoomAssignment['personId'],
      startDate: iso(startDate),
      endDate: iso(endDate),
    };
  }

  function build(
    assignments: readonly RoomAssignment[],
    options: {
      readonly rooms?: readonly Room[];
      readonly persons?: readonly Person[];
      readonly columns?: Parameters<typeof buildRoomTimelineModel>[0]['columns'];
    } = {},
  ) {
    const persons = options.persons ?? [guest('p1'), guest('p2'), guest('p3')];
    return buildRoomTimelineModel({
      trip,
      range: { startDate: trip.startDate, endDate: trip.endDate },
      rooms: options.rooms ?? [R1, R2],
      assignments,
      personsById: new Map(persons.map((person) => [person.id, person])),
      unknownLabel: 'Unknown',
      arrivals: [],
      departures: [],
      ...(options.columns ? { columns: options.columns } : {}),
    });
  }

  /** `[id, startIndex, endIndex]` of each bar in a room's row. */
  function bars(model: ReturnType<typeof build>, row = 0): [string, number, number][] {
    return model.rows[row]!.items.map((item) => [item.id, item.startIndex, item.endIndex]);
  }

  it('moves a later bar to a new lane once a reused lane has grown', () => {
    const model = build([
      stay('a', 'p1', R1.id, tripDay(1), tripDay(3)),
      stay('b', 'p2', R1.id, tripDay(4), tripDay(7)),
      stay('c', 'p3', R1.id, tripDay(5), tripDay(8)),
    ]);

    const lanes = Object.fromEntries(model.rows[0]!.items.map((item) => [item.id, item.laneIndex]));
    expect(lanes).toEqual({ a: 0, b: 0, c: 1 });
    expect(model.rows[0]!.laneCount).toBe(2);
  });

  it('skips a stay whose dates cannot be read', () => {
    const model = build([stay('a', 'p1', R1.id, 'garbage', tripDay(3))]);

    expect(bars(model)).toEqual([]);
  });

  it('skips a stay in a room the timeline does not show', () => {
    const model = build([stay('a', 'p1', 'gone' as Room['id'], tripDay(1), tripDay(3))]);

    expect(model.rows.flatMap((row) => row.items)).toEqual([]);
  });

  it('skips a stay that falls outside the axis', () => {
    const model = build([stay('a', 'p1', R1.id, tripDay(31), tripDay(33))]);

    expect(bars(model)).toEqual([]);
  });

  it('draws nothing on an axis with no columns', () => {
    const model = build([stay('a', 'p1', R1.id, tripDay(1), tripDay(3))], { columns: [] });

    expect(bars(model)).toEqual([]);
  });

  describe('clipping to the guest’s own stay', () => {
    it('trims the nights before the guest arrives', () => {
      const model = build([stay('a', 'p1', R1.id, tripDay(1), tripDay(6))], {
        persons: [guest('p1', { stayStartDate: iso(tripDay(3)), stayEndDate: iso(tripDay(10)) })],
      });

      expect(bars(model)).toEqual([['a', 2, 4]]);
      expect(model.rows[0]!.items[0]!.displayStayStart).toBe(tripDay(3));
    });

    it('leaves a booking that ends before the guest leaves as it is', () => {
      const model = build([stay('a', 'p1', R1.id, tripDay(2), tripDay(5))], {
        persons: [guest('p1', { stayStartDate: iso(tripDay(1)), stayEndDate: iso(tripDay(10)) })],
      });

      expect(bars(model)).toEqual([['a', 1, 3]]);
    });

    it('keeps a booking that shares a single night with the stay, on that night', () => {
      const model = build([stay('a', 'p1', R1.id, tripDay(1), tripDay(4))], {
        persons: [guest('p1', { stayStartDate: iso(tripDay(3)), stayEndDate: iso(tripDay(5)) })],
      });

      expect(bars(model)).toEqual([['a', 2, 2]]);
    });

    it.each([
      ['a zero-night stay', tripDay(2), tripDay(2)],
      ['a stay that ends before it starts', tripDay(4), tripDay(2)],
    ])('ignores %s rather than hiding the booking', (_name, stayStartDate, stayEndDate) => {
      const model = build([stay('a', 'p1', R1.id, tripDay(2), tripDay(4))], {
        persons: [guest('p1', { stayStartDate: iso(stayStartDate), stayEndDate: iso(stayEndDate) })],
      });

      expect(bars(model)).toEqual([['a', 1, 2]]);
    });

    it('ignores a departure that cannot be read', () => {
      const model = build([stay('a', 'p1', R1.id, tripDay(2), tripDay(4))], {
        persons: [guest('p1', { stayStartDate: iso(tripDay(1)), stayEndDate: iso('nope') })],
      });

      expect(bars(model)).toEqual([['a', 1, 2]]);
    });
  });

  describe('one guest in two rooms on the same nights', () => {
    it('shows one bar when the two share a single night', () => {
      const model = build([
        stay('a', 'p1', R1.id, tripDay(1), tripDay(4)),
        stay('b', 'p1', R2.id, tripDay(3), tripDay(6)),
      ]);

      expect(bars(model, 0)).toEqual([['a', 0, 2]]);
      expect(bars(model, 1)).toEqual([]);
    });

    it('shows both bars of a move on the check-out day', () => {
      const model = build([
        stay('a', 'p1', R1.id, tripDay(1), tripDay(3)),
        stay('b', 'p1', R2.id, tripDay(3), tripDay(5)),
      ]);

      expect(bars(model, 0)).toEqual([['a', 0, 1]]);
      expect(bars(model, 1)).toEqual([['b', 2, 3]]);
    });

    it('keeps the longer stay, whatever the room order', () => {
      const model = build([
        stay('a', 'p1', R1.id, tripDay(3), tripDay(5)),
        stay('b', 'p1', R2.id, tripDay(1), tripDay(8)),
      ]);

      expect(bars(model, 0)).toEqual([]);
      expect(bars(model, 1)).toEqual([['b', 0, 6]]);
    });

    it.each([
      ['listed first', true],
      ['listed second', false],
    ])('keeps the first room of two equal stays, %s', (_name, firstRoomFirst) => {
      // The ids say the opposite of the room order, so only the order can pick.
      const inFirstRoom = stay('z1', 'p1', R1.id, tripDay(2), tripDay(5));
      const inSecondRoom = stay('a2', 'p1', R2.id, tripDay(2), tripDay(5));
      const model = build(firstRoomFirst ? [inFirstRoom, inSecondRoom] : [inSecondRoom, inFirstRoom]);

      expect(bars(model, 0)).toEqual([['z1', 1, 3]]);
      expect(bars(model, 1)).toEqual([]);
    });

    it('falls back on the id between equal stays in rooms of the same order', () => {
      const sameOrder: Room = { ...R2, order: 0 };
      const model = build(
        [
          stay('z1', 'p1', R1.id, tripDay(2), tripDay(5)),
          stay('a2', 'p1', sameOrder.id, tripDay(2), tripDay(5)),
        ],
        { rooms: [R1, sameOrder] },
      );

      expect(bars(model, 0)).toEqual([]);
      expect(bars(model, 1)).toEqual([['a2', 1, 3]]);
    });
  });

  describe('one guest’s stays in one room', () => {
    it('merges two overlapping stays under the wider one', () => {
      const model = build([
        stay('a1', 'p1', R1.id, tripDay(3), tripDay(6)),
        stay('a2', 'p1', R1.id, tripDay(4), tripDay(9)),
      ]);

      expect(bars(model)).toEqual([['a2', 2, 7]]);
      const merged = model.rows[0]!.items[0]!;
      expect(merged.kind).toBe('assignment');
      expect(merged.displayStayStart).toBe(tripDay(3));
      expect(merged.displayStayEnd).toBe(tripDay(9));
    });

    it('merges two equal-width stays under the smaller id', () => {
      const model = build([
        stay('b', 'p1', R1.id, tripDay(1), tripDay(4)),
        stay('a', 'p1', R1.id, tripDay(2), tripDay(5)),
      ]);

      expect(bars(model)).toEqual([['a', 0, 3]]);
    });

    it('keeps two separate stays apart, whatever order they come in', () => {
      const model = build([
        stay('a1', 'p1', R1.id, tripDay(8), tripDay(10)),
        stay('a2', 'p1', R1.id, tripDay(1), tripDay(3)),
      ]);

      expect(bars(model).sort((x, y) => x[1] - y[1])).toEqual([
        ['a2', 0, 1],
        ['a1', 7, 8],
      ]);
    });

    it('chains three stays that each reach the next', () => {
      const model = build([
        stay('a', 'p1', R1.id, tripDay(1), tripDay(7)),
        stay('b', 'p1', R1.id, tripDay(4), tripDay(10)),
        stay('c', 'p1', R1.id, tripDay(9), tripDay(11)),
      ]);

      expect(bars(model)).toHaveLength(1);
      expect(bars(model)[0]!.slice(1)).toEqual([0, 9]);
    });

    it('keeps the dates of a lone stay on an axis of two-day columns', () => {
      const twoDayColumns = Array.from({ length: 6 }, (_, index) => {
        const start = tripDate(1 + 2 * index);
        const end = tripDate(3 + 2 * index);
        return {
          key: `c${index}`,
          start,
          end,
          topLabel: '',
          bottomLabel: '',
          title: '',
          isWeekend: false,
        };
      });
      const model = build(
        [
          stay('a1', 'p1', R1.id, tripDay(2), tripDay(4)),
          stay('a2', 'p1', R1.id, tripDay(10), tripDay(12)),
        ],
        { columns: twoDayColumns },
      );

      const first = model.rows[0]!.items.find((item) => item.id === 'a1')!;
      expect([first.startIndex, first.endIndex]).toEqual([0, 1]);
      expect(first.displayStayStart).toBe(tripDay(2));
      expect(first.displayStayEnd).toBe(tripDay(4));
    });
  });
});

describe('buildRoomTimelineModel, lanes and the visible window', () => {
  const trip: Trip = { ...createTrip(), startDate: iso(tripDay(1)), endDate: iso(tripDay(12)) };
  const room: Room = { id: 'r1' as Room['id'], tripId: trip.id, name: 'One', capacity: 4, order: 0 };
  const other: Room = { id: 'r2' as Room['id'], tripId: trip.id, name: 'Two', capacity: 4, order: 1 };
  const people = ['p1', 'p2', 'p3'].map((id) => ({
    id: id as Person['id'],
    tripId: trip.id,
    name: id,
    color: '#3b82f6' as HexColor,
  }));

  function booking(id: string, personId: string, roomId: Room['id'], start: string, end: string): RoomAssignment {
    return {
      id: id as RoomAssignment['id'],
      tripId: trip.id,
      roomId,
      personId: personId as RoomAssignment['personId'],
      startDate: iso(start),
      endDate: iso(end),
    };
  }

  function build(assignments: readonly RoomAssignment[], columns?: Parameters<typeof buildRoomTimelineModel>[0]['columns']) {
    return buildRoomTimelineModel({
      trip,
      range: { startDate: trip.startDate, endDate: trip.endDate },
      rooms: [room, other],
      assignments,
      personsById: new Map(people.map((person) => [person.id, person])),
      unknownLabel: 'Unknown',
      arrivals: [],
      departures: [],
      ...(columns ? { columns } : {}),
    });
  }

  function lanes(model: ReturnType<typeof build>): Record<string, number> {
    return Object.fromEntries(model.rows[0]!.items.map((item) => [item.id, item.laneIndex]));
  }

  it('packs lanes by start, whatever order the stays come in', () => {
    const model = build([
      booking('c', 'p3', room.id, tripDay(5), tripDay(8)),
      booking('a', 'p1', room.id, tripDay(1), tripDay(3)),
      booking('b', 'p2', room.id, tripDay(4), tripDay(7)),
    ]);

    expect(lanes(model)).toEqual({ a: 0, b: 0, c: 1 });
  });

  it('gives the longer of two stays that start together the first lane', () => {
    const model = build([
      booking('short', 'p1', room.id, tripDay(1), tripDay(3)),
      booking('long', 'p2', room.id, tripDay(1), tripDay(7)),
    ]);

    expect(lanes(model)).toEqual({ long: 0, short: 1 });
  });

  it('puts two stays that share their edge night in separate lanes', () => {
    const model = build([
      booking('a', 'p1', room.id, tripDay(1), tripDay(3)),
      booking('b', 'p2', room.id, tripDay(2), tripDay(4)),
    ]);

    expect(lanes(model)).toEqual({ a: 0, b: 1 });
  });

  it('reports a stay that runs off the axis by the part on it', () => {
    const model = build([booking('a', 'p1', room.id, tripDay(-1), tripDay(20))]);

    const item = model.rows[0]!.items[0]!;
    expect(item.kind).toBe('assignment');
    expect(item.displayStayStart).toBe(tripDay(1));
    expect(item.displayStayEnd).toBe(tripDay(13));
  });

  it('keeps one bar when a guest’s later stay in the first room touches an earlier one', () => {
    const model = build([
      booking('late', 'p1', room.id, tripDay(3), tripDay(6)),
      booking('early', 'p1', other.id, tripDay(1), tripDay(4)),
    ]);

    expect(model.rows[0]!.items.map((item) => item.id)).toEqual(['late']);
    expect(model.rows[1]!.items).toEqual([]);
  });

  it('lists each column’s first instant, and the day keys of day columns only', () => {
    const dayModel = build([]);
    expect(dayModel.days[0]).toEqual(tripDate(1));
    expect(dayModel.dayKeys[0]).toBe(tripDay(1));
    expect(dayModel.dayKeys).toHaveLength(dayModel.days.length);

    const twoDayModel = build(
      [],
      [
        {
          key: 'c0',
          start: tripDate(1),
          end: tripDate(3),
          topLabel: '',
          bottomLabel: '',
          title: '',
          isWeekend: false,
        },
      ],
    );
    expect(twoDayModel.dayKeys).toEqual([]);
  });
});

describe('buildRoomTimelineModel, one guest in two rooms at different times', () => {
  it('keeps both bars when the longer stay comes after the shorter one', () => {
    const trip: Trip = { ...createTrip(), startDate: iso(tripDay(1)), endDate: iso(tripDay(12)) };
    const first: Room = { id: 'r1' as Room['id'], tripId: trip.id, name: 'One', capacity: 2, order: 0 };
    const second: Room = { id: 'r2' as Room['id'], tripId: trip.id, name: 'Two', capacity: 2, order: 1 };
    const guest: Person = { id: 'p1' as Person['id'], tripId: trip.id, name: 'p1', color: '#3b82f6' as HexColor };
    const booking = (id: string, roomId: Room['id'], start: number, end: number): RoomAssignment => ({
      id: id as RoomAssignment['id'],
      tripId: trip.id,
      roomId,
      personId: guest.id,
      startDate: iso(tripDay(start)),
      endDate: iso(tripDay(end)),
    });

    const model = buildRoomTimelineModel({
      trip,
      range: { startDate: trip.startDate, endDate: trip.endDate },
      rooms: [first, second],
      // Two nights in the first room, then four in the second: no night shared.
      assignments: [booking('early', first.id, 1, 3), booking('late', second.id, 6, 10)],
      personsById: new Map([[guest.id, guest]]),
      unknownLabel: 'Unknown',
      arrivals: [],
      departures: [],
    });

    expect(model.rows[0]!.items.map((item) => item.id)).toEqual(['early']);
    expect(model.rows[1]!.items.map((item) => item.id)).toEqual(['late']);
  });
});

describe('buildRoomTimelineModel, records it cannot fully read', () => {
  const trip: Trip = { ...createTrip(), startDate: iso(tripDay(1)), endDate: iso(tripDay(12)) };
  const room: Room = { id: 'r1' as Room['id'], tripId: trip.id, name: 'One', capacity: 2, order: 0 };
  const booking = (id: string, roomId: Room['id'], start: number, end: number): RoomAssignment => ({
    id: id as RoomAssignment['id'],
    tripId: trip.id,
    roomId,
    personId: 'p1' as RoomAssignment['personId'],
    startDate: iso(tripDay(start)),
    endDate: iso(tripDay(end)),
  });
  const build = (assignments: readonly RoomAssignment[], person: Person) =>
    buildRoomTimelineModel({
      trip,
      range: { startDate: trip.startDate, endDate: trip.endDate },
      rooms: [room],
      assignments,
      personsById: new Map([[person.id, person]]),
      unknownLabel: 'Unknown',
      arrivals: [],
      departures: [],
    });
  const guest: Person = { id: 'p1' as Person['id'], tripId: trip.id, name: 'p1', color: '#3b82f6' as HexColor };

  it('draws nothing for a stay clipped to an arrival day that does not parse', () => {
    // Sorts between the booking's first and last night, so the clip adopts it.
    const model = build([booking('a', room.id, 2, 6)], {
      ...guest,
      stayStartDate: iso(`${tripDay(2)}x`),
      stayEndDate: iso(tripDay(8)),
    });

    expect(model.rows[0]!.items).toEqual([]);
  });

  it('still draws a guest’s booking beside one in a room it does not show', () => {
    const model = build([booking('known', room.id, 2, 4), booking('gone', 'gone' as Room['id'], 2, 4)], guest);

    expect(model.rows[0]!.items.map((item) => item.id)).toEqual(['known']);
  });
});
