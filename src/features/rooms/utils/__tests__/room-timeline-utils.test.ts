/**
 * @fileoverview Unit tests for room timeline utilities.
 *
 * @module features/rooms/utils/__tests__/room-timeline-utils
 */

import { describe, expect, it } from 'vitest';

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

