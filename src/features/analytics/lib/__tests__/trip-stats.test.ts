/**
 * @fileoverview Tests for the shared analytics read.
 * @module features/analytics/lib/__tests__/trip-stats.test
 */

import { describe, expect, it } from 'vitest';

import {
  isTripStatsEmpty,
  loadTripStats,
  readAnalytics,
  sumTripStats,
} from '@/features/analytics/lib/trip-stats';
import { db } from '@/lib/db/database';
import type {
  ISODateTimeString,
  Person,
  Ride,
  Room,
  RoomAssignment,
  Transport,
  TripId,
  Vehicle,
} from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_A = 'trip-a' as TripId;
const TRIP_B = 'trip-b' as TripId;

/** Dates are derived from today so the fixture never rots. */
const NOW: ISODateTimeString = new Date().toISOString();
const TOMORROW: ISODateTimeString = new Date(
  Date.now() + 24 * 60 * 60 * 1000,
).toISOString();
const YESTERDAY: ISODateTimeString = new Date(
  Date.now() - 24 * 60 * 60 * 1000,
).toISOString();

function person(id: string, tripId: TripId, headcount?: number): Person {
  return {
    id,
    tripId,
    name: id,
    color: '#3b82f6',
    ...(headcount === undefined ? {} : { headcount }),
  } as unknown as Person;
}

function room(id: string, tripId: TripId, order: number): Room {
  return { id, tripId, name: id, capacity: 2, order } as unknown as Room;
}

function assignment(id: string, tripId: TripId): RoomAssignment {
  return {
    id,
    tripId,
    roomId: 'room-1',
    personId: 'person-1',
    startDate: '2026-07-02',
    endDate: '2026-07-08',
  } as unknown as RoomAssignment;
}

function vehicle(id: string, tripId: TripId): Vehicle {
  return { id, tripId, name: id, seatCount: 5 } as unknown as Vehicle;
}

function ride(id: string, tripId: TripId): Ride {
  return {
    id,
    tripId,
    direction: 'pickup',
    meetDatetime: TOMORROW,
    location: 'Gare du Nord',
  } as unknown as Ride;
}

function transport(
  id: string,
  tripId: TripId,
  overrides: Record<string, unknown> = {},
): Transport {
  return {
    id,
    tripId,
    personId: 'person-1',
    type: 'arrival',
    datetime: TOMORROW,
    location: 'Gare du Nord',
    needsPickup: false,
    ...overrides,
  } as unknown as Transport;
}

// ============================================================================
// Tests
// ============================================================================

describe('loadTripStats', () => {
  it('counts people, not guest rows', async () => {
    await db.persons.bulkPut([
      person('p1', TRIP_A, 2),
      person('p2', TRIP_A, 3),
      // A legacy row without the field still stands for one person.
      person('p3', TRIP_A),
    ]);

    const stats = await loadTripStats(TRIP_A, NOW);

    expect(stats.guestCount).toBe(3);
    expect(stats.headcount).toBe(6);
  });

  it('never counts another trip’s rows', async () => {
    await db.persons.bulkPut([
      person('p1', TRIP_A, 2),
      person('p2', TRIP_B, 9),
    ]);
    await db.rooms.bulkPut([room('r1', TRIP_A, 0), room('r2', TRIP_B, 0)]);
    await db.roomAssignments.bulkPut([
      assignment('a1', TRIP_A),
      assignment('a2', TRIP_B),
    ]);
    await db.transports.bulkPut([
      transport('t1', TRIP_A),
      transport('t2', TRIP_B),
    ]);

    const stats = await loadTripStats(TRIP_A, NOW);

    expect(stats).toMatchObject({
      guestCount: 1,
      headcount: 2,
      roomCount: 1,
      assignmentCount: 1,
      transportCount: 1,
    });
  });

  it('splits transports so the total is always arrivals plus departures', async () => {
    await db.transports.bulkPut([
      transport('t1', TRIP_A, { type: 'arrival' }),
      transport('t2', TRIP_A, { type: 'arrival' }),
      transport('t3', TRIP_A, { type: 'departure' }),
    ]);

    const stats = await loadTripStats(TRIP_A, NOW);

    expect(stats.arrivalCount).toBe(2);
    expect(stats.departureCount).toBe(1);
    expect(stats.transportCount).toBe(stats.arrivalCount + stats.departureCount);
  });

  it('counts only upcoming, driverless pickups', async () => {
    await db.transports.bulkPut([
      // Counted: upcoming, needs a pickup, nobody driving.
      transport('t1', TRIP_A, { datetime: TOMORROW, needsPickup: true }),
      // Already happened.
      transport('t2', TRIP_A, { datetime: YESTERDAY, needsPickup: true }),
      // Someone is already driving.
      transport('t3', TRIP_A, {
        datetime: TOMORROW,
        needsPickup: true,
        driverId: 'person-2',
      }),
      // No pickup needed at all.
      transport('t4', TRIP_A, { datetime: TOMORROW, needsPickup: false }),
    ]);

    const stats = await loadTripStats(TRIP_A, NOW);

    expect(stats.pickupsNeedingDriver).toBe(1);
  });

  it('counts rides and cars apart from the legs they serve', async () => {
    // One car meeting two trains: two legs, one ride, one vehicle. Adding the
    // two totals together would report three journeys that nobody is making.
    await db.vehicles.bulkPut([vehicle('v1', TRIP_A), vehicle('v2', TRIP_B)]);
    await db.rides.bulkPut([ride('ride-1', TRIP_A), ride('ride-2', TRIP_B)]);
    await db.transports.bulkPut([
      transport('t1', TRIP_A, { rideId: 'ride-1' }),
      transport('t2', TRIP_A, { rideId: 'ride-1' }),
    ]);

    const stats = await loadTripStats(TRIP_A, NOW);

    expect(stats.rideCount).toBe(1);
    expect(stats.vehicleCount).toBe(1);
    expect(stats.transportCount).toBe(2);
  });

  it('counts a legacy self-driven leg as the journey every view draws', async () => {
    // What the share wizard writes when a guest says they will have a car:
    // a leg naming itself as its own driver, with no `Ride` row anywhere.
    // Counting `db.rides` would report zero journeys on a trip whose transport
    // list draws one.
    await db.transports.bulkPut([
      transport('t1', TRIP_A, { personId: 'p1', driverId: 'p1' }),
    ]);

    const stats = await loadTripStats(TRIP_A, NOW);

    expect(stats.rideCount).toBe(1);
    expect(stats.transportCount).toBe(1);
  });

  it('returns zeros for a trip with no rows', async () => {
    const stats = await loadTripStats(TRIP_A, NOW);

    expect(isTripStatsEmpty(stats)).toBe(true);
    expect(stats.headcount).toBe(0);
  });
});

describe('sumTripStats', () => {
  it('adds every field across trips', async () => {
    await db.persons.bulkPut([
      person('p1', TRIP_A, 2),
      person('p2', TRIP_B, 4),
    ]);
    await db.rooms.bulkPut([room('r1', TRIP_A, 0), room('r2', TRIP_B, 0)]);

    const totals = sumTripStats([
      await loadTripStats(TRIP_A, NOW),
      await loadTripStats(TRIP_B, NOW),
    ]);

    expect(totals.headcount).toBe(6);
    expect(totals.guestCount).toBe(2);
    expect(totals.roomCount).toBe(2);
  });

  it('is all zeros for no trips', () => {
    expect(sumTripStats([])).toEqual({
      guestCount: 0,
      headcount: 0,
      roomCount: 0,
      assignmentCount: 0,
      arrivalCount: 0,
      departureCount: 0,
      transportCount: 0,
      rideCount: 0,
      vehicleCount: 0,
      pickupsNeedingDriver: 0,
    });
  });
});

describe('isTripStatsEmpty', () => {
  it('is false as soon as the trip holds anything', async () => {
    await db.rooms.bulkPut([room('r1', TRIP_A, 0)]);

    expect(isTripStatsEmpty(await loadTripStats(TRIP_A, NOW))).toBe(false);
  });

  it('is false for a trip that holds only a car', async () => {
    // The hire car is booked months before anybody's train times are known, so
    // this is a real state and not a corner case. Calling it empty would show
    // "nothing to add up" on a page whose Cars card reads 1.
    await db.vehicles.bulkPut([vehicle('v1', TRIP_A)]);

    expect(isTripStatsEmpty(await loadTripStats(TRIP_A, NOW))).toBe(false);
  });

  it('is false for a trip that holds only a ride', async () => {
    await db.rides.bulkPut([ride('ride-1', TRIP_A)]);

    expect(isTripStatsEmpty(await loadTripStats(TRIP_A, NOW))).toBe(false);
  });
});

describe('readAnalytics', () => {
  it('passes the data through when the read succeeds', async () => {
    const result = await readAnalytics('read a number', async () =>
      Promise.resolve(42),
    );

    expect(result).toEqual({ data: 42, error: null });
  });

  it('resolves with the error rather than rejecting', async () => {
    const boom = new Error('IndexedDB is gone');

    const result = await readAnalytics('read a number', async () => {
      throw boom;
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe(boom);
  });

  it('wraps a non-Error rejection', async () => {
    const result = await readAnalytics('read a number', async () => {
      throw 'not an error';
    });

    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe('Failed to read a number');
  });
});
