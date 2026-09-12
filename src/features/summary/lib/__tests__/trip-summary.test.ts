/**
 * @fileoverview Tests for the printable summary's single read.
 * @module features/summary/lib/__tests__/trip-summary.test
 */

import { describe, expect, it } from 'vitest';

import { loadTripSummary } from '@/features/summary/lib/trip-summary';
import { db } from '@/lib/db/database';
import type {
  Person,
  Room,
  RoomAssignment,
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

function room(
  id: string,
  tripId: TripId,
  order: number,
  overrides: Record<string, unknown> = {},
): Room {
  return {
    id,
    tripId,
    name: id,
    capacity: 2,
    order,
    ...overrides,
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
    startDate: '2026-07-02',
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
    // A wall-clock literal, so the day this lands on is the day the test says
    // it lands on wherever the suite runs.
    datetime: new Date('2026-07-02T10:00').toISOString(),
    location: 'Gare du Nord',
    needsPickup: false,
    ...overrides,
  } as unknown as Transport;
}

// ============================================================================
// Tests
// ============================================================================

describe('loadTripSummary', () => {
  it('answers null for a trip this device does not have', async () => {
    await expect(loadTripSummary(TRIP)).resolves.toBeNull();
  });

  it('reads only the trip it was asked for', async () => {
    await db.trips.bulkPut([trip(TRIP), trip(OTHER_TRIP)]);
    await db.persons.bulkPut([person('p1', TRIP), person('p2', OTHER_TRIP)]);
    await db.rooms.bulkPut([room('room-1', TRIP, 0), room('room-9', OTHER_TRIP, 0)]);

    const summary = await loadTripSummary(TRIP);

    expect(summary?.tripId).toBe(TRIP);
    expect(summary?.guests.map((guest) => guest.name)).toEqual(['p1']);
    expect(summary?.rooms.map((entry) => entry.roomId)).toEqual(['room-1']);
  });

  it('puts each guest in their room, earliest stay first', async () => {
    await db.trips.put(trip(TRIP));
    await db.persons.bulkPut([person('p1', TRIP), person('p2', TRIP)]);
    await db.rooms.bulkPut([room('room-1', TRIP, 0), room('room-2', TRIP, 1)]);
    await db.roomAssignments.bulkPut([
      assignment('a1', TRIP, { personId: 'p2', startDate: '2026-07-04' }),
      assignment('a2', TRIP, { personId: 'p1', startDate: '2026-07-01' }),
      assignment('a3', TRIP, { roomId: 'room-2', personId: 'p1' }),
    ]);

    const summary = await loadTripSummary(TRIP);

    expect(summary?.rooms[0]?.stays.map((stay) => stay.personName)).toEqual([
      'p1',
      'p2',
    ]);
    expect(summary?.rooms[1]?.stays.map((stay) => stay.personName)).toEqual(['p1']);
  });

  it('counts people rather than guest rows', async () => {
    await db.trips.put(trip(TRIP));
    await db.persons.bulkPut([
      person('p1', TRIP, { headcount: 2 }),
      person('p2', TRIP),
    ]);

    const summary = await loadTripSummary(TRIP);

    expect(summary?.headcount).toBe(3);
    expect(summary?.guests.find((guest) => guest.name === 'p1')?.headcount).toBe(2);
  });

  it('drops a stay whose guest is no longer on the trip', async () => {
    // A nameless bed on paper reads as a free bed, which is the opposite of
    // what the row means.
    await db.trips.put(trip(TRIP));
    await db.rooms.put(room('room-1', TRIP, 0));
    await db.roomAssignments.put(assignment('a1', TRIP, { personId: 'ghost' }));

    const summary = await loadTripSummary(TRIP);

    expect(summary?.rooms[0]?.stays).toEqual([]);
  });

  it('names the guests who still have a night with no bed', async () => {
    await db.trips.put(trip(TRIP));
    await db.persons.bulkPut([
      person('housed', TRIP),
      person('homeless', TRIP),
    ]);
    await db.rooms.put(room('room-1', TRIP, 0));
    await db.roomAssignments.put(
      assignment('a1', TRIP, {
        personId: 'housed',
        startDate: '2026-07-01',
        endDate: '2026-07-08',
      }),
    );

    const summary = await loadTripSummary(TRIP);

    expect(summary?.guestsWithoutRoom).toEqual(['homeless']);
  });

  it('lists travel earliest first, with the driver resolved', async () => {
    await db.trips.put(trip(TRIP));
    await db.persons.bulkPut([person('p1', TRIP), person('driver', TRIP)]);
    await db.transports.bulkPut([
      transport('t2', TRIP, {
        type: 'departure',
        datetime: new Date('2026-07-08T09:00').toISOString(),
        needsPickup: true,
        driverId: 'driver',
      }),
      transport('t1', TRIP, { needsPickup: true }),
    ]);

    const summary = await loadTripSummary(TRIP);

    expect(summary?.travels.map((travel) => travel.transportId)).toEqual([
      't1',
      't2',
    ]);
    expect(summary?.travels[0]?.driverName).toBeNull();
    expect(summary?.travels[1]?.driverName).toBe('driver');
  });

  it('reports a driver who left the trip as nobody', async () => {
    await db.trips.put(trip(TRIP));
    await db.persons.put(person('p1', TRIP));
    await db.transports.put(
      transport('t1', TRIP, { needsPickup: true, driverId: 'gone' }),
    );

    const summary = await loadTripSummary(TRIP);

    expect(summary?.travels[0]?.driverName).toBeNull();
  });

  it('carries the phone and the notes the group needs on paper', async () => {
    await db.trips.put(trip(TRIP, { location: 'Brittany' }));
    await db.persons.put(
      person('p1', TRIP, { phone: '+33 6 12 34 56 78', notes: 'No peanuts' }),
    );

    const summary = await loadTripSummary(TRIP);

    expect(summary?.location).toBe('Brittany');
    expect(summary?.guests[0]?.phone).toBe('+33 6 12 34 56 78');
    expect(summary?.guests[0]?.notes).toBe('No peanuts');
  });

  it('derives a guest stay from their own travel when they stated none', async () => {
    await db.trips.put(trip(TRIP));
    await db.persons.put(person('p1', TRIP));
    await db.transports.bulkPut([
      transport('t1', TRIP),
      transport('t2', TRIP, {
        type: 'departure',
        datetime: new Date('2026-07-06T09:00').toISOString(),
      }),
    ]);

    const summary = await loadTripSummary(TRIP);

    expect(summary?.guests[0]?.arrivalDate).toBe('2026-07-02');
    expect(summary?.guests[0]?.departureDate).toBe('2026-07-06');
  });
});
