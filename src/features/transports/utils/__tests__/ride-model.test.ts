/**
 * @fileoverview Guards the one read every transport surface shares.
 *
 * Three things here are load-bearing and none is obvious from the types:
 *
 * - a transport with a legacy `driverId` and no ride still renders as a
 *   journey, because no migration invents `Ride` rows for it;
 * - `isSelfDriven` is derived from who owns the legs, which is what turns
 *   "leave to pick people up" into "leave" for the airport run;
 * - a leg that has drifted out of its ride's window is *flagged*, never moved.
 *
 * @module features/transports/utils/__tests__/ride-model.test
 */

import { describe, expect, it } from 'vitest';

import {
  RIDE_MATCH_WINDOW_MINUTES,
  resolveRides,
  rideConcernsPerson,
  selectMismatchedLegs,
  selectRideByLeg,
  selectRidesDrivenBy,
} from '../ride-model';
import { hexColor } from '@/test/utils';
import type {
  Person,
  PersonId,
  Ride,
  RideId,
  Transport,
  TransportId,
  TripId,
  Vehicle,
  VehicleId,
} from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_ID = 'trip-1' as TripId;

function makePerson(id: string, overrides: Partial<Person> = {}): Person {
  return {
    id: id as PersonId,
    tripId: TRIP_ID,
    name: id,
    color: hexColor('#3b82f6'),
    ...overrides,
  };
}

function makeTransport(
  id: string,
  personId: string,
  datetime: string,
  overrides: Partial<Transport> = {},
): Transport {
  return {
    id: id as TransportId,
    tripId: TRIP_ID,
    personId: personId as PersonId,
    type: 'arrival',
    datetime,
    location: 'Lyon Part-Dieu',
    needsPickup: true,
    ...overrides,
  };
}

function makeRide(id: string, meetDatetime: string, overrides: Partial<Ride> = {}): Ride {
  return {
    id: id as RideId,
    tripId: TRIP_ID,
    direction: 'pickup',
    meetDatetime,
    location: 'Lyon Part-Dieu',
    ...overrides,
  };
}

const ALICE = makePerson('alice'),
  TOM = makePerson('tom'),
  AURELIA = makePerson('aurelia'),
  GUILLAUME = makePerson('guillaume');

// ============================================================================
// Tests
// ============================================================================

describe('resolveRides', () => {
  it('gathers several legs into one car', () => {
    const rides = resolveRides({
      rides: [makeRide('r1', '2026-07-15T15:02:00.000Z', { driverId: GUILLAUME.id })],
      transports: [
        makeTransport('t1', 'alice', '2026-07-15T15:02:00.000Z', {
          rideId: 'r1' as RideId,
        }),
        makeTransport('t2', 'tom', '2026-07-15T15:02:00.000Z', {
          rideId: 'r1' as RideId,
        }),
        makeTransport('t3', 'aurelia', '2026-07-15T15:20:00.000Z', {
          rideId: 'r1' as RideId,
        }),
      ],
      vehicles: [],
      persons: [ALICE, TOM, AURELIA, GUILLAUME],
    });

    expect(rides).toHaveLength(1);
    expect(rides[0]!.legs.map((leg) => leg.person?.name)).toEqual([
      'alice',
      'tom',
      'aurelia',
    ]);
    expect(rides[0]!.driver?.name).toBe('guillaume');
    expect(rides[0]!.isSelfDriven).toBe(false);
  });

  it('derives self-driving from the driver owning one of the legs', () => {
    // The user's rental case: Tom and Aurélia take the hire car to the airport
    // and leave it there. Nobody is chauffeuring them.
    const rides = resolveRides({
      rides: [
        makeRide('r1', '2026-07-20T09:00:00.000Z', {
          direction: 'dropoff',
          driverId: TOM.id,
        }),
      ],
      transports: [
        makeTransport('t1', 'tom', '2026-07-20T09:00:00.000Z', {
          type: 'departure',
          rideId: 'r1' as RideId,
        }),
        makeTransport('t2', 'aurelia', '2026-07-20T09:00:00.000Z', {
          type: 'departure',
          rideId: 'r1' as RideId,
        }),
      ],
      vehicles: [],
      persons: [TOM, AURELIA],
    });

    expect(rides[0]!.isSelfDriven).toBe(true);
  });

  it('reads a legacy driverId transport as a one-passenger journey', () => {
    const rides = resolveRides({
      rides: [],
      transports: [
        makeTransport('t1', 'alice', '2026-07-15T15:02:00.000Z', {
          driverId: GUILLAUME.id,
        }),
      ],
      vehicles: [],
      persons: [ALICE, GUILLAUME],
    });

    expect(rides).toHaveLength(1);
    expect(rides[0]!.isLegacy).toBe(true);
    expect(rides[0]!.ride).toBeUndefined();
    expect(rides[0]!.driver?.name).toBe('guillaume');
    expect(rides[0]!.legs).toHaveLength(1);
  });

  it('leaves a leg with no driver and no ride out of the journey list', () => {
    const rides = resolveRides({
      rides: [],
      transports: [makeTransport('t1', 'alice', '2026-07-15T15:02:00.000Z')],
      vehicles: [],
      persons: [ALICE],
    });

    expect(rides).toEqual([]);
  });

  it('ignores a rideId naming a ride this device does not hold', () => {
    // Happens on the QR-changeset path, where legs travel and rides do not.
    // Treating it as a car would render a journey with no time and no place.
    const rides = resolveRides({
      rides: [],
      transports: [
        makeTransport('t1', 'alice', '2026-07-15T15:02:00.000Z', {
          rideId: 'gone' as RideId,
        }),
      ],
      vehicles: [],
      persons: [ALICE],
    });

    expect(rides).toEqual([]);
  });

  it('subtracts the lead time to say when the driver leaves', () => {
    const rides = resolveRides({
      rides: [
        makeRide('r1', '2026-07-15T15:02:00.000Z', {
          driverId: GUILLAUME.id,
          leadTimeMinutes: 45,
        }),
      ],
      transports: [
        makeTransport('t1', 'alice', '2026-07-15T15:02:00.000Z', {
          rideId: 'r1' as RideId,
        }),
      ],
      vehicles: [],
      persons: [ALICE, GUILLAUME],
    });

    expect(rides[0]!.leaveAtMs).toBe(Date.parse('2026-07-15T14:17:00.000Z'));
  });

  it('falls back to the default lead time when the ride does not say', () => {
    const rides = resolveRides({
      rides: [makeRide('r1', '2026-07-15T15:02:00.000Z', { driverId: GUILLAUME.id })],
      transports: [],
      vehicles: [],
      persons: [GUILLAUME],
    });

    expect(rides[0]!.leadTimeMinutes).toBe(30);
    expect(rides[0]!.leaveAtMs).toBe(Date.parse('2026-07-15T14:32:00.000Z'));
  });

  it('resolves the chosen vehicle', () => {
    const espace: Vehicle = {
      id: 'v1' as VehicleId,
      tripId: TRIP_ID,
      name: 'Espace',
      seatCount: 7,
    };

    const rides = resolveRides({
      rides: [makeRide('r1', '2026-07-15T15:02:00.000Z', { vehicleId: espace.id })],
      transports: [],
      vehicles: [espace],
      persons: [],
    });

    expect(rides[0]!.vehicle?.name).toBe('Espace');
  });

  it('orders journeys by meeting time', () => {
    const rides = resolveRides({
      rides: [
        makeRide('late', '2026-07-15T18:00:00.000Z'),
        makeRide('early', '2026-07-15T09:00:00.000Z'),
      ],
      transports: [],
      vehicles: [],
      persons: [],
    });

    expect(rides.map((ride) => ride.id)).toEqual(['early', 'late']);
  });

  describe('a passenger who moved their time', () => {
    const buildWithAliceAt = (aliceDatetime: string) =>
      resolveRides({
        rides: [
          makeRide('r1', '2026-07-15T15:02:00.000Z', { driverId: GUILLAUME.id }),
        ],
        transports: [
          makeTransport('t1', 'tom', '2026-07-15T15:02:00.000Z', {
            rideId: 'r1' as RideId,
          }),
          makeTransport('t2', 'alice', aliceDatetime, { rideId: 'r1' as RideId }),
        ],
        vehicles: [],
        persons: [ALICE, TOM, GUILLAUME],
      });

    it('flags a leg that drifted past the window, without moving the ride', () => {
      const rides = buildWithAliceAt('2026-07-15T17:00:00.000Z'),
        alice = rides[0]!.legs.find((leg) => leg.person?.name === 'alice');

      expect(alice?.mismatch).toBe('after');
      expect(alice?.mismatchMinutes).toBe(118);
      // The ride keeps its time. Two other people are expecting it.
      expect(rides[0]!.meetDatetime).toBe('2026-07-15T15:02:00.000Z');
    });

    it('flags a leg that drifted earlier', () => {
      const rides = buildWithAliceAt('2026-07-15T12:00:00.000Z');

      expect(rides[0]!.legs.find((leg) => leg.person?.name === 'alice')?.mismatch).toBe(
        'before',
      );
    });

    it('does not flag a leg still inside the window', () => {
      const rides = buildWithAliceAt('2026-07-15T15:50:00.000Z');

      expect(
        rides[0]!.legs.every((leg) => leg.mismatch === undefined),
      ).toBe(true);
      expect(RIDE_MATCH_WINDOW_MINUTES).toBe(60);
    });

    it('never flags a leg whose datetime cannot be read', () => {
      // We cannot prove it does not fit, and a row nobody can place must not
      // accuse its passenger of having moved.
      const rides = buildWithAliceAt('not-a-date');

      expect(
        rides[0]!.legs.find((leg) => leg.person?.name === 'alice')?.mismatch,
      ).toBeUndefined();
    });
  });
});

describe('rideConcernsPerson', () => {
  const journeys = resolveRides({
    rides: [makeRide('r1', '2026-07-15T15:02:00.000Z', { driverId: GUILLAUME.id })],
    transports: [
      makeTransport('t1', 'alice', '2026-07-15T15:02:00.000Z', {
        rideId: 'r1' as RideId,
      }),
    ],
    vehicles: [],
    persons: [ALICE, TOM, GUILLAUME],
  });

  it('counts the driver', () => {
    expect(rideConcernsPerson(journeys[0]!, GUILLAUME.id)).toBe(true);
  });

  it('counts a passenger', () => {
    expect(rideConcernsPerson(journeys[0]!, ALICE.id)).toBe(true);
  });

  it('excludes everybody else', () => {
    expect(rideConcernsPerson(journeys[0]!, TOM.id)).toBe(false);
  });

  it('still counts a driver whose guest row has not projected yet', () => {
    // `driver` is undefined both when nobody drives and when this device cannot
    // name them. Reading it dropped a driver out of their own car's filter for
    // as long as their row was missing — on a freshly joined device, exactly
    // when they most want to know what they are driving.
    const unprojected = resolveRides({
      rides: [
        makeRide('r9', '2026-07-15T15:02:00.000Z', {
          driverId: 'not-yet-here' as PersonId,
        }),
      ],
      transports: [],
      vehicles: [],
      persons: [],
    });

    expect(unprojected[0]!.driver).toBeUndefined();
    expect(rideConcernsPerson(unprojected[0]!, 'not-yet-here' as PersonId)).toBe(true);
    expect(
      selectRidesDrivenBy(unprojected, 'not-yet-here' as PersonId).map((r) => r.id),
    ).toEqual(['r9']);
  });

  it('is false when nobody has said who they are', () => {
    expect(rideConcernsPerson(journeys[0]!, undefined)).toBe(false);
  });
});

describe('selectRidesDrivenBy', () => {
  const journeys = resolveRides({
    rides: [
      makeRide('mine', '2026-07-15T15:02:00.000Z', { driverId: GUILLAUME.id }),
      makeRide('theirs', '2026-07-15T18:00:00.000Z', { driverId: TOM.id }),
    ],
    transports: [],
    vehicles: [],
    persons: [TOM, GUILLAUME],
  });

  it('returns only what this person drives', () => {
    expect(selectRidesDrivenBy(journeys, GUILLAUME.id).map((r) => r.id)).toEqual([
      'mine',
    ]);
  });

  it('returns nothing for an unidentified device', () => {
    expect(selectRidesDrivenBy(journeys, undefined)).toEqual([]);
  });
});

describe('selectMismatchedLegs', () => {
  it('reports each drifted leg alongside its journey', () => {
    const journeys = resolveRides({
      rides: [makeRide('r1', '2026-07-15T15:02:00.000Z', { driverId: GUILLAUME.id })],
      transports: [
        makeTransport('t1', 'tom', '2026-07-15T15:02:00.000Z', {
          rideId: 'r1' as RideId,
        }),
        makeTransport('t2', 'alice', '2026-07-15T19:00:00.000Z', {
          rideId: 'r1' as RideId,
        }),
      ],
      vehicles: [],
      persons: [ALICE, TOM, GUILLAUME],
    });

    const mismatched = selectMismatchedLegs(journeys);

    expect(mismatched).toHaveLength(1);
    expect(mismatched[0]!.leg.person?.name).toBe('alice');
    expect(mismatched[0]!.journey.id).toBe('r1');
  });
});

describe('selectRideByLeg', () => {
  it('keys every leg of a car to the journey serving it', () => {
    const journeys = resolveRides({
      rides: [makeRide('r1', '2026-07-15T15:02:00.000Z', { driverId: GUILLAUME.id })],
      transports: [
        makeTransport('t1', 'alice', '2026-07-15T15:02:00.000Z', {
          rideId: 'r1' as RideId,
        }),
        makeTransport('t2', 'tom', '2026-07-15T15:02:00.000Z', {
          rideId: 'r1' as RideId,
        }),
      ],
      vehicles: [],
      persons: [ALICE, TOM, GUILLAUME],
    });

    const byLeg = selectRideByLeg(journeys);

    expect(byLeg.size).toBe(2);
    expect(byLeg.get('t1' as TransportId)?.id).toBe('r1');
    expect(byLeg.get('t2' as TransportId)?.id).toBe('r1');
  });

  it('leaves a legacy driverId-only leg out', () => {
    // `resolveRides` reports one as a one-passenger journey so that nothing
    // downstream branches on storage shape. Every caller of this index already
    // draws a bare `driverId` itself, and a second rendering either duplicates
    // it or — on the map — drops a pin exactly on top of the leg it came from.
    const journeys = resolveRides({
      rides: [],
      transports: [
        makeTransport('t1', 'alice', '2026-07-15T15:02:00.000Z', {
          driverId: GUILLAUME.id,
        }),
      ],
      vehicles: [],
      persons: [ALICE, GUILLAUME],
    });

    expect(journeys).toHaveLength(1);
    expect(journeys[0]?.isLegacy).toBe(true);
    expect(selectRideByLeg(journeys).size).toBe(0);
  });
});
