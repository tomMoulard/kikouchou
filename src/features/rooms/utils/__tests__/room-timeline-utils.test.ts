/**
 * @fileoverview Unit tests for room timeline utilities.
 *
 * @module features/rooms/utils/__tests__/room-timeline-utils
 */

import { describe, expect, it } from 'vitest';

import type { HexColor, ISODateString, Person, Room, RoomAssignment, Trip } from '@/types';

import { buildRoomTimelineModel } from '../room-timeline-utils';

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
    });

    expect(model.rows[0]!.laneCount).toBe(2);
  });
});

