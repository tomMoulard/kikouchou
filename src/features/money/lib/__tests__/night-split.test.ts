/**
 * @fileoverview Tests for the per guest night counts a rent split is built on.
 * @module features/money/lib/__tests__/night-split.test
 */

import { describe, expect, it } from 'vitest';

import { loadTripNightSplit } from '@/features/money/lib/night-split';
import { db } from '@/lib/db/database';
import type {
  Person,
  RoomAssignment,
  Room,
  Transport,
  Trip,
  TripId,
} from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP = 'trip-a' as TripId;
const OTHER_TRIP = 'trip-b' as TripId;

function trip(id: TripId, overrides: Record<string, unknown> = {}): Trip {
  return {
    id,
    name: `Trip ${id}`,
    // Seven nights: the 1st to the 7th, with the 8th as the check-out morning.
    startDate: '2026-07-01',
    endDate: '2026-07-08',
    shareId: `share-${id}`,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as unknown as Trip;
}

function person(
  id: string,
  tripId: TripId,
  overrides: Record<string, unknown> = {},
): Person {
  return {
    id,
    tripId,
    name: id,
    color: '#3b82f6',
    ...overrides,
  } as unknown as Person;
}

function room(id: string, tripId: TripId, order = 0): Room {
  return {
    id,
    tripId,
    name: id,
    capacity: 4,
    order,
  } as unknown as Room;
}

function assignment(
  id: string,
  tripId: TripId,
  overrides: Record<string, unknown> = {},
): RoomAssignment {
  return {
    id,
    tripId,
    roomId: 'room-1',
    personId: 'p1',
    startDate: '2026-07-01',
    endDate: '2026-07-08',
    ...overrides,
  } as unknown as RoomAssignment;
}

function transport(
  id: string,
  tripId: TripId,
  overrides: Record<string, unknown> = {},
): Transport {
  return {
    id,
    tripId,
    personId: 'p1',
    type: 'arrival',
    // A wall-clock literal, so the day this lands on is the day the test names
    // wherever the suite runs.
    datetime: new Date('2026-07-03T10:00').toISOString(),
    location: 'Gare du Nord',
    needsPickup: false,
    ...overrides,
  } as unknown as Transport;
}

// ============================================================================
// Tests
// ============================================================================

describe('loadTripNightSplit', () => {
  it('answers null for a trip this device does not have', async () => {
    await expect(loadTripNightSplit(TRIP)).resolves.toBeNull();
  });

  it('counts every night of the trip for a guest with no dates of their own', async () => {
    await db.trips.put(trip(TRIP));
    await db.persons.put(person('p1', TRIP));

    const split = await loadTripNightSplit(TRIP);

    expect(split?.nights).toBe(7);
    expect(split?.guests).toEqual([
      expect.objectContaining({ name: 'p1', nights: 7, headcount: 1, personNights: 7 }),
    ]);
    expect(split?.personNights).toBe(7);
  });

  it('multiplies the nights of a guest row that stands for several people', async () => {
    await db.trips.put(trip(TRIP));
    await db.persons.bulkPut([
      person('couple', TRIP, {
        headcount: 2,
        stayStartDate: '2026-07-01',
        stayEndDate: '2026-07-05',
      }),
      person('solo', TRIP, {
        stayStartDate: '2026-07-01',
        stayEndDate: '2026-07-03',
      }),
    ]);

    const split = await loadTripNightSplit(TRIP);

    expect(split?.guests).toEqual([
      expect.objectContaining({ name: 'couple', nights: 4, personNights: 8 }),
      expect.objectContaining({ name: 'solo', nights: 2, personNights: 2 }),
    ]);
    expect(split?.personNights).toBe(10);
  });

  it('gives each guest their share of the person nights', async () => {
    await db.trips.put(trip(TRIP));
    await db.persons.bulkPut([
      person('long', TRIP, { stayStartDate: '2026-07-01', stayEndDate: '2026-07-07' }),
      person('short', TRIP, { stayStartDate: '2026-07-01', stayEndDate: '2026-07-03' }),
    ]);

    const split = await loadTripNightSplit(TRIP);

    expect(split?.guests[0]?.share).toBeCloseTo(6 / 8);
    expect(split?.guests[1]?.share).toBeCloseTo(2 / 8);
  });

  it('counts a bed given without any stay dates', async () => {
    // A host can book somebody a room and never fill in their dates. Those
    // nights are as real as any other, and the rent covers them.
    await db.trips.put(trip(TRIP));
    await db.persons.put(person('p1', TRIP));
    await db.rooms.put(room('room-1', TRIP));
    await db.roomAssignments.put(
      assignment('a1', TRIP, { startDate: '2026-07-02', endDate: '2026-07-04' }),
    );

    const split = await loadTripNightSplit(TRIP);

    // The room says two nights, the missing dates say the whole trip, and the
    // whole trip is the wider answer.
    expect(split?.guests[0]?.nights).toBe(7);
  });

  it('reads a stay stated by transports rather than by dates', async () => {
    await db.trips.put(trip(TRIP));
    await db.persons.put(person('p1', TRIP));
    await db.transports.bulkPut([
      transport('t1', TRIP),
      transport('t2', TRIP, {
        type: 'departure',
        datetime: new Date('2026-07-06T09:00').toISOString(),
      }),
    ]);

    const split = await loadTripNightSplit(TRIP);

    // Lands on the 3rd, leaves on the 6th: the 3rd, 4th and 5th.
    expect(split?.guests[0]?.nights).toBe(3);
  });

  it('clips a stay that runs past the trip', async () => {
    await db.trips.put(trip(TRIP));
    await db.persons.put(
      person('p1', TRIP, { stayStartDate: '2026-06-25', stayEndDate: '2026-07-20' }),
    );

    const split = await loadTripNightSplit(TRIP);

    expect(split?.guests[0]?.nights).toBe(7);
  });

  it('says nobody sleeps anywhere on a same day trip', async () => {
    await db.trips.put(trip(TRIP, { startDate: '2026-07-01', endDate: '2026-07-01' }));
    await db.persons.put(person('p1', TRIP));

    const split = await loadTripNightSplit(TRIP);

    expect(split?.nights).toBe(0);
    expect(split?.personNights).toBe(0);
    expect(split?.guests[0]?.nights).toBe(0);
    expect(split?.guests[0]?.share).toBe(0);
  });

  it('reads only the trip it was asked for', async () => {
    await db.trips.bulkPut([trip(TRIP), trip(OTHER_TRIP)]);
    await db.persons.bulkPut([person('mine', TRIP), person('theirs', OTHER_TRIP)]);

    const split = await loadTripNightSplit(TRIP);

    expect(split?.tripId).toBe(TRIP);
    expect(split?.guests.map((guest) => guest.name)).toEqual(['mine']);
  });

  it('lists the longest stays first, then by name', async () => {
    await db.trips.put(trip(TRIP));
    await db.persons.bulkPut([
      person('bob', TRIP, { stayStartDate: '2026-07-01', stayEndDate: '2026-07-03' }),
      person('alice', TRIP, { stayStartDate: '2026-07-01', stayEndDate: '2026-07-03' }),
      person('zoe', TRIP, { stayStartDate: '2026-07-01', stayEndDate: '2026-07-08' }),
    ]);

    const split = await loadTripNightSplit(TRIP);

    expect(split?.guests.map((guest) => guest.name)).toEqual(['zoe', 'alice', 'bob']);
  });
});
