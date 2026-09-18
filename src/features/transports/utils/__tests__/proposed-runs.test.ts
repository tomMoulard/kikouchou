/**
 * @fileoverview Tests for the car journeys the app proposes on its own.
 *
 * The point of the module is that nobody types a run: it reads the legs that
 * still need a lift and says "these travel together, and here is what the car
 * has to hold". So what is pinned here is the arithmetic a host would
 * otherwise do by hand — people, not guest rows, and the child seats those
 * people need — plus the two ways a proposal must not appear: for a leg that
 * already has a driver, and twice for the same car.
 *
 * Datetimes are built from a *local* wall clock, never a literal `…Z`, so no
 * assertion here changes meaning with the machine's timezone.
 *
 * @module features/transports/utils/__tests__/proposed-runs.test
 */

import { describe, expect, it } from 'vitest';

import { buildProposedRuns } from '@/features/transports/utils/proposed-runs';
import type {
  HexColor,
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

/** The stored instant of a local wall clock, in July 2026. */
function at(day: number, hours: number, minutes = 0): string {
  return new Date(2026, 6, day, hours, minutes, 0, 0).toISOString();
}

function guest(id: string, overrides: Partial<Person> = {}): Person {
  return {
    id: id as PersonId,
    tripId: TRIP_ID,
    name: id,
    color: '#3b82f6' as HexColor,
    ...overrides,
  };
}

function leg(id: string, overrides: Partial<Transport> = {}): Transport {
  return {
    id: id as TransportId,
    tripId: TRIP_ID,
    personId: 'alice' as PersonId,
    type: 'arrival',
    datetime: at(15, 17) as Transport['datetime'],
    location: 'Lyon Part-Dieu',
    needsPickup: true,
    ...overrides,
  };
}

function ride(id: string, overrides: Partial<Ride> = {}): Ride {
  return {
    id: id as RideId,
    tripId: TRIP_ID,
    direction: 'pickup',
    meetDatetime: at(15, 17) as Ride['meetDatetime'],
    location: 'Lyon Part-Dieu',
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('buildProposedRuns', () => {
  it('puts two legs at one station in the same run', () => {
    const runs = buildProposedRuns({
      legsNeedingLift: [
        leg('t1', { personId: 'alice' as PersonId }),
        leg('t2', { personId: 'bob' as PersonId, datetime: at(15, 17, 15) as Transport['datetime'] }),
      ],
      rides: [],
      persons: [guest('alice'), guest('bob')],
    });

    expect(runs).toHaveLength(1);
    expect(runs[0]?.legs.map((entry) => entry.id)).toEqual(['t1', 't2']);
    // The car has to be there for the first guest to land, not the last.
    expect(runs[0]?.meetDatetime).toBe(at(15, 17));
  });

  it('counts seats in people, not in guest rows', () => {
    // One row can stand for a couple, and the car has to hold both of them.
    const runs = buildProposedRuns({
      legsNeedingLift: [leg('t1', { personId: 'family' as PersonId })],
      rides: [],
      persons: [guest('family', { headcount: 4 })],
    });

    expect(runs[0]?.seatsNeeded).toBe(4);
  });

  it('lists one child seat per child who needs one', () => {
    const runs = buildProposedRuns({
      legsNeedingLift: [
        leg('t1', { personId: 'leo' as PersonId }),
        leg('t2', { personId: 'mia' as PersonId }),
      ],
      rides: [],
      persons: [
        guest('leo', { childSeat: 'booster' }),
        guest('mia', { childSeat: 'booster' }),
      ],
    });

    expect(runs[0]?.childSeatsNeeded).toEqual(['booster', 'booster']);
  });

  it('splits an arrival and a departure at the same station into two runs', () => {
    // A car goes one way. Grouping is by place and time, so the two land
    // together and would otherwise be proposed as one impossible journey.
    const runs = buildProposedRuns({
      legsNeedingLift: [
        leg('t1'),
        leg('t2', { type: 'departure', datetime: at(15, 17, 20) as Transport['datetime'] }),
      ],
      rides: [],
      persons: [guest('alice')],
    });

    expect(runs.map((entry) => entry.direction)).toEqual(['pickup', 'dropoff']);
  });

  it('proposes nothing for a leg whose car already has a driver', () => {
    // Covered legs never reach this module: it is handed the selection the
    // rest of the app calls "still needs a driver".
    const runs = buildProposedRuns({
      legsNeedingLift: [],
      rides: [ride('r1', { driverId: 'tom' as PersonId })],
      persons: [guest('alice'), guest('tom')],
    });

    expect(runs).toEqual([]);
  });

  it('offers to extend the car these legs already sit in', () => {
    // The proposal is offered again while nobody has volunteered, and the
    // second answer must fill the same car rather than build a rival one.
    const runs = buildProposedRuns({
      legsNeedingLift: [
        leg('t1', { rideId: 'r1' as RideId }),
        leg('t2', { personId: 'bob' as PersonId, datetime: at(15, 17, 10) as Transport['datetime'] }),
      ],
      rides: [ride('r1')],
      persons: [guest('alice'), guest('bob')],
    });

    expect(runs[0]?.existingRideId).toBe('r1');
  });

  it('gives each run a key of its own, stable across rebuilds', () => {
    const input = {
      legsNeedingLift: [
        leg('t1'),
        leg('t2', { location: 'Airport T2', datetime: at(15, 21) as Transport['datetime'] }),
      ],
      rides: [],
      persons: [guest('alice')],
    };

    const first = buildProposedRuns(input);
    const second = buildProposedRuns(input);

    expect(first.map((entry) => entry.key)).toEqual(second.map((entry) => entry.key));
    expect(new Set(first.map((entry) => entry.key)).size).toBe(first.length);
  });
});
