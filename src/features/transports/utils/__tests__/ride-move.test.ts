/**
 * @fileoverview Guards the price tag on "move the whole car to Alice's new
 * time".
 *
 * The three cases that matter are all about who must *not* be counted: the leg
 * the move is for, a leg nobody can place in time, and — when the target itself
 * is unreadable — every leg, because there is no move to price.
 *
 * Fixture instants are built with `localInstant`, so a 17:00 car and a 19:00
 * train stay two hours apart at CI's UTC and in Kiritimati alike.
 *
 * @module features/transports/utils/__tests__/ride-move.test
 */

import { describe, expect, it } from 'vitest';

import { hexColor, localInstant } from '@/test/utils';
import { resolveRides } from '@/features/transports/utils/ride-model';
import { previewRideMove } from '@/features/transports/utils/ride-move';
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

const TRIP_ID = 'trip-1' as TripId,
  RIDE_ID = 'ride-1' as RideId;

function makePerson(id: string, name: string): Person {
  return {
    id: id as PersonId,
    tripId: TRIP_ID,
    name,
    color: hexColor('#3b82f6'),
  };
}

function makeTransport(id: string, personId: string, datetime: string): Transport {
  return {
    id: id as TransportId,
    tripId: TRIP_ID,
    personId: personId as PersonId,
    type: 'arrival',
    datetime,
    location: 'Lyon Part-Dieu',
    needsPickup: true,
    rideId: RIDE_ID,
  };
}

const RIDE: Ride = {
  id: RIDE_ID,
  tripId: TRIP_ID,
  direction: 'pickup',
  meetDatetime: localInstant('2026-04-11', '17:00'),
  location: 'Lyon Part-Dieu',
  driverId: 'guillaume' as PersonId,
};

const PERSONS: Person[] = [
  makePerson('alice', 'Alice'),
  makePerson('tom', 'Tom'),
  makePerson('aurelia', 'Aurélia'),
  makePerson('guillaume', 'Guillaume'),
];

const ALICE_LATE = makeTransport('t-alice', 'alice', localInstant('2026-04-11', '19:00')),
  TOM = makeTransport('t-tom', 'tom', localInstant('2026-04-11', '17:00')),
  AURELIA = makeTransport('t-aurelia', 'aurelia', localInstant('2026-04-11', '17:05')),
  ALICE_NUDGED = makeTransport(
    't-alice',
    'alice',
    localInstant('2026-04-11', '17:45'),
  );

/**
 * Resolves the fixtures into the single journey they describe.
 *
 * @param transports - The legs sharing the car
 * @returns The resolved journey
 */
function journeyFrom(transports: readonly Transport[]) {
  const [journey] = resolveRides({
    transports,
    rides: [RIDE],
    vehicles: [],
    persons: PERSONS,
  });

  if (journey === undefined) {
    throw new Error('The fixture resolved to no journey at all');
  }

  return journey;
}

// ============================================================================
// Tests
// ============================================================================

describe('previewRideMove', () => {
  it('names the legs that would fall outside the window, in ride order', () => {
    const preview = previewRideMove(
      journeyFrom([ALICE_LATE, TOM, AURELIA]),
      ALICE_LATE.datetime,
    );

    expect(preview?.targetDatetime).toBe(ALICE_LATE.datetime);
    expect(preview?.displaced.map((leg) => leg.person?.name)).toEqual([
      'Tom',
      'Aurélia',
    ]);
  });

  it('never counts the leg the move is for', () => {
    const preview = previewRideMove(journeyFrom([ALICE_LATE]), ALICE_LATE.datetime);

    expect(preview?.displaced).toHaveLength(0);
  });

  it('never counts a leg it cannot place in time', () => {
    const unreadable = makeTransport('t-tom', 'tom', 'not-a-datetime'),
      preview = previewRideMove(
        journeyFrom([ALICE_LATE, unreadable]),
        ALICE_LATE.datetime,
      );

    // We cannot prove Tom's leg does not fit the new time, so it must not be
    // used as an argument against the move either.
    expect(preview?.displaced).toHaveLength(0);
  });

  it('counts nobody when the move keeps every leg inside the window', () => {
    const preview = previewRideMove(
      journeyFrom([ALICE_NUDGED, TOM, AURELIA]),
      ALICE_NUDGED.datetime,
    );

    expect(preview?.displaced).toHaveLength(0);
  });

  it('refuses a target instant it cannot read', () => {
    expect(
      previewRideMove(journeyFrom([ALICE_LATE, TOM]), 'not-a-datetime'),
    ).toBeNull();
  });
});
