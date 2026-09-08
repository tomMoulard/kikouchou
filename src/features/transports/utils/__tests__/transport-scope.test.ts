/**
 * @fileoverview Guards the predicate both transport views filter by.
 *
 * The interesting cases are the ones where "mine" is wider or narrower than it
 * looks:
 *
 * - a leg in **no car at all** is mine when it is my own, which is the arrival
 *   a lone traveller most wants to see and the one no journey can reach;
 * - every leg of a car I drive is mine, including the passengers I have never
 *   met — collecting them is the whole job;
 * - a car I merely sit in brings the other passengers with it, because we are
 *   all waiting at the same kerb.
 *
 * @module features/transports/utils/__tests__/transport-scope.test
 */

import { describe, expect, it } from 'vitest';

import { resolveRides } from '../ride-model';
import {
  parseTransportScope,
  selectTransportsConcerning,
  TRANSPORT_SCOPE_PARAM,
} from '../transport-scope';
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

function makePerson(id: string): Person {
  return {
    id: id as PersonId,
    tripId: TRIP_ID,
    name: id,
    color: hexColor('#3b82f6'),
  };
}

function makeTransport(
  id: string,
  personId: string,
  overrides: Partial<Transport> = {},
): Transport {
  return {
    id: id as TransportId,
    tripId: TRIP_ID,
    personId: personId as PersonId,
    type: 'arrival',
    datetime: '2026-07-15T15:00:00.000Z',
    location: 'Lyon Part-Dieu',
    needsPickup: true,
    ...overrides,
  };
}

function makeRide(id: string, overrides: Partial<Ride> = {}): Ride {
  return {
    id: id as RideId,
    tripId: TRIP_ID,
    direction: 'pickup',
    meetDatetime: '2026-07-15T15:00:00.000Z',
    location: 'Lyon Part-Dieu',
    ...overrides,
  };
}

const TOM = makePerson('tom'),
  ALICE = makePerson('alice'),
  GUILLAUME = makePerson('guillaume');

/** Resolves journeys the way both pages do, from every leg on the trip. */
function journeysFor(transports: readonly Transport[], rides: readonly Ride[]) {
  return resolveRides({
    transports,
    rides,
    vehicles: [],
    persons: [TOM, ALICE, GUILLAUME],
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('parseTransportScope', () => {
  it('reads both scopes back', () => {
    expect(parseTransportScope('mine', 'all')).toBe('mine');
    expect(parseTransportScope('all', 'mine')).toBe('all');
  });

  it('falls back for an absent or unrecognised value', () => {
    // The parameter is user-editable and travels in shared links, so a typo
    // has to land somewhere sensible rather than blanking a page.
    expect(parseTransportScope(null, 'all')).toBe('all');
    expect(parseTransportScope('MINE', 'all')).toBe('all');
    expect(parseTransportScope('everyone', 'mine')).toBe('mine');
  });

  it('names the parameter the views agree on', () => {
    expect(TRANSPORT_SCOPE_PARAM).toBe('scope');
  });
});

describe('selectTransportsConcerning', () => {
  it('keeps my own leg when it is in no car at all', () => {
    const mine = makeTransport('t-mine', 'tom'),
      theirs = makeTransport('t-theirs', 'alice'),
      transports = [mine, theirs];

    const selected = selectTransportsConcerning(
      transports,
      journeysFor(transports, []),
      TOM.id,
    );

    expect(selected.map((transport) => transport.id)).toEqual(['t-mine']);
  });

  it('keeps every leg of a car I am driving, mine or not', () => {
    const ride = makeRide('r1', { driverId: TOM.id }),
      alice = makeTransport('t-alice', 'alice', { rideId: ride.id }),
      guillaume = makeTransport('t-guillaume', 'guillaume', { rideId: ride.id }),
      elsewhere = makeTransport('t-elsewhere', 'alice'),
      transports = [alice, guillaume, elsewhere];

    const selected = selectTransportsConcerning(
      transports,
      journeysFor(transports, [ride]),
      TOM.id,
    );

    // Tom owns no leg here — he is only driving — and both passengers are
    // still his business.
    expect(selected.map((transport) => transport.id)).toEqual([
      't-alice',
      't-guillaume',
    ]);
  });

  it('keeps the people sharing the car I am sitting in', () => {
    const ride = makeRide('r1', { driverId: GUILLAUME.id }),
      tom = makeTransport('t-tom', 'tom', { rideId: ride.id }),
      alice = makeTransport('t-alice', 'alice', { rideId: ride.id }),
      transports = [tom, alice];

    const selected = selectTransportsConcerning(
      transports,
      journeysFor(transports, [ride]),
      TOM.id,
    );

    expect(selected.map((transport) => transport.id)).toEqual(['t-tom', 't-alice']);
  });

  it('drops a car that has nothing to do with me', () => {
    const ride = makeRide('r1', { driverId: GUILLAUME.id }),
      alice = makeTransport('t-alice', 'alice', { rideId: ride.id }),
      mine = makeTransport('t-mine', 'tom'),
      transports = [alice, mine];

    const selected = selectTransportsConcerning(
      transports,
      journeysFor(transports, [ride]),
      TOM.id,
    );

    expect(selected.map((transport) => transport.id)).toEqual(['t-mine']);
  });

  it('follows a legacy driverId leg, which has no ride row to be found through', () => {
    // Nothing migrates a `driverId` into a `Ride`, so the old shape has to
    // reach the filter through `resolveRides` reading it as a one-passenger
    // journey — otherwise Tom stops seeing the person he agreed to collect.
    const alice = makeTransport('t-alice', 'alice', { driverId: TOM.id }),
      stranger = makeTransport('t-stranger', 'guillaume'),
      transports = [alice, stranger];

    const selected = selectTransportsConcerning(
      transports,
      journeysFor(transports, []),
      TOM.id,
    );

    expect(selected.map((transport) => transport.id)).toEqual(['t-alice']);
  });

  it('preserves the order it was given', () => {
    const ride = makeRide('r1', { driverId: TOM.id }),
      first = makeTransport('t-1', 'alice', { rideId: ride.id }),
      second = makeTransport('t-2', 'tom'),
      third = makeTransport('t-3', 'guillaume', { rideId: ride.id }),
      transports = [first, second, third];

    const selected = selectTransportsConcerning(
      transports,
      journeysFor(transports, [ride]),
      TOM.id,
    );

    expect(selected.map((transport) => transport.id)).toEqual(['t-1', 't-2', 't-3']);
  });
});
