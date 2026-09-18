/**
 * @fileoverview Tests for reading a proximity group as the car it implies.
 *
 * The case worth pinning is the mixed group: legs are grouped by station and
 * time, not by direction, so an arrival and a departure half an hour apart at
 * the same station land together. A `Ride` has one direction, so the group is
 * two cars — and the failure this file exists to prevent is the tidy-looking
 * one where the second direction is silently dropped and those guests believe
 * a car was arranged for them.
 *
 * Datetimes are built from a *local* wall clock, never a literal `…Z`, so no
 * assertion here changes meaning with the machine's timezone.
 *
 * @module features/transports/utils/__tests__/ride-suggestion.test
 */

import { describe, expect, it } from 'vitest';

import type { PickupGroup } from '@/features/transports/utils/pickup-utils';
import {
  type RideSuggestion,
  rideDirectionForLeg,
  selectJoinableRides,
  suggestRidesForGroup,
} from '@/features/transports/utils/ride-suggestion';
import type {
  PersonId,
  Ride,
  RideDirection,
  RideId,
  Transport,
  TransportId,
  TransportType,
  TripId,
} from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

/**
 * The stored instant of a local wall clock.
 *
 * @param day - Day of July 2026
 * @param hours - Local hour
 * @param minutes - Local minute
 * @returns The ISO instant
 */
function at(day: number, hours: number, minutes = 0): string {
  return new Date(2026, 6, day, hours, minutes, 0, 0).toISOString();
}

/**
 * A leg, with only the fields this module reads spelled out.
 *
 * @param id - Transport id
 * @param overrides - Fields to set on top of an arrival at Station A
 * @returns The leg
 */
function leg(id: string, overrides: Partial<Transport> = {}): Transport {
  return {
    id: id as TransportId,
    tripId: 'trip-1' as TripId,
    personId: `person-${id}` as PersonId,
    type: 'arrival' as TransportType,
    datetime: at(15, 14),
    location: 'Station A',
    needsPickup: true,
    ...overrides,
  };
}

/**
 * A car, with only the fields this module reads spelled out.
 *
 * @param id - Ride id
 * @param overrides - Fields to set on top of a pick-up at Station A
 * @returns The ride
 */
function ride(id: string, overrides: Partial<Ride> = {}): Ride {
  return {
    id: id as RideId,
    tripId: 'trip-1' as TripId,
    direction: 'pickup' as RideDirection,
    meetDatetime: at(15, 14),
    location: 'Station A',
    ...overrides,
  };
}

/**
 * A proximity group around the legs it holds.
 *
 * @param pickups - The grouped legs, earliest first
 * @returns The group
 */
function group(pickups: readonly Transport[]): PickupGroup {
  return {
    station: 'station a',
    displayStation: 'Station A',
    startTime: at(15, 14),
    endTime: at(15, 15),
    pickups,
  };
}

/** The rides this device holds, unless a case says otherwise. */
const KNOWN_RIDE_IDS: ReadonlySet<string> = new Set(['r1', 'r2']);

/**
 * Reads a group of legs as the cars it implies.
 *
 * @param pickups - The grouped legs
 * @param knownRideIds - The rides this device holds
 * @returns The suggestions
 */
function suggest(
  pickups: readonly Transport[],
  knownRideIds: ReadonlySet<string> = KNOWN_RIDE_IDS,
): readonly RideSuggestion[] {
  return suggestRidesForGroup(group(pickups), knownRideIds);
}

// ============================================================================
// Tests
// ============================================================================

describe('rideDirectionForLeg', () => {
  it('fetches an arrival and takes a departure away', () => {
    expect(rideDirectionForLeg(leg('t1', { type: 'arrival' }))).toBe('pickup');
    expect(rideDirectionForLeg(leg('t2', { type: 'departure' }))).toBe('dropoff');
  });
});

describe('suggestRidesForGroup', () => {
  it('reads a single-direction group as one car meeting the earliest leg', () => {
    const suggestions = suggest([
      leg('t1', { datetime: at(15, 14, 30) }),
      leg('t2', { datetime: at(15, 14) }),
      leg('t3', { datetime: at(15, 15) }),
    ]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      direction: 'pickup',
      location: 'Station A',
      meetDatetime: at(15, 14),
    });
    // Ordered earliest first, so the car meets the first guest to land
    expect(suggestions[0]?.legs.map((each) => each.id)).toEqual(['t2', 't1', 't3']);
  });

  it('reads a departure-only group as a drop-off', () => {
    const suggestions = suggest([
      leg('t1', { type: 'departure' }),
      leg('t2', { type: 'departure' }),
    ]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.direction).toBe('dropoff');
  });

  it('splits a mixed group into one car per direction, keeping every leg', () => {
    const suggestions = suggest([
      leg('t1', { type: 'arrival', datetime: at(15, 14) }),
      leg('t2', { type: 'departure', datetime: at(15, 14, 30) }),
      leg('t3', { type: 'arrival', datetime: at(15, 14, 15) }),
    ]);

    expect(suggestions.map((each) => each.direction)).toEqual(['pickup', 'dropoff']);
    expect(suggestions[0]?.legs.map((each) => each.id)).toEqual(['t1', 't3']);
    expect(suggestions[0]?.meetDatetime).toBe(at(15, 14));
    expect(suggestions[1]?.legs.map((each) => each.id)).toEqual(['t2']);
    expect(suggestions[1]?.meetDatetime).toBe(at(15, 14, 30));
  });

  it('drops a leg nobody can place in time rather than meeting at an unreadable hour', () => {
    const suggestions = suggest([
      leg('t1', { datetime: 'not-a-date' }),
      leg('t2', { datetime: at(15, 14) }),
    ]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.legs.map((each) => each.id)).toEqual(['t2']);
    expect(suggestions[0]?.meetDatetime).toBe(at(15, 14));
  });

  it('suggests nothing when no leg can be placed in time', () => {
    expect(suggest([leg('t1', { datetime: '' })])).toEqual([]);
  });

  it('suggests nothing for an empty group', () => {
    expect(suggest([])).toEqual([]);
  });

  it('reports a group whose car already exists as arranged', () => {
    const suggestions = suggest([
      leg('t1', { rideId: 'r1' as RideId }),
      leg('t2', { rideId: 'r1' as RideId, datetime: at(15, 14, 20) }),
    ]);

    expect(suggestions[0]).toMatchObject({ existingRideId: 'r1', isArranged: true });
  });

  it('names the half-filled car so the rest of the group joins it', () => {
    const suggestions = suggest([
      leg('t1', { rideId: 'r1' as RideId }),
      leg('t2', { datetime: at(15, 14, 20) }),
    ]);

    // Building again must extend that car, not strand its passenger in an
    // empty one
    expect(suggestions[0]).toMatchObject({ existingRideId: 'r1', isArranged: false });
  });

  it('offers a fresh car when the legs are split across two', () => {
    const suggestions = suggest([
      leg('t1', { rideId: 'r1' as RideId }),
      leg('t2', { rideId: 'r2' as RideId, datetime: at(15, 14, 20) }),
    ]);

    expect(suggestions[0]).toMatchObject({
      existingRideId: undefined,
      isArranged: false,
    });
  });

  it('ignores a car this device does not hold, so the group can still get one', () => {
    // Legs travel on the QR-changeset path and rides do not yet, so an invitee
    // holds legs pointing at cars they have never seen. Reading one as
    // membership would aim every write at a ride that is not there — and, when
    // the whole group carried it, hide the button on the grounds that the car
    // was already arranged.
    const suggestions = suggest(
      [
        leg('t1', { rideId: 'r-not-here' as RideId }),
        leg('t2', { rideId: 'r-not-here' as RideId, datetime: at(15, 14, 20) }),
      ],
      new Set(['r1']),
    );

    expect(suggestions[0]).toMatchObject({
      existingRideId: undefined,
      isArranged: false,
    });
  });
});

describe('selectJoinableRides', () => {
  const nowMs = new Date(at(15, 12)).getTime();

  it('keeps the cars going the same way to the same place, earliest first', () => {
    const candidates = selectJoinableRides(
      [
        ride('r-late', { meetDatetime: at(15, 16) }),
        ride('r-early', { meetDatetime: at(15, 14) }),
      ],
      leg('t1'),
      nowMs,
    );

    expect(candidates.map((each) => each.id)).toEqual(['r-early', 'r-late']);
  });

  it('matches a station name whatever its spacing and case', () => {
    const candidates = selectJoinableRides(
      [ride('r1', { location: '  station a ' })],
      leg('t1', { location: 'Station A' }),
      nowMs,
    );

    expect(candidates.map((each) => each.id)).toEqual(['r1']);
  });

  it('leaves out the cars that cannot take this leg', () => {
    const candidates = selectJoinableRides(
      [
        ride('r-other-direction', { direction: 'dropoff' }),
        ride('r-other-place', { location: 'Station B' }),
        ride('r-gone', { meetDatetime: at(15, 10) }),
        ride('r-unreadable', { meetDatetime: 'not-a-date' }),
      ],
      leg('t1'),
      nowMs,
    );

    expect(candidates).toEqual([]);
  });

  it('never offers the car the leg is already in', () => {
    const candidates = selectJoinableRides(
      [ride('r1'), ride('r2')],
      leg('t1', { rideId: 'r1' as RideId }),
      nowMs,
    );

    expect(candidates.map((each) => each.id)).toEqual(['r2']);
  });

  it('keeps a car meeting exactly now — it has not left yet', () => {
    const candidates = selectJoinableRides(
      [ride('r1', { meetDatetime: at(15, 12) })],
      leg('t1'),
      nowMs,
    );

    expect(candidates.map((each) => each.id)).toEqual(['r1']);
  });
});
