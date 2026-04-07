/**
 * @fileoverview Unit tests for timeline utilities.
 *
 * @module features/calendar/__tests__/timeline-utils
 */

import { describe, expect, it } from 'vitest';

import type { HexColor, ISODateString, Person, Room, RoomAssignment, Transport, Trip } from '@/types';

import { buildCalendarTimelineModel } from '../utils/timeline-utils';

function iso(date: string): ISODateString {
  return date as ISODateString;
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

describe('buildCalendarTimelineModel', () => {
  it('allocates two lanes for overlapping items in the same person row', () => {
    const trip = createTrip();
    const person: Person = {
      id: 'p1' as Person['id'],
      tripId: trip.id,
      name: 'Alex',
      color: '#3b82f6' as HexColor,
    };

    const room: Room = {
      id: 'r1' as Room['id'],
      tripId: trip.id,
      name: 'Room 1',
      capacity: 2,
      order: 0,
    };

    const a1: RoomAssignment = {
      id: 'a1' as RoomAssignment['id'],
      tripId: trip.id,
      roomId: room.id,
      personId: person.id,
      startDate: iso('2026-04-01'),
      endDate: iso('2026-04-04'), // nights 1-3
    };

    const a2: RoomAssignment = {
      id: 'a2' as RoomAssignment['id'],
      tripId: trip.id,
      roomId: room.id,
      personId: person.id,
      startDate: iso('2026-04-02'),
      endDate: iso('2026-04-05'), // nights 2-4 overlaps
    };

    const model = buildCalendarTimelineModel({
      trip,
      persons: [person],
      rooms: [room],
      assignments: [a1, a2],
      arrivals: [],
      departures: [],
      unknownLabel: 'Unknown',
    });

    expect(model.rows).toHaveLength(1);
    expect(model.rows[0]?.laneCount).toBe(2);

    const laneIndices = model.rows[0]!.items
      .filter((i) => i.kind === 'assignment')
      .map((i) => i.laneIndex);

    expect(new Set(laneIndices).size).toBe(2);
  });

  it('treats assignment endDate as checkout and renders nights until endDate-1', () => {
    const trip = createTrip();
    const person: Person = {
      id: 'p1' as Person['id'],
      tripId: trip.id,
      name: 'Alex',
      color: '#3b82f6' as HexColor,
    };

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
      personId: person.id,
      startDate: iso('2026-04-01'),
      endDate: iso('2026-04-03'), // nights 1-2 (lastNight = 2)
    };

    const model = buildCalendarTimelineModel({
      trip,
      persons: [person],
      rooms: [room],
      assignments: [assignment],
      arrivals: [],
      departures: [],
      unknownLabel: 'Unknown',
    });

    const item = model.rows[0]!.items.find((i) => i.kind === 'assignment');
    expect(item).toBeDefined();

    // dayKeys for trip: 1..5 => indices: 0..4
    expect(item!.startIndex).toBe(0);
    expect(item!.endIndex).toBe(1);
  });

  it('adds transport points as single-day items', () => {
    const trip = createTrip();
    const person: Person = {
      id: 'p1' as Person['id'],
      tripId: trip.id,
      name: 'Alex',
      color: '#3b82f6' as HexColor,
    };

    const arrival: Transport = {
      id: 't1' as Transport['id'],
      tripId: trip.id,
      personId: person.id,
      type: 'arrival',
      datetime: '2026-04-02T10:00:00.000Z',
      location: 'Station',
      needsPickup: false,
    };

    const model = buildCalendarTimelineModel({
      trip,
      persons: [person],
      rooms: [],
      assignments: [],
      arrivals: [arrival],
      departures: [],
      unknownLabel: 'Unknown',
    });

    const transportItem = model.rows[0]!.items.find((i) => i.kind === 'transport');
    expect(transportItem).toBeDefined();
    expect(transportItem!.startIndex).toBe(1);
    expect(transportItem!.endIndex).toBe(1);
  });
});

