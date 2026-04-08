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
});

