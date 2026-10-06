/**
 * @fileoverview Guards what a driver's calendar actually receives.
 *
 * Every fixture is placed as an offset from one frozen UTC instant, so nothing
 * here encodes the machine's timezone.
 *
 * Four claims are load-bearing:
 *
 * - the block covers the **drive**, from the leave time to the rendez-vous,
 *   because that is the time that has to be free;
 * - a run that has already met, or that nobody can place on the clock, never
 *   reaches the file;
 * - the identity of an event is the ride, so a second import updates the run
 *   rather than duplicating it;
 * - every run carries an alarm, which is the entire reason the file exists.
 *
 * @module features/transports/utils/__tests__/ride-ics.test
 */

import { describe, expect, it } from 'vitest';

import {
  RIDE_ALARM_MINUTES_BEFORE,
  RIDE_MINIMUM_BLOCK_MINUTES,
  selectExportableRides,
  toRideCalendarEvents,
  type RideCalendarLabels,
} from '../ride-ics';
import { resolveRides, selectRidesDrivenBy, type ResolvedRide } from '../ride-model';
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

/** The frozen reference instant every offset below is measured from. */
const NOW_MS = Date.UTC(2026, 6, 15, 10, 0, 0);

const MINUTE_MS = 60_000;

function minutesFromNow(minutes: number): string {
  return new Date(NOW_MS + minutes * MINUTE_MS).toISOString();
}

function makePerson(id: string, name: string): Person {
  return {
    id: id as PersonId,
    tripId: TRIP_ID,
    name,
    color: hexColor('#3b82f6'),
  };
}

const GUILLAUME = makePerson('guillaume', 'Guillaume'),
  ALICE = makePerson('alice', 'Alice'),
  TOM = makePerson('tom', 'Tom');

const CLIO: Vehicle = {
  id: 'vehicle-clio' as VehicleId,
  tripId: TRIP_ID,
  name: 'la Clio de Guillaume',
  seatCount: 5,
};

function makeRide(id: string, meetDatetime: string, overrides: Partial<Ride> = {}): Ride {
  return {
    id: id as RideId,
    tripId: TRIP_ID,
    direction: 'pickup',
    meetDatetime: meetDatetime as Ride['meetDatetime'],
    location: 'Lyon Part-Dieu',
    leadTimeMinutes: 30,
    driverId: GUILLAUME.id,
    ...overrides,
  };
}

function makeLeg(id: string, personId: PersonId, rideId: string, datetime: string): Transport {
  return {
    id: id as TransportId,
    tripId: TRIP_ID,
    personId,
    type: 'arrival',
    datetime: datetime as Transport['datetime'],
    location: 'Lyon Part-Dieu',
    needsPickup: true,
    rideId: rideId as RideId,
  };
}

/**
 * Resolves rides the way every transport surface reads them.
 *
 * Through `resolveRides` rather than hand-built, because `leaveAtMs` is derived
 * there: a fixture that set it directly would keep passing after the
 * derivation broke.
 */
function resolve(rides: readonly Ride[], legs: readonly Transport[]): ResolvedRide[] {
  return resolveRides({
    rides,
    transports: legs,
    vehicles: [CLIO],
    persons: [GUILLAUME, ALICE, TOM],
  });
}

/** Labels that echo their inputs, so a test reads what reached them. */
const LABELS: RideCalendarLabels = {
  summary: ({ direction, passengers, location }) =>
    passengers === ''
      ? `${direction} at ${location}`
      : `${direction} ${passengers} at ${location}`,
  passengersLine: (passengers) => `passengers: ${passengers}`,
  meetLine: (meetTime) => `be there at ${meetTime}`,
  vehicleLine: (vehicle) => `car: ${vehicle}`,
  unknownPassenger: 'a guest',
};

/** A formatter with no locale in it, so the assertions stay readable. */
function formatDateTime(ms: number): string {
  return new Date(ms).toISOString();
}

function eventsFor(journeys: readonly ResolvedRide[]) {
  return toRideCalendarEvents({ journeys, labels: LABELS, formatDateTime });
}

// ============================================================================
// Tests
// ============================================================================

describe('selectExportableRides', () => {
  it('keeps the runs that are still ahead', () => {
    const journeys = resolve(
      [makeRide('r1', minutesFromNow(120))],
      [makeLeg('leg-1', ALICE.id, 'r1', minutesFromNow(120))],
    );

    expect(selectExportableRides(journeys, NOW_MS)).toHaveLength(1);
  });

  it('drops a run that has already met', () => {
    const journeys = resolve(
      [makeRide('r1', minutesFromNow(-30))],
      [makeLeg('leg-1', ALICE.id, 'r1', minutesFromNow(-30))],
    );

    expect(selectExportableRides(journeys, NOW_MS)).toEqual([]);
  });

  it('drops a run nobody can place on the clock', () => {
    const journeys = resolve(
      [makeRide('r1', 'not-a-datetime')],
      [makeLeg('leg-1', ALICE.id, 'r1', minutesFromNow(120))],
    );

    expect(journeys[0]?.meetAtMs).toBeNull();
    expect(selectExportableRides(journeys, NOW_MS)).toEqual([]);
  });
});

describe('toRideCalendarEvents', () => {
  it('covers the drive, from the leave time to the rendez-vous', () => {
    const journeys = resolve(
      [makeRide('r1', minutesFromNow(120), { leadTimeMinutes: 45 })],
      [makeLeg('leg-1', ALICE.id, 'r1', minutesFromNow(120))],
    );

    const [event] = eventsFor(journeys);

    expect(event?.startMs).toBe(NOW_MS + 75 * MINUTE_MS);
    expect(event?.endMs).toBe(NOW_MS + 120 * MINUTE_MS);
  });

  it('gives a run with no lead time a block the calendar can draw', () => {
    const journeys = resolve(
      [makeRide('r1', minutesFromNow(120), { leadTimeMinutes: 0 })],
      [makeLeg('leg-1', ALICE.id, 'r1', minutesFromNow(120))],
    );

    const [event] = eventsFor(journeys);

    expect(event?.startMs).toBe(NOW_MS + 120 * MINUTE_MS);
    expect(event?.endMs).toBe(
      NOW_MS + (120 + RIDE_MINIMUM_BLOCK_MINUTES) * MINUTE_MS,
    );
  });

  it('alerts before the driver has to leave, not once they are late', () => {
    const journeys = resolve(
      [makeRide('r1', minutesFromNow(120))],
      [makeLeg('leg-1', ALICE.id, 'r1', minutesFromNow(120))],
    );

    expect(eventsFor(journeys)[0]?.alarmMinutesBefore).toBe(RIDE_ALARM_MINUTES_BEFORE);
  });

  it('identifies the event by its ride, so a second import updates it', () => {
    const journeys = resolve(
      [makeRide('r1', minutesFromNow(120))],
      [makeLeg('leg-1', ALICE.id, 'r1', minutesFromNow(120))],
    );

    const first = eventsFor(journeys)[0]?.uid,
      second = eventsFor(
        resolve(
          [makeRide('r1', minutesFromNow(180))],
          [makeLeg('leg-1', ALICE.id, 'r1', minutesFromNow(180))],
        ),
      )[0]?.uid;

    expect(first).toBe('r1@kikouchou.app');
    // The time moved and the identity did not: the calendar moves its entry
    // rather than keeping both.
    expect(second).toBe(first);
  });

  it('names the passengers, the meeting time and the car', () => {
    const journeys = resolve(
      [
        makeRide('r1', minutesFromNow(120), {
          vehicleId: CLIO.id,
          notes: 'Passer prendre le pain',
        }),
      ],
      [
        makeLeg('leg-1', ALICE.id, 'r1', minutesFromNow(120)),
        makeLeg('leg-2', TOM.id, 'r1', minutesFromNow(120)),
      ],
    );

    const [event] = eventsFor(journeys);

    expect(event?.summary).toBe('pickup Alice, Tom at Lyon Part-Dieu');
    expect(event?.description).toContain('passengers: Alice, Tom');
    expect(event?.description).toContain(
      `be there at ${new Date(NOW_MS + 120 * MINUTE_MS).toISOString()}`,
    );
    expect(event?.description).toContain('car: la Clio de Guillaume');
    expect(event?.description).toContain('Passer prendre le pain');
  });

  it('exports a car with nobody listed in it yet', () => {
    const journeys = resolve([makeRide('r1', minutesFromNow(120))], []);

    const [event] = eventsFor(journeys);

    expect(event?.summary).toBe('pickup at Lyon Part-Dieu');
    expect(event?.description).not.toContain('passengers:');
  });

  it('stands in for a passenger this device cannot name', () => {
    const journeys = resolveRides({
      rides: [makeRide('r1', minutesFromNow(120))],
      transports: [makeLeg('leg-1', 'stranger' as PersonId, 'r1', minutesFromNow(120))],
      vehicles: [],
      persons: [GUILLAUME],
    });

    expect(eventsFor(journeys)[0]?.summary).toBe('pickup a guest at Lyon Part-Dieu');
  });

  it('carries the meeting point and its coordinates', () => {
    const journeys = resolve(
      [
        makeRide('r1', minutesFromNow(120), {
          location: 'Lyon Saint-Exupéry',
          coordinates: { lat: 45.72, lon: 5.08 },
        }),
      ],
      [makeLeg('leg-1', ALICE.id, 'r1', minutesFromNow(120))],
    );

    const [event] = eventsFor(journeys);

    expect(event?.location).toBe('Lyon Saint-Exupéry');
    expect(event?.coordinates).toEqual({ lat: 45.72, lon: 5.08 });
  });

  it('writes only the runs the asking driver drives', () => {
    const journeys = resolve(
      [
        makeRide('r1', minutesFromNow(120)),
        makeRide('r2', minutesFromNow(180), { driverId: TOM.id }),
      ],
      [
        makeLeg('leg-1', ALICE.id, 'r1', minutesFromNow(120)),
        makeLeg('leg-2', ALICE.id, 'r2', minutesFromNow(180)),
      ],
    );

    const mine = selectRidesDrivenBy(journeys, GUILLAUME.id);

    expect(eventsFor(mine).map((event) => event.uid)).toEqual(['r1@kikouchou.app']);
  });
});
