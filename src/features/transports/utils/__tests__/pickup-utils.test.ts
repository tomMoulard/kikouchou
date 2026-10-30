/**
 * @fileoverview Tests for the transport timing, selection and grouping helpers.
 *
 * Covers `toTransportInstant` / `isTransportUpcoming` (the one comparison every
 * transport view uses), `selectPickupsNeedingDriver` (the one answer to "how
 * many rides still need a driver") and `groupPickupsByProximity`, which groups
 * an already-selected list.
 *
 * @module features/transports/utils/__tests__/pickup-utils.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  groupPickupsByProximity,
  isTransportUpcoming,
  selectPickupsNeedingDriver,
  sortTransportsByInstant,
  toTransportInstant,
} from '../pickup-utils';
import type { PersonId, Ride, RideId, Transport, TransportId, TripId } from '@/types';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Creates a mock transport with sensible defaults for testing.
 */
function makeTransport(overrides: Partial<Transport> = {}): Transport {
  return {
    id: `t-${Math.random().toString(36).slice(2, 8)}` as TransportId,
    tripId: 'trip-1' as TripId,
    personId: 'person-1' as PersonId,
    type: 'arrival',
    datetime: new Date(Date.now() + 3600_000).toISOString(), // 1 hour from now
    location: 'Gare de Vannes',
    needsPickup: true,
    ...overrides,
  };
}

/** A ride to hand to {@link selectPickupsNeedingDriver}. */
function makeRide(overrides: Partial<Ride> = {}): Ride {
  return {
    id: `r-${Math.random().toString(36).slice(2, 8)}` as RideId,
    tripId: 'trip-1' as TripId,
    direction: 'pickup',
    meetDatetime: new Date(Date.now() + 3600_000).toISOString(),
    location: 'Gare de Vannes',
    ...overrides,
  };
}

// ============================================================================
// Timing
// ============================================================================

describe('toTransportInstant', () => {
  it('resolves a UTC datetime to its epoch instant', () => {
    expect(toTransportInstant('2026-07-15T14:00:00.000Z')).toBe(
      Date.UTC(2026, 6, 15, 14, 0, 0),
    );
  });

  it('honours an explicit UTC offset', () => {
    expect(toTransportInstant('2026-07-15T14:00:00+02:00')).toBe(
      Date.UTC(2026, 6, 15, 12, 0, 0),
    );
  });

  it('returns null for a datetime it cannot parse', () => {
    expect(toTransportInstant('not-a-date')).toBeNull();
    expect(toTransportInstant('')).toBeNull();
    expect(toTransportInstant(undefined)).toBeNull();
  });
});

describe('isTransportUpcoming', () => {
  it('compares instants, not strings', () => {
    // Same wall-clock digits, different offsets: `+02:00` happens FIRST, but
    // sorts LAST as a string. The old lexicographic compare called this one
    // upcoming when it was already an hour in the past.
    const nowMs = Date.UTC(2026, 6, 15, 12, 30, 0);

    expect(isTransportUpcoming('2026-07-15T14:00:00+02:00', nowMs)).toBe(false);
    expect(isTransportUpcoming('2026-07-15T14:00:00.000Z', nowMs)).toBe(true);
  });

  it('treats a transport at exactly the reference instant as upcoming', () => {
    const nowMs = Date.UTC(2026, 6, 15, 14, 0, 0);
    expect(isTransportUpcoming('2026-07-15T14:00:00.000Z', nowMs)).toBe(true);
  });

  it('never reports an unparseable datetime as upcoming', () => {
    expect(isTransportUpcoming('not-a-date', 0)).toBe(false);
    expect(isTransportUpcoming(undefined, 0)).toBe(false);
  });
});

describe('sortTransportsByInstant', () => {
  it('orders mixed-offset datetimes chronologically', () => {
    const later = makeTransport({
      id: 't-later' as TransportId,
      datetime: '2026-07-15T13:00:00.000Z',
    });
    const earlier = makeTransport({
      id: 't-earlier' as TransportId,
      datetime: '2026-07-15T14:00:00+02:00', // 12:00Z
    });

    // String order would put `t-later` first; instant order must not.
    expect(sortTransportsByInstant([later, earlier]).map((t) => t.id)).toEqual([
      't-earlier',
      't-later',
    ]);
  });

  it('puts a datetime it cannot parse at the end, not the start', () => {
    const ordered = sortTransportsByInstant([
      makeTransport({ id: 't-broken' as TransportId, datetime: 'not-a-date' }),
      makeTransport({ id: 't-later' as TransportId, datetime: '2026-07-15T15:00:00.000Z' }),
      makeTransport({ id: 't-earlier' as TransportId, datetime: '2026-07-15T14:00:00.000Z' }),
    ]);

    expect(ordered.map((t) => t.id)).toEqual(['t-earlier', 't-later', 't-broken']);
  });

  it('does not mutate its input', () => {
    const input = [
      makeTransport({ id: 't-2' as TransportId, datetime: '2026-07-15T15:00:00.000Z' }),
      makeTransport({ id: 't-1' as TransportId, datetime: '2026-07-15T14:00:00.000Z' }),
    ];
    sortTransportsByInstant(input);
    expect(input.map((t) => t.id)).toEqual(['t-2', 't-1']);
  });
});

// ============================================================================
// Selection
// ============================================================================

describe('selectPickupsNeedingDriver', () => {
  it('returns nothing for an empty base set', () => {
    expect(selectPickupsNeedingDriver([], [])).toEqual([]);
  });

  it('excludes transports that do not need a pickup', () => {
    expect(
      selectPickupsNeedingDriver([makeTransport({ needsPickup: false })], []),
    ).toEqual([]);
  });

  it('excludes pickups that already have a driver', () => {
    expect(
      selectPickupsNeedingDriver(
        [makeTransport({ needsPickup: true, driverId: 'driver-1' as PersonId })],
        [],
      ),
    ).toEqual([]);
  });

  it('excludes a leg sitting in a ride somebody drives', () => {
    // The leg itself carries no `driverId` — Guillaume volunteered on the ride,
    // not on each passenger's record — so a ride-blind selection would list
    // three people as still needing a lift.
    expect(
      selectPickupsNeedingDriver(
        [makeTransport({ needsPickup: true, rideId: 'r1' as RideId })],
        [makeRide({ id: 'r1' as RideId, driverId: 'guillaume' as PersonId })],
      ),
    ).toEqual([]);
  });

  it('still lists a leg in a ride nobody has volunteered for', () => {
    // Being put in a car nobody is driving is precisely what this list is for.
    expect(
      selectPickupsNeedingDriver(
        [makeTransport({ id: 't-9' as TransportId, needsPickup: true, rideId: 'r1' as RideId })],
        [makeRide({ id: 'r1' as RideId })],
      ).map((transport) => transport.id),
    ).toEqual(['t-9']);
  });

  it('still lists a leg whose ride this device does not hold', () => {
    expect(
      selectPickupsNeedingDriver(
        [makeTransport({ id: 't-9' as TransportId, needsPickup: true, rideId: 'gone' as RideId })],
        [],
      ),
    ).toHaveLength(1);
  });

  it('treats a blank driver as nobody driving', () => {
    // What a form whose select was cleared and a peer that serialised a blank
    // both produce. Read as a driver, the leg drops out of the one list whose
    // job is to surface people who still need a lift.
    expect(
      selectPickupsNeedingDriver(
        [
          makeTransport({
            id: 't-blank' as TransportId,
            needsPickup: true,
            driverId: '' as PersonId,
          }),
        ],
        [],
      ).map((transport) => transport.id),
    ).toEqual(['t-blank']);
  });

  it('does not treat a ride with a blank driver as driven', () => {
    expect(
      selectPickupsNeedingDriver(
        [
          makeTransport({
            id: 't-r' as TransportId,
            needsPickup: true,
            rideId: 'r1' as RideId,
          }),
        ],
        [makeRide({ id: 'r1' as RideId, driverId: '' as PersonId })],
      ),
    ).toHaveLength(1);
  });

  it('excludes pickups whose datetime cannot be parsed', () => {
    expect(
      selectPickupsNeedingDriver([makeTransport({ datetime: 'not-a-date' })], []),
    ).toEqual([]);
  });

  it('does NOT re-filter by time: the base set already decided that', () => {
    // A pickup a few minutes in the past that the context still lists as
    // upcoming (its reference instant only moves once a minute) must stay
    // visible until the next tick rather than vanish from one view only.
    const justPast = makeTransport({
      id: 't-just-past' as TransportId,
      datetime: new Date(Date.now() - 5 * 60_000).toISOString(),
    });

    expect(selectPickupsNeedingDriver([justPast], []).map((t) => t.id)).toEqual([
      't-just-past',
    ]);
  });

  it('orders the selection chronologically by instant', () => {
    const pickups = [
      makeTransport({ id: 't-late' as TransportId, datetime: '2026-07-15T18:00:00.000Z' }),
      makeTransport({ id: 't-early' as TransportId, datetime: '2026-07-15T14:00:00.000Z' }),
    ];

    expect(selectPickupsNeedingDriver(pickups, []).map((t) => t.id)).toEqual([
      't-early',
      't-late',
    ]);
  });
});

// ============================================================================
// Grouping
// ============================================================================

describe('groupPickupsByProximity', () => {
  beforeEach(() => {
    // Fix "now" to a known time so the fixtures below read unambiguously.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // Empty cases
  // --------------------------------------------------------------------------

  it('returns empty array when no pickups provided', () => {
    expect(groupPickupsByProximity([])).toEqual([]);
  });

  it('skips a pickup whose datetime cannot be placed on a timeline', () => {
    const pickups = [makeTransport({ datetime: 'not-a-date' })];
    expect(groupPickupsByProximity(pickups)).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // Total over its input
  // --------------------------------------------------------------------------

  /**
   * The alert panel counts the selection and renders the groups. If grouping
   * ever dropped a selected pickup, the header badge would promise a card that
   * is not on screen.
   */
  it('places every selected pickup in exactly one group', () => {
    const pickups = selectPickupsNeedingDriver(
      [
        makeTransport({ id: 't-1' as TransportId, datetime: '2026-07-15T14:00:00.000Z', location: 'Gare de Vannes' }),
        makeTransport({ id: 't-2' as TransportId, datetime: '2026-07-15T14:30:00.000Z', location: 'Gare de Vannes' }),
        makeTransport({ id: 't-3' as TransportId, datetime: '2026-07-15T18:00:00.000Z', location: 'Aeroport de Nantes' }),
        makeTransport({ id: 't-4' as TransportId, datetime: '2026-07-14T09:00:00.000Z', location: 'Gare de Vannes' }),
      ],
      [],
    );

    const groups = groupPickupsByProximity(pickups, 60);
    const grouped = groups.flatMap((g) => g.pickups.map((p) => p.id));

    expect(grouped).toHaveLength(pickups.length);
    expect(new Set(grouped).size).toBe(pickups.length);
  });

  // --------------------------------------------------------------------------
  // Single pickup (standalone)
  // --------------------------------------------------------------------------

  it('returns a single group for one unassigned pickup', () => {
    const transport = makeTransport({
      datetime: '2026-07-15T14:00:00.000Z',
      location: 'Gare de Vannes',
    });
    const result = groupPickupsByProximity([transport]);

    expect(result).toHaveLength(1);
    expect(result[0]!.pickups).toHaveLength(1);
    expect(result[0]!.displayStation).toBe('Gare de Vannes');
    expect(result[0]!.station).toBe('gare de vannes');
  });

  /**
   * `location` is required by the `Transport` type, but a record arriving over
   * Yjs from a peer is not type-checked. One with no location used to throw
   * `Cannot read properties of undefined (reading 'trim')`, which the error
   * boundary turned into "An error occurred / Failed to load" for the entire
   * transports page rather than for the one bad row.
   */
  it('tolerates a pickup whose location is missing', () => {
    const transport = makeTransport({ datetime: '2026-07-15T14:00:00.000Z' });
    delete (transport as { location?: string }).location;

    const result = groupPickupsByProximity([transport]);

    expect(result).toHaveLength(1);
    expect(result[0]!.pickups).toHaveLength(1);
    expect(result[0]!.displayStation).toBe('');
    expect(result[0]!.station).toBe('');
  });

  // --------------------------------------------------------------------------
  // Grouping logic
  // --------------------------------------------------------------------------

  it('groups pickups at the same station within time window', () => {
    const pickups = [
      makeTransport({
        id: 't-1' as TransportId,
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Gare de Vannes',
        personId: 'p-1' as PersonId,
      }),
      makeTransport({
        id: 't-2' as TransportId,
        datetime: '2026-07-15T14:30:00.000Z',
        location: 'Gare de Vannes',
        personId: 'p-2' as PersonId,
      }),
    ];
    const result = groupPickupsByProximity(pickups, 60);

    expect(result).toHaveLength(1);
    expect(result[0]!.pickups).toHaveLength(2);
  });

  it('groups pickups written with different UTC offsets', () => {
    const pickups = [
      makeTransport({
        id: 't-utc' as TransportId,
        datetime: '2026-07-15T12:15:00.000Z',
        location: 'Gare de Vannes',
      }),
      makeTransport({
        id: 't-offset' as TransportId,
        datetime: '2026-07-15T14:00:00+02:00', // 12:00Z — 15 minutes earlier
        location: 'Gare de Vannes',
      }),
    ];
    const result = groupPickupsByProximity(pickups, 60);

    expect(result).toHaveLength(1);
    expect(result[0]!.pickups.map((p) => p.id)).toEqual(['t-offset', 't-utc']);
  });

  it('does NOT group pickups at different stations', () => {
    const pickups = [
      makeTransport({
        id: 't-1' as TransportId,
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Gare de Vannes',
      }),
      makeTransport({
        id: 't-2' as TransportId,
        datetime: '2026-07-15T14:10:00.000Z',
        location: 'Aeroport de Nantes',
      }),
    ];
    const result = groupPickupsByProximity(pickups, 60);

    expect(result).toHaveLength(2);
    expect(result[0]!.pickups).toHaveLength(1);
    expect(result[1]!.pickups).toHaveLength(1);
  });

  it('does NOT group pickups outside time window', () => {
    const pickups = [
      makeTransport({
        id: 't-1' as TransportId,
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Gare de Vannes',
      }),
      makeTransport({
        id: 't-2' as TransportId,
        datetime: '2026-07-15T16:00:00.000Z', // 2 hours later
        location: 'Gare de Vannes',
      }),
    ];
    const result = groupPickupsByProximity(pickups, 60);

    expect(result).toHaveLength(2);
  });

  it('uses case-insensitive station matching', () => {
    const pickups = [
      makeTransport({
        id: 't-1' as TransportId,
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Gare de Vannes',
      }),
      makeTransport({
        id: 't-2' as TransportId,
        datetime: '2026-07-15T14:20:00.000Z',
        location: 'gare de vannes',
      }),
    ];
    const result = groupPickupsByProximity(pickups, 60);

    expect(result).toHaveLength(1);
    expect(result[0]!.pickups).toHaveLength(2);
  });

  it('trims whitespace for station matching', () => {
    const pickups = [
      makeTransport({
        id: 't-1' as TransportId,
        datetime: '2026-07-15T14:00:00.000Z',
        location: ' Gare de Vannes ',
      }),
      makeTransport({
        id: 't-2' as TransportId,
        datetime: '2026-07-15T14:20:00.000Z',
        location: 'Gare de Vannes',
      }),
    ];
    const result = groupPickupsByProximity(pickups, 60);

    expect(result).toHaveLength(1);
    expect(result[0]!.pickups).toHaveLength(2);
  });

  // --------------------------------------------------------------------------
  // Sorting
  // --------------------------------------------------------------------------

  it('sorts groups by earliest pickup datetime', () => {
    const pickups = [
      makeTransport({
        id: 't-late' as TransportId,
        datetime: '2026-07-15T18:00:00.000Z',
        location: 'Aeroport de Nantes',
      }),
      makeTransport({
        id: 't-early' as TransportId,
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Gare de Vannes',
      }),
    ];
    const result = groupPickupsByProximity(pickups, 60);

    expect(result).toHaveLength(2);
    expect(result[0]!.displayStation).toBe('Gare de Vannes');
    expect(result[1]!.displayStation).toBe('Aeroport de Nantes');
  });

  it('sorts pickups within a group by datetime', () => {
    const pickups = [
      makeTransport({
        id: 't-2' as TransportId,
        datetime: '2026-07-15T14:30:00.000Z',
        location: 'Gare de Vannes',
      }),
      makeTransport({
        id: 't-1' as TransportId,
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Gare de Vannes',
      }),
    ];
    const result = groupPickupsByProximity(pickups, 60);

    expect(result).toHaveLength(1);
    expect(result[0]!.pickups[0]!.id).toBe('t-1');
    expect(result[0]!.pickups[1]!.id).toBe('t-2');
  });

  // --------------------------------------------------------------------------
  // Time window metadata
  // --------------------------------------------------------------------------

  it('sets correct startTime and endTime for groups', () => {
    const pickups = [
      makeTransport({
        id: 't-1' as TransportId,
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Gare de Vannes',
      }),
      makeTransport({
        id: 't-2' as TransportId,
        datetime: '2026-07-15T14:45:00.000Z',
        location: 'Gare de Vannes',
      }),
    ];
    const result = groupPickupsByProximity(pickups, 60);

    expect(result).toHaveLength(1);
    expect(result[0]!.startTime).toBe('2026-07-15T14:00:00.000Z');
    expect(result[0]!.endTime).toBe('2026-07-15T14:45:00.000Z');
  });

  it('startTime equals endTime for single-pickup groups', () => {
    const pickups = [
      makeTransport({
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Gare de Vannes',
      }),
    ];
    const result = groupPickupsByProximity(pickups, 60);

    expect(result[0]!.startTime).toBe(result[0]!.endTime);
  });

  // --------------------------------------------------------------------------
  // Configurable time window
  // --------------------------------------------------------------------------

  it('respects custom time window', () => {
    const pickups = [
      makeTransport({
        id: 't-1' as TransportId,
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Gare de Vannes',
      }),
      makeTransport({
        id: 't-2' as TransportId,
        datetime: '2026-07-15T14:20:00.000Z',
        location: 'Gare de Vannes',
      }),
    ];

    // 30 minute window - should group
    expect(groupPickupsByProximity(pickups, 30)).toHaveLength(1);

    // 10 minute window - should NOT group
    expect(groupPickupsByProximity(pickups, 10)).toHaveLength(2);
  });

  // --------------------------------------------------------------------------
  // Complex scenarios
  // --------------------------------------------------------------------------

  it('handles multiple groups at different stations with overlapping times', () => {
    const pickups = [
      makeTransport({
        id: 't-v1' as TransportId,
        datetime: '2026-07-15T14:00:00.000Z',
        location: 'Gare de Vannes',
      }),
      makeTransport({
        id: 't-n1' as TransportId,
        datetime: '2026-07-15T14:10:00.000Z',
        location: 'Aeroport de Nantes',
      }),
      makeTransport({
        id: 't-v2' as TransportId,
        datetime: '2026-07-15T14:30:00.000Z',
        location: 'Gare de Vannes',
      }),
      makeTransport({
        id: 't-n2' as TransportId,
        datetime: '2026-07-15T14:40:00.000Z',
        location: 'Aeroport de Nantes',
      }),
    ];
    const result = groupPickupsByProximity(pickups, 60);

    expect(result).toHaveLength(2);
    // First group: Vannes (earliest at 14:00)
    expect(result[0]!.displayStation).toBe('Gare de Vannes');
    expect(result[0]!.pickups).toHaveLength(2);
    // Second group: Nantes (earliest at 14:10)
    expect(result[1]!.displayStation).toBe('Aeroport de Nantes');
    expect(result[1]!.pickups).toHaveLength(2);
  });
});
