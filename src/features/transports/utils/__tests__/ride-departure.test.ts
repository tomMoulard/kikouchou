/**
 * @fileoverview Guards the rule that decides when a driver is told to leave.
 *
 * Every fixture here is placed as an offset from one frozen instant and written
 * as a UTC instant, so nothing in this file encodes the machine's timezone —
 * CI runs at UTC, where a test that quietly depended on an offset would pass
 * for the wrong reason.
 *
 * Four claims are load-bearing:
 *
 * - a ride whose leave time cannot be placed is **never** announced, because a
 *   banner that can never clear is worse than a missing one;
 * - the alert goes to the driver alone — a passenger has the worry and no lever;
 * - both windows close, so the banner stops being furniture;
 * - a zero lead time steps straight from `upcoming` to `late`, which is the
 *   honest reading of "there is no window before the meeting time".
 *
 * @module features/transports/utils/__tests__/ride-departure.test
 */

import { describe, expect, it } from 'vitest';

import {
  LATE_GRACE_MINUTES,
  UPCOMING_HORIZON_MINUTES,
  classifyRideDeparture,
  selectRideDepartures,
} from '../ride-departure';
import { resolveRides, type ResolvedRide } from '../ride-model';
import { hexColor } from '@/test/utils';
import type {
  Person,
  PersonId,
  Ride,
  RideId,
  Transport,
  TransportId,
  TripId,
} from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_ID = 'trip-1' as TripId;

/** The frozen reference instant every offset below is measured from. */
const NOW_MS = Date.UTC(2026, 6, 15, 10, 0, 0);

/** One minute, so the offsets read as minutes rather than as arithmetic. */
const MINUTE_MS = 60_000;

/**
 * An instant a given number of minutes from {@link NOW_MS}.
 *
 * @param minutes - Minutes ahead (negative for behind)
 * @returns The UTC ISO instant
 */
function minutesFromNow(minutes: number): string {
  return new Date(NOW_MS + minutes * MINUTE_MS).toISOString();
}

function makePerson(id: string): Person {
  return {
    id: id as PersonId,
    tripId: TRIP_ID,
    name: id,
    color: hexColor('#3b82f6'),
  };
}

const GUILLAUME = makePerson('guillaume'),
  ALICE = makePerson('alice'),
  TOM = makePerson('tom');

function makeRide(id: string, meetDatetime: string, overrides: Partial<Ride> = {}): Ride {
  return {
    id: id as RideId,
    tripId: TRIP_ID,
    direction: 'pickup',
    meetDatetime,
    location: 'Lyon Part-Dieu',
    driverId: GUILLAUME.id,
    ...overrides,
  };
}

function makeLeg(
  id: string,
  personId: string,
  rideId: string,
  datetime: string,
): Transport {
  return {
    id: id as TransportId,
    tripId: TRIP_ID,
    personId: personId as PersonId,
    type: 'arrival',
    datetime,
    location: 'Lyon Part-Dieu',
    needsPickup: true,
    rideId: rideId as RideId,
  };
}

/**
 * Resolves one ride carrying one leg, the way every transport surface reads it.
 *
 * Going through `resolveRides` rather than hand-building a `ResolvedRide` is
 * deliberate: `leaveAtMs` is derived there, and a fixture that set it directly
 * would keep passing after the derivation broke.
 */
function resolveOne(ride: Ride, passengerId = ALICE.id): ResolvedRide {
  const journeys = resolveRides({
    rides: [ride],
    transports: [makeLeg('leg-1', passengerId, ride.id, ride.meetDatetime)],
    vehicles: [],
    persons: [GUILLAUME, ALICE, TOM],
  });

  return journeys[0]!;
}

// ============================================================================
// Tests
// ============================================================================

describe('classifyRideDeparture', () => {
  it('says nothing about a ride whose meeting time cannot be placed', () => {
    const journey = resolveOne(makeRide('r1', 'not-a-datetime'));

    expect(journey.leaveAtMs).toBeNull();
    expect(classifyRideDeparture(journey, NOW_MS)).toBeUndefined();
  });

  it('calls a ride upcoming while the lead window has not opened', () => {
    // Meeting in 90 minutes, leaving 30 before: 60 minutes of waiting left.
    const journey = resolveOne(makeRide('r1', minutesFromNow(90)));

    expect(classifyRideDeparture(journey, NOW_MS)).toBe('upcoming');
  });

  it('calls a ride leaveNow the moment the lead window opens', () => {
    const journey = resolveOne(
      makeRide('r1', minutesFromNow(30), { leadTimeMinutes: 30 }),
    );

    expect(classifyRideDeparture(journey, NOW_MS)).toBe('leaveNow');
  });

  it('stays leaveNow through the window, right up to the meeting time', () => {
    const journey = resolveOne(
      makeRide('r1', minutesFromNow(1), { leadTimeMinutes: 30 }),
    );

    expect(classifyRideDeparture(journey, NOW_MS)).toBe('leaveNow');
  });

  it('turns late once the meeting time has passed', () => {
    const journey = resolveOne(makeRide('r1', minutesFromNow(-5)));

    expect(classifyRideDeparture(journey, NOW_MS)).toBe('late');
  });

  it('gives up on a ride whose meeting time is long past', () => {
    const journey = resolveOne(makeRide('r1', minutesFromNow(-LATE_GRACE_MINUTES - 1)));

    expect(classifyRideDeparture(journey, NOW_MS)).toBeUndefined();
  });

  it('says nothing about a ride beyond the horizon', () => {
    const journey = resolveOne(
      makeRide('r1', minutesFromNow(UPCOMING_HORIZON_MINUTES + 60), {
        leadTimeMinutes: 30,
      }),
    );

    expect(classifyRideDeparture(journey, NOW_MS)).toBeUndefined();
  });

  it('places the horizon on the leave time, not on the meeting time', () => {
    // The meeting is eighteen hours away — well past the horizon on its own —
    // but the driver typed an eight-hour lead time, so setting off is ten hours
    // from now and squarely inside it. The lead time is the whole point of the
    // feature; a horizon measured from the meeting would ignore it.
    const journey = resolveOne(
      makeRide('r1', minutesFromNow(18 * 60), { leadTimeMinutes: 8 * 60 }),
    );

    expect(classifyRideDeparture(journey, NOW_MS)).toBe('upcoming');
  });

  it('steps straight from upcoming to late when the lead time is zero', () => {
    const journey = resolveOne(makeRide('r1', minutesFromNow(1), { leadTimeMinutes: 0 }));

    expect(classifyRideDeparture(journey, NOW_MS)).toBe('upcoming');
    expect(classifyRideDeparture(journey, NOW_MS + MINUTE_MS)).toBe('late');
  });
});

describe('selectRideDepartures', () => {
  it('tells nobody when this device does not know who it is', () => {
    const journey = resolveOne(makeRide('r1', minutesFromNow(10)));

    expect(selectRideDepartures([journey], undefined, NOW_MS)).toEqual([]);
  });

  it('tells the driver and not the passenger', () => {
    const journey = resolveOne(makeRide('r1', minutesFromNow(10)));

    expect(selectRideDepartures([journey], GUILLAUME.id, NOW_MS)).toHaveLength(1);
    expect(selectRideDepartures([journey], ALICE.id, NOW_MS)).toEqual([]);
  });

  it('narrows leaveAtMs and meetAtMs to numbers for its consumers', () => {
    const journey = resolveOne(
      makeRide('r1', minutesFromNow(30), { leadTimeMinutes: 45 }),
    );

    const [departure] = selectRideDepartures([journey], GUILLAUME.id, NOW_MS);

    expect(departure?.leaveAtMs).toBe(NOW_MS - 15 * MINUTE_MS);
    expect(departure?.meetAtMs).toBe(NOW_MS + 30 * MINUTE_MS);
  });

  it('orders several cars by when the driver has to set off', () => {
    const journeys = resolveRides({
      rides: [
        makeRide('r-late', minutesFromNow(120)),
        makeRide('r-soon', minutesFromNow(20)),
      ],
      transports: [
        makeLeg('leg-1', ALICE.id, 'r-late', minutesFromNow(120)),
        makeLeg('leg-2', TOM.id, 'r-soon', minutesFromNow(20)),
      ],
      vehicles: [],
      persons: [GUILLAUME, ALICE, TOM],
    });

    const departures = selectRideDepartures(journeys, GUILLAUME.id, NOW_MS);

    expect(departures.map((departure) => departure.journey.id)).toEqual([
      'r-soon',
      'r-late',
    ]);
    expect(departures.map((departure) => departure.status)).toEqual([
      'leaveNow',
      'upcoming',
    ]);
  });

  it('drops an unplaceable ride while keeping the placeable ones', () => {
    const journeys = resolveRides({
      rides: [makeRide('r-broken', ''), makeRide('r-ok', minutesFromNow(20))],
      transports: [
        makeLeg('leg-1', ALICE.id, 'r-broken', minutesFromNow(20)),
        makeLeg('leg-2', TOM.id, 'r-ok', minutesFromNow(20)),
      ],
      vehicles: [],
      persons: [GUILLAUME, ALICE, TOM],
    });

    const departures = selectRideDepartures(journeys, GUILLAUME.id, NOW_MS);

    expect(departures.map((departure) => departure.journey.id)).toEqual(['r-ok']);
  });

  it('reads a legacy driverId leg as a journey the driver is told about', () => {
    const journeys = resolveRides({
      rides: [],
      transports: [
        {
          ...makeLeg('legacy-1', ALICE.id, 'unused', minutesFromNow(20)),
          rideId: undefined,
          driverId: GUILLAUME.id,
        },
      ],
      vehicles: [],
      persons: [GUILLAUME, ALICE],
    });

    const departures = selectRideDepartures(journeys, GUILLAUME.id, NOW_MS);

    expect(departures).toHaveLength(1);
    expect(departures[0]?.status).toBe('leaveNow');
  });
});
