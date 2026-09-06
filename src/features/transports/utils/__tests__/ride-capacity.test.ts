/**
 * @fileoverview Guards the two rules a capacity check gets wrong by default.
 *
 * **Count people, not rows.** "Alice+Auré" is one guest row standing for two
 * bodies, so a five-seat car does not hold five rows. Every figure sums through
 * a `HeadcountResolver`, and this file is what fails if a call site ever counts
 * `legs.length` instead.
 *
 * **An absent limit is not a limit of zero.** A car nobody has measured raises
 * no warning; reading a missing `seatCount` as zero would mark every unmeasured
 * car as overloaded, which is worse than saying nothing.
 *
 * @module features/transports/utils/__tests__/ride-capacity.test
 */

import { describe, expect, it } from 'vitest';

import { createHeadcountResolver } from '@/features/rooms/utils/capacity-utils';
import { resolveRides } from '../ride-model';
import { hasCapacityWarning, summariseRideCapacity } from '../ride-capacity';
import { hexColor } from '@/test/utils';
import type {
  ChildSeatKind,
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

function makeTransport(id: string, personId: string, rideId: string): Transport {
  return {
    id: id as TransportId,
    tripId: TRIP_ID,
    personId: personId as PersonId,
    type: 'arrival',
    datetime: '2026-07-15T15:02:00.000Z',
    location: 'Lyon Part-Dieu',
    needsPickup: true,
    rideId: rideId as RideId,
  };
}

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 'v1' as VehicleId,
    tripId: TRIP_ID,
    name: 'Espace',
    ...overrides,
  };
}

const RIDE: Ride = {
  id: 'r1' as RideId,
  tripId: TRIP_ID,
  direction: 'pickup',
  meetDatetime: '2026-07-15T15:02:00.000Z',
  location: 'Lyon Part-Dieu',
};

/** Builds the one resolved journey these cases all measure. */
function summarise(
  persons: readonly Person[],
  options: {
    readonly passengerIds: readonly string[];
    readonly driverId?: string;
    readonly vehicle?: Vehicle;
  },
) {
  const journeys = resolveRides({
    rides: [
      {
        ...RIDE,
        driverId: options.driverId as PersonId | undefined,
        vehicleId: options.vehicle?.id,
      },
    ],
    transports: options.passengerIds.map((personId, index) =>
      makeTransport(`t${index}`, personId, 'r1'),
    ),
    vehicles: options.vehicle === undefined ? [] : [options.vehicle],
    persons,
  });

  return summariseRideCapacity(journeys[0]!, createHeadcountResolver(persons));
}

// ============================================================================
// Tests
// ============================================================================

describe('summariseRideCapacity — seats', () => {
  it('counts people, not guest rows', () => {
    // Three rows, but "Alice+Auré" stands for two bodies, plus the driver.
    const persons = [
      makePerson('alice', { headcount: 2 }),
      makePerson('tom'),
      makePerson('guillaume'),
    ];

    const summary = summarise(persons, {
      passengerIds: ['alice', 'tom'],
      driverId: 'guillaume',
      vehicle: makeVehicle({ seatCount: 4 }),
    });

    expect(summary.seatsUsed).toBe(4);
    expect(summary.isFull).toBe(true);
    expect(summary.isOverCapacity).toBe(false);
  });

  it('reports over capacity when the bodies exceed the seats', () => {
    const persons = [
      makePerson('alice', { headcount: 2 }),
      makePerson('tom'),
      makePerson('guillaume'),
    ];

    const summary = summarise(persons, {
      passengerIds: ['alice', 'tom'],
      driverId: 'guillaume',
      vehicle: makeVehicle({ seatCount: 3 }),
    });

    expect(summary.seatsUsed).toBe(4);
    expect(summary.isOverCapacity).toBe(true);
    expect(hasCapacityWarning(summary)).toBe(true);
  });

  it('counts a self-driving driver exactly once', () => {
    // Tom drives himself and Aurélia to the airport. Counting Tom twice would
    // report a couple as four people.
    const persons = [makePerson('tom'), makePerson('aurelia')];

    const summary = summarise(persons, {
      passengerIds: ['tom', 'aurelia'],
      driverId: 'tom',
      vehicle: makeVehicle({ seatCount: 5 }),
    });

    expect(summary.seatsUsed).toBe(2);
    expect(summary.seatsFree).toBe(3);
  });

  it('adds the driver when they are not also a passenger', () => {
    const persons = [makePerson('alice'), makePerson('guillaume')];

    const summary = summarise(persons, {
      passengerIds: ['alice'],
      driverId: 'guillaume',
      vehicle: makeVehicle({ seatCount: 5 }),
    });

    expect(summary.seatsUsed).toBe(2);
  });

  it('counts a driver the trip cannot name as a person', () => {
    // `driver` is undefined for two different reasons — nobody is driving, or
    // somebody is and this device has not projected their row yet — and only
    // the second is a body in the car. Reading the resolved object instead of
    // the id made a full car report a free seat, while an unresolved
    // *passenger* was already counted as one.
    const persons = [makePerson('alice')];

    const summary = summarise(persons, {
      passengerIds: ['alice'],
      driverId: 'not-yet-projected',
      vehicle: makeVehicle({ seatCount: 2 }),
    });

    expect(summary.seatsUsed).toBe(2);
    expect(summary.isFull).toBe(true);
    expect(summary.seatsFree).toBe(0);
  });

  it('raises nothing against a car whose seats are not set', () => {
    const persons = [makePerson('alice'), makePerson('tom'), makePerson('bob')];

    const summary = summarise(persons, {
      passengerIds: ['alice', 'tom', 'bob'],
      vehicle: makeVehicle(),
    });

    expect(summary.seatsAvailable).toBeUndefined();
    expect(summary.seatsFree).toBeUndefined();
    expect(summary.isOverCapacity).toBe(false);
    expect(summary.isFull).toBe(false);
    expect(hasCapacityWarning(summary)).toBe(false);
  });

  it('reports nothing checked when no car is chosen', () => {
    const persons = [makePerson('alice')];

    const summary = summarise(persons, { passengerIds: ['alice'] });

    expect(summary.isUnchecked).toBe(true);
    expect(summary.childSeatShortfalls).toEqual([]);
  });

  it('counts a leg whose guest the trip no longer holds as one body', () => {
    // Somebody is standing at that station whether or not their row survived.
    const summary = summarise([], { passengerIds: ['ghost'] });

    expect(summary.seatsUsed).toBe(1);
  });
});

describe('summariseRideCapacity — child seats', () => {
  const jeanne = makePerson('jeanne', { childSeat: 'rearFacing' as ChildSeatKind }),
    louis = makePerson('louis', { childSeat: 'booster' as ChildSeatKind }),
    mila = makePerson('mila', { childSeat: 'booster' as ChildSeatKind }),
    guillaume = makePerson('guillaume');

  it('tallies what the passengers need', () => {
    const summary = summarise([jeanne, louis, mila, guillaume], {
      passengerIds: ['jeanne', 'louis', 'mila'],
      driverId: 'guillaume',
      vehicle: makeVehicle({ childSeats: ['rearFacing', 'booster', 'booster'] }),
    });

    expect(summary.requiredChildSeats).toEqual({
      rearFacing: 1,
      forwardFacing: 0,
      booster: 2,
    });
    expect(summary.childSeatShortfalls).toEqual([]);
  });

  it('reports the kinds the car is short of', () => {
    const summary = summarise([jeanne, louis, mila, guillaume], {
      passengerIds: ['jeanne', 'louis', 'mila'],
      driverId: 'guillaume',
      vehicle: makeVehicle({ childSeats: ['booster', 'booster'] }),
    });

    expect(summary.childSeatShortfalls).toEqual([
      { kind: 'rearFacing', required: 1, available: 0, missing: 1 },
    ]);
    expect(hasCapacityWarning(summary)).toBe(true);
  });

  it('counts several children in one car separately', () => {
    const summary = summarise([louis, mila, guillaume], {
      passengerIds: ['louis', 'mila'],
      driverId: 'guillaume',
      vehicle: makeVehicle({ childSeats: ['booster'] }),
    });

    expect(summary.childSeatShortfalls).toEqual([
      { kind: 'booster', required: 2, available: 1, missing: 1 },
    ]);
  });

  it('counts a driver who needs a seat, when they are not a passenger', () => {
    // Contrived, but the tally must not depend on which side of the ride a
    // person sits: the seat has to be in the car either way.
    const summary = summarise([jeanne, guillaume], {
      passengerIds: ['guillaume'],
      driverId: 'jeanne',
      vehicle: makeVehicle({ childSeats: [] }),
    });

    expect(summary.requiredChildSeats.rearFacing).toBe(1);
  });

  it('ignores a seat kind it does not recognise', () => {
    // These guests come out of the shared document, where a peer or a newer
    // build can put anything. Unguarded, the tally indexed a fresh key with
    // `undefined + 1`, so the card rendered "NaN hoverboard" and the whole
    // tally for that car became unreadable.
    const alien = makePerson('alien', {
      childSeat: 'hoverboard' as unknown as ChildSeatKind,
    });

    const summary = summarise([alien, jeanne], {
      passengerIds: ['alien', 'jeanne'],
      vehicle: makeVehicle({ childSeats: ['rearFacing'] }),
    });

    expect(summary.requiredChildSeats).toEqual({
      rearFacing: 1,
      forwardFacing: 0,
      booster: 0,
    });
    expect(summary.childSeatShortfalls).toEqual([]);
  });

  it('raises no shortfall when no car is chosen', () => {
    const summary = summarise([jeanne], { passengerIds: ['jeanne'] });

    expect(summary.requiredChildSeats.rearFacing).toBe(1);
    expect(summary.childSeatShortfalls).toEqual([]);
    expect(hasCapacityWarning(summary)).toBe(false);
  });

  it('counts one seat per guest row, whatever their headcount', () => {
    // A headcount says how many bodies to count, never which of them is small.
    const family = makePerson('family', {
      headcount: 3,
      childSeat: 'booster' as ChildSeatKind,
    });

    const summary = summarise([family], {
      passengerIds: ['family'],
      vehicle: makeVehicle({ seatCount: 5, childSeats: ['booster'] }),
    });

    expect(summary.seatsUsed).toBe(3);
    expect(summary.requiredChildSeats.booster).toBe(1);
    expect(summary.childSeatShortfalls).toEqual([]);
  });
});
