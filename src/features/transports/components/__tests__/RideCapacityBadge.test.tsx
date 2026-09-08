/**
 * @fileoverview What the capacity chips must say, and what they must not.
 *
 * Every case here goes through the real `summariseRideCapacity` rather than a
 * hand-written summary object. Hand-writing `seatsUsed: 2` would prove the
 * badge can render a 2; running a headcount-2 guest through the resolver is
 * what proves the seam still counts people rather than guest rows — which is
 * the regression this badge exists to make visible.
 *
 * `t` is mocked to render `key(name=value, …)` so "the shortfall branch ran"
 * and "it was handed the rear-facing kind, one short" are two assertions
 * instead of one. The suite-wide mock in `src/test/setup.ts` drops the
 * interpolations, which would make every numeric assertion below vacuous.
 *
 * @module features/transports/components/__tests__/RideCapacityBadge.test
 */

import { describe, expect, it, vi } from 'vitest';

import { createHeadcountResolver } from '@/features/rooms/utils/capacity-utils';
import { summariseRideCapacity } from '@/features/transports/utils/ride-capacity';
import { resolveRides } from '@/features/transports/utils/ride-model';
import { hexColor, render, screen } from '@/test/utils';
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
import { RideCapacityBadge } from '../RideCapacityBadge';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('react-i18next', () => ({
  // Nothing in this tree renders `Trans` or touches `initReactI18next`, but a
  // file-level mock replaces the suite-wide one wholesale and Vitest throws on
  // an export the factory left out — so the surface is mirrored rather than
  // trimmed to what today's imports happen to reach.
  Trans: ({ children }: { readonly children?: unknown }) => children,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    /**
     * Renders `key(name=value, …)`, keeping `count` among the values.
     *
     * The shared mock collapses a counted call to the bare count, which would
     * turn "missing one rear-facing seat" into the string `"1"` and leave
     * nothing to assert.
     */
    t: (key: string, options?: Record<string, unknown>) => {
      if (options === undefined) return key;
      const params = Object.entries(options).filter(
        ([name]) => name !== 'defaultValue',
      );
      return params.length === 0
        ? key
        : `${key}(${params.map(([name, value]) => `${name}=${String(value)}`).join(', ')})`;
    },
  }),
}));

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_ID = 'trip-1' as TripId,
  RIDE: Ride = {
    id: 'r1' as RideId,
    tripId: TRIP_ID,
    direction: 'pickup',
    meetDatetime: '2026-07-15T15:02:00.000Z',
    location: 'Lyon Part-Dieu',
  };

/**
 * A guest row, which may stand for more than one body.
 *
 * @param id - Used as both the id and the display name
 * @param overrides - Headcount, child seat, …
 * @returns The guest
 */
function makePerson(id: string, overrides: Partial<Person> = {}): Person {
  return {
    id: id as PersonId,
    tripId: TRIP_ID,
    name: id,
    color: hexColor('#3b82f6'),
    ...overrides,
  };
}

/**
 * One passenger's leg, pointing at the single ride these cases measure.
 *
 * @param index - Distinguishes the ids
 * @param personId - Who is travelling
 * @returns The leg
 */
function makeTransport(index: number, personId: string): Transport {
  return {
    id: `t${index}` as TransportId,
    tripId: TRIP_ID,
    personId: personId as PersonId,
    type: 'arrival',
    datetime: RIDE.meetDatetime,
    location: RIDE.location,
    needsPickup: true,
    rideId: RIDE.id,
  };
}

/**
 * The car, when there is one.
 *
 * @param overrides - `seatCount` and `childSeats` are what capacity reads
 * @returns The vehicle
 */
function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 'v1' as VehicleId,
    tripId: TRIP_ID,
    name: 'Espace',
    ...overrides,
  };
}

/**
 * Renders the badge for one journey, built the way a call site must build it.
 *
 * The resolver is the real `createHeadcountResolver`, so a guest row standing
 * for a couple reaches the badge as two seats rather than one.
 *
 * @param persons - The trip's roster
 * @param options - Who rides, who drives, in what
 */
function renderBadge(
  persons: readonly Person[],
  options: {
    readonly passengerIds: readonly string[];
    readonly driverId?: string;
    readonly vehicle?: Vehicle;
  },
): void {
  const journeys = resolveRides({
    rides: [
      {
        ...RIDE,
        driverId: options.driverId as PersonId | undefined,
        vehicleId: options.vehicle?.id,
      },
    ],
    transports: options.passengerIds.map((personId, index) =>
      makeTransport(index, personId),
    ),
    vehicles: options.vehicle === undefined ? [] : [options.vehicle],
    persons,
  });

  const journey = journeys[0];
  expect(journey).toBeDefined();

  render(
    <RideCapacityBadge
      summary={summariseRideCapacity(journey!, createHeadcountResolver(persons))}
    />,
    { withProviders: false },
  );
}

/** The chip row while something is wrong — it escalates to `alert` only then. */
function alertRow(): HTMLElement | null {
  return screen.queryByRole('alert');
}

/** The chip row while nothing is wrong: still a live region, just a quiet one. */
function statusRow(): HTMLElement | null {
  return screen.queryByRole('status');
}

/**
 * Chips drawn in a status tone.
 *
 * The token is asserted rather than a `[class*="…"]` substring: `badgeVariants`
 * ships `aria-invalid:border-destructive` on *every* badge, so a substring
 * match for "destructive" is true of a perfectly healthy chip.
 *
 * @param token - `text-warning-on-surface` or `text-destructive-on-surface`
 * @returns The matching elements
 */
function chipsTinted(token: string): readonly Element[] {
  return [...document.querySelectorAll(`.${token}`)];
}

const WARNING_TINT = 'text-warning-on-surface',
  DANGER_TINT = 'text-destructive-on-surface';

// ============================================================================
// Tests
// ============================================================================

describe('RideCapacityBadge — seats', () => {
  it('gives a guest row standing for a couple two of the car seats', () => {
    // Two rows in the car, but "alice" is a couple: three seats, not two.
    const persons = [makePerson('alice', { headcount: 2 }), makePerson('tom')];

    renderBadge(persons, {
      passengerIds: ['alice'],
      driverId: 'tom',
      vehicle: makeVehicle({ seatCount: 5 }),
    });

    expect(
      screen.getByText('vehicles.seatsUsed(used=3, total=5)'),
    ).toBeInTheDocument();
    expect(alertRow()).toBeNull();
  });

  it('says the seats are unknown, and warns about nothing, for an unmeasured car', () => {
    // Five bodies in a car nobody has measured. Reading the missing seatCount
    // as zero would call this overloaded; it is merely unknown.
    const persons = [
      makePerson('alice', { headcount: 2 }),
      makePerson('bob', { headcount: 2 }),
      makePerson('tom'),
    ];

    renderBadge(persons, {
      passengerIds: ['alice', 'bob'],
      driverId: 'tom',
      vehicle: makeVehicle(),
    });

    expect(screen.getByText('vehicles.seatsUnknown')).toBeInTheDocument();
    expect(screen.queryByText(/vehicles.overCapacity/)).toBeNull();
    expect(alertRow()).toBeNull();
  });

  it('says the seats are unknown when no car is chosen at all', () => {
    const persons = [makePerson('alice'), makePerson('tom')];

    renderBadge(persons, { passengerIds: ['alice'], driverId: 'tom' });

    expect(screen.getByText('vehicles.seatsUnknown')).toBeInTheDocument();
    expect(alertRow()).toBeNull();
  });

  it('does not treat an exactly full car as a warning', () => {
    const persons = [
      makePerson('alice', { headcount: 2 }),
      makePerson('tom'),
      makePerson('guillaume'),
    ];

    renderBadge(persons, {
      passengerIds: ['alice', 'tom'],
      driverId: 'guillaume',
      vehicle: makeVehicle({ seatCount: 4 }),
    });

    // The nudge is there…
    expect(
      screen.getByText('vehicles.seatsUsed(used=4, total=4)'),
    ).toBeInTheDocument();
    expect(screen.getByText('vehicles.full')).toBeInTheDocument();
    // …and it is not dressed as a problem: no alert, and nothing amber or red.
    expect(alertRow()).toBeNull();
    expect(chipsTinted(WARNING_TINT)).toHaveLength(0);
    expect(chipsTinted(DANGER_TINT)).toHaveLength(0);
    // The live region is still there, so the form can announce a later change
    // rather than creating the region and its warning in the same commit.
    expect(statusRow()).not.toBeNull();
  });

  it('announces an overloaded car in words, and in red', () => {
    const persons = [
      makePerson('alice', { headcount: 2 }),
      makePerson('bob', { headcount: 2 }),
      makePerson('tom'),
    ];

    renderBadge(persons, {
      passengerIds: ['alice', 'bob'],
      driverId: 'tom',
      vehicle: makeVehicle({ seatCount: 4 }),
    });

    const row = alertRow();
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent('vehicles.overCapacity(used=5, total=4)');
    expect(chipsTinted(DANGER_TINT)).toHaveLength(1);
  });
});

describe('RideCapacityBadge — child seats', () => {
  it('names the kind the car is short of, and how many', () => {
    const persons = [
      makePerson('lou', { childSeat: 'rearFacing' }),
      makePerson('mia', { childSeat: 'rearFacing' }),
      makePerson('tom'),
    ];

    renderBadge(persons, {
      passengerIds: ['lou', 'mia'],
      driverId: 'tom',
      // One rear-facing seat in the car, two babies in the back.
      vehicle: makeVehicle({ seatCount: 5, childSeats: ['rearFacing'] }),
    });

    const row = alertRow();
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent(
      'childSeats.missing(count=1, kind=childSeats.rearFacing)',
    );
    // The seats themselves are fine, so the seat chip stays quiet.
    expect(
      screen.getByText('vehicles.seatsUsed(used=3, total=5)'),
    ).toBeInTheDocument();
  });

  it('lists a covered requirement without warning about it', () => {
    const persons = [makePerson('lou', { childSeat: 'booster' }), makePerson('tom')];

    renderBadge(persons, {
      passengerIds: ['lou'],
      driverId: 'tom',
      vehicle: makeVehicle({ seatCount: 5, childSeats: ['booster', 'booster'] }),
    });

    expect(
      screen.getByText('childSeats.required(count=1, kind=childSeats.booster)'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/childSeats.missing/)).toBeNull();
    expect(alertRow()).toBeNull();
  });

  it('warns per kind, so two shortfalls are two sentences', () => {
    const persons = [
      makePerson('lou', { childSeat: 'rearFacing' }),
      makePerson('mia', { childSeat: 'booster' }),
      makePerson('tom'),
    ];

    renderBadge(persons, {
      passengerIds: ['lou', 'mia'],
      driverId: 'tom',
      vehicle: makeVehicle({ seatCount: 5 }),
    });

    const row = alertRow();
    expect(row).toHaveTextContent(
      'childSeats.missing(count=1, kind=childSeats.rearFacing)',
    );
    expect(row).toHaveTextContent(
      'childSeats.missing(count=1, kind=childSeats.booster)',
    );
    // A kind nobody needs is not mentioned at all.
    expect(screen.queryByText(/childSeats.forwardFacing/)).toBeNull();
  });

  it('still lists what a ride needs when no car has been chosen yet', () => {
    // Nothing to compare against, so no shortfall — but the organiser can see
    // which seat the car they pick will have to carry.
    const persons = [makePerson('lou', { childSeat: 'booster' }), makePerson('tom')];

    renderBadge(persons, { passengerIds: ['lou'], driverId: 'tom' });

    expect(
      screen.getByText('childSeats.required(count=1, kind=childSeats.booster)'),
    ).toBeInTheDocument();
    expect(alertRow()).toBeNull();
  });

  it('counts a driver who is also a passenger once', () => {
    // Tom drives himself and his partner: two bodies on one leg, no third seat
    // for the driver.
    const persons = [makePerson('tom', { headcount: 2 })];

    renderBadge(persons, {
      passengerIds: ['tom'],
      driverId: 'tom',
      vehicle: makeVehicle({ seatCount: 4 }),
    });

    expect(
      screen.getByText('vehicles.seatsUsed(used=2, total=4)'),
    ).toBeInTheDocument();
  });
});
