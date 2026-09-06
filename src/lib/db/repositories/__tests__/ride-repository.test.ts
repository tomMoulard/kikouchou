/**
 * @fileoverview Ride and vehicle persistence, and the cascades either side.
 *
 * The cases that matter here are the ones where deleting something must *not*
 * delete something else: cancelling a car does not cancel anybody's train, and
 * sending the hire car back does not cancel the airport run.
 *
 * @module lib/db/repositories/__tests__/ride-repository.test
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/lib/db/database';
import { createPerson, deletePerson } from '@/lib/db/repositories/person-repository';
import {
  createRide,
  deleteRideWithOwnershipCheck,
  getRideById,
  getRidesByDriverId,
  getRidesByTripId,
  getTransportIdsForRide,
  setTransportRide,
  updateRideWithOwnershipCheck,
} from '@/lib/db/repositories/ride-repository';
import {
  createTransport,
  updateTransportWithOwnershipCheck,
} from '@/lib/db/repositories/transport-repository';
import {
  createVehicle,
  deleteVehicleWithOwnershipCheck,
  getVehiclesByTripId,
  updateVehicleWithOwnershipCheck,
} from '@/lib/db/repositories/vehicle-repository';
import { createTrip, deleteTrip } from '@/lib/db/repositories/trip-repository';
import { toHexColor, toISODateStringFromString } from '@/lib/db/utils';
import type { PersonId, RideId, TripId, VehicleId } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

let tripId: TripId,
  alice: PersonId,
  guillaume: PersonId;

beforeEach(async () => {
  const trip = await createTrip({
    name: 'Summer',
    startDate: toISODateStringFromString('2026-07-15'),
    endDate: toISODateStringFromString('2026-07-22'),
  });
  tripId = trip.id;

  alice = (await createPerson(tripId, { name: 'Alice', color: toHexColor('#ef4444') }))
    .id;
  guillaume = (
    await createPerson(tripId, { name: 'Guillaume', color: toHexColor('#3b82f6') })
  ).id;
});

async function makeRide(overrides: Record<string, unknown> = {}): Promise<RideId> {
  const ride = await createRide(tripId, {
    direction: 'pickup',
    meetDatetime: '2026-07-15T15:02:00.000Z',
    location: 'Lyon Part-Dieu',
    ...overrides,
  });
  return ride.id;
}

async function makeLeg(personId: PersonId, rideId?: RideId): Promise<string> {
  const transport = await createTransport(tripId, {
    personId,
    type: 'arrival',
    datetime: '2026-07-15T15:02:00.000Z',
    location: 'Lyon Part-Dieu',
    needsPickup: true,
    rideId,
  });
  return transport.id;
}

// ============================================================================
// Tests
// ============================================================================

describe('createRide', () => {
  it('stores the meeting time as a UTC instant', async () => {
    const rideId = await makeRide({ meetDatetime: '2026-07-15T17:02:00+02:00' }),
      ride = await getRideById(rideId);

    expect(ride?.meetDatetime).toBe('2026-07-15T15:02:00.000Z');
  });

  it('refuses a meeting time nothing can place', async () => {
    await expect(makeRide({ meetDatetime: 'tomorrow-ish' })).rejects.toThrow();
  });

  it('trims and bounds the meeting point', async () => {
    const rideId = await makeRide({ location: '  Lyon Part-Dieu  ' }),
      ride = await getRideById(rideId);

    expect(ride?.location).toBe('Lyon Part-Dieu');
  });

  it('clamps an absurd lead time rather than dropping it', async () => {
    // Zero is meaningful — a guest already at the station leaves now — so an
    // out-of-range value clamps. Dropping it would silently reinstate the
    // 30-minute default.
    const rideId = await makeRide({ leadTimeMinutes: 10_000_000 }),
      ride = await getRideById(rideId);

    expect(ride?.leadTimeMinutes).toBe(24 * 60);
  });

  it('keeps a zero lead time', async () => {
    const rideId = await makeRide({ leadTimeMinutes: 0 }),
      ride = await getRideById(rideId);

    expect(ride?.leadTimeMinutes).toBe(0);
  });
});

describe('getRidesByTripId', () => {
  it('orders by instant, not by stored characters', async () => {
    // A `+02:00` value sorts after a `Z` one lexicographically even when it
    // happens earlier, which is why the read re-sorts after coercion.
    await makeRide({ meetDatetime: '2026-07-15T15:00:00.000Z', location: 'Later' });
    await makeRide({ meetDatetime: '2026-07-15T16:00:00+02:00', location: 'Earlier' });

    const rides = await getRidesByTripId(tripId);

    expect(rides.map((ride) => ride.location)).toEqual(['Earlier', 'Later']);
  });
});

describe('membership', () => {
  it('reads passengers off the legs, not off the ride', async () => {
    const rideId = await makeRide();
    const legA = await makeLeg(alice, rideId);
    await makeLeg(guillaume);

    expect(await getTransportIdsForRide(rideId)).toEqual([legA]);
  });

  it('joins and leaves a car by writing one scalar on the leg', async () => {
    const rideId = await makeRide(),
      legId = await makeLeg(alice);

    await setTransportRide(legId as never, tripId, rideId);
    expect(await getTransportIdsForRide(rideId)).toEqual([legId]);

    await setTransportRide(legId as never, tripId, undefined);
    expect(await getTransportIdsForRide(rideId)).toEqual([]);
  });

  it('clears the legacy driver when a leg joins a car', async () => {
    // Otherwise both representations sit on one record and disagree: the ride
    // wins in `resolveRides`, but a surface still reading `transport.driverId`
    // shows a second driver, and the guest cannot tell who is fetching them.
    const rideId = await makeRide({ driverId: guillaume }),
      legId = await createTransport(tripId, {
        personId: alice,
        type: 'arrival',
        datetime: '2026-07-15T15:02:00.000Z',
        location: 'Lyon Part-Dieu',
        needsPickup: true,
        driverId: guillaume,
      });

    await setTransportRide(legId.id, tripId, rideId);

    expect((await db.transports.get(legId.id))?.driverId).toBeUndefined();
    expect((await db.transports.get(legId.id))?.rideId).toBe(rideId);
  });

  it('takes a leg out of its car when a driver is named on the leg itself', async () => {
    // The other half of the one-driver rule. Without it a leg carried both: the
    // trip showed the ride's driver while any surface reading the leg showed the
    // other one, and a driverless ride reported its passenger as covered.
    const rideId = await makeRide({ driverId: guillaume }),
      legId = await makeLeg(alice, rideId);

    await updateTransportWithOwnershipCheck(legId as never, tripId, {
      driverId: guillaume,
    });

    const leg = await db.transports.get(legId);
    expect(leg?.driverId).toBe(guillaume);
    expect(leg?.rideId).toBeUndefined();
  });

  it('keeps a leg in its car when an unrelated field is edited', async () => {
    // A form saving a corrected station name sends `driverId: undefined` for a
    // leg whose driver lives on its ride. That must not quietly remove the
    // passenger from the car.
    const rideId = await makeRide({ driverId: guillaume }),
      legId = await makeLeg(alice, rideId);

    await updateTransportWithOwnershipCheck(legId as never, tripId, {
      location: 'Lyon Perrache',
      driverId: undefined,
    });

    const leg = await db.transports.get(legId);
    expect(leg?.location).toBe('Lyon Perrache');
    expect(leg?.rideId).toBe(rideId);
  });

  it('refuses to attach a leg to another trip’s ride', async () => {
    const other = await createTrip({
        name: 'Other',
        startDate: toISODateStringFromString('2026-08-01'),
        endDate: toISODateStringFromString('2026-08-05'),
      }),
      foreignRide = await createRide(other.id, {
        direction: 'pickup',
        meetDatetime: '2026-08-01T10:00:00.000Z',
        location: 'Elsewhere',
      }),
      legId = await makeLeg(alice);

    await expect(
      setTransportRide(legId as never, tripId, foreignRide.id),
    ).rejects.toThrow(/does not belong to current trip/);
  });
});

describe('updateRideWithOwnershipCheck', () => {
  it('normalises a new meeting time', async () => {
    const rideId = await makeRide();

    await updateRideWithOwnershipCheck(rideId, tripId, {
      meetDatetime: '2026-07-15T19:02:00+02:00',
    });

    expect((await getRideById(rideId))?.meetDatetime).toBe('2026-07-15T17:02:00.000Z');
  });

  it('leaves the meeting point alone when the patch does not mention it', async () => {
    // The sanitiser needs `location`; a naive patch would trim `undefined` into
    // an empty meeting point.
    const rideId = await makeRide({ location: 'Lyon Part-Dieu' });

    await updateRideWithOwnershipCheck(rideId, tripId, { driverId: guillaume });

    const ride = await getRideById(rideId);
    expect(ride?.location).toBe('Lyon Part-Dieu');
    expect(ride?.driverId).toBe(guillaume);
  });

  it('survives a patch that explicitly clears an optional field', async () => {
    // `{ notes: undefined }` is what a form sends when its textarea is emptied.
    // The sanitiser runs over the merged record, so a naive spread handed it an
    // `undefined` location and `.trim()` threw before the write was attempted.
    const rideId = await makeRide({ location: 'Lyon Part-Dieu', notes: 'bring bread' });

    await expect(
      updateRideWithOwnershipCheck(rideId, tripId, { notes: undefined }),
    ).resolves.toBeUndefined();

    const ride = await getRideById(rideId);
    expect(ride?.location).toBe('Lyon Part-Dieu');
    expect(ride?.notes).toBeUndefined();
  });

  it('refuses a ride belonging to another trip', async () => {
    const other = await createTrip({
        name: 'Other',
        startDate: toISODateStringFromString('2026-08-01'),
        endDate: toISODateStringFromString('2026-08-05'),
      }),
      rideId = await makeRide();

    await expect(
      updateRideWithOwnershipCheck(rideId, other.id, { location: 'Hijacked' }),
    ).rejects.toThrow(/does not belong to current trip/);
  });
});

describe('deleteRideWithOwnershipCheck', () => {
  it('detaches its passengers instead of hiding them', async () => {
    // A leg left pointing at a deleted ride appears on no ride card and is not
    // "needing a driver" either, because it looks arranged.
    const rideId = await makeRide(),
      legId = await makeLeg(alice, rideId);

    await deleteRideWithOwnershipCheck(rideId, tripId);

    const leg = await db.transports.get(legId);
    expect(leg).toBeDefined();
    expect(leg?.rideId).toBeUndefined();
  });
});

describe('vehicles', () => {
  it('bounds a seat count and filters unknown child seats', async () => {
    const vehicle = await createVehicle(tripId, {
      name: '  Espace  ',
      seatCount: 10_000,
      childSeats: ['booster', 'hoverboard' as never, 'rearFacing'],
    });

    expect(vehicle.name).toBe('Espace');
    expect(vehicle.seatCount).toBe(99);
    expect(vehicle.childSeats).toEqual(['booster', 'rearFacing']);
  });

  it('reads back a seat count of zero as "not measured"', async () => {
    const vehicle = await createVehicle(tripId, { name: 'Clio', seatCount: 0 });

    expect(vehicle.seatCount).toBeUndefined();
  });

  it('orders by name', async () => {
    await createVehicle(tripId, { name: 'Espace' });
    await createVehicle(tripId, { name: 'Clio' });

    expect((await getVehiclesByTripId(tripId)).map((v) => v.name)).toEqual([
      'Clio',
      'Espace',
    ]);
  });

  it('keeps the rides when a car is deleted, clearing the reference', async () => {
    const vehicle = await createVehicle(tripId, { name: 'Espace', seatCount: 7 }),
      rideId = await makeRide({ vehicleId: vehicle.id });

    await deleteVehicleWithOwnershipCheck(vehicle.id, tripId);

    const ride = await getRideById(rideId);
    expect(ride).toBeDefined();
    expect(ride?.vehicleId).toBeUndefined();
  });

  it('leaves an untouched field alone on a partial update', async () => {
    const vehicle = await createVehicle(tripId, { name: 'Espace', seatCount: 7 });

    await updateVehicleWithOwnershipCheck(vehicle.id, tripId, { isRental: true });

    const stored = await db.vehicles.get(vehicle.id);
    expect(stored?.name).toBe('Espace');
    expect(stored?.seatCount).toBe(7);
    expect(stored?.isRental).toBe(true);
  });
});

describe('cascades', () => {
  it('clears a deleted guest’s driving but keeps the ride', async () => {
    // The others still have a train to meet, and a driverless ride is exactly
    // the "needs somebody to volunteer" state.
    const rideId = await makeRide({ driverId: guillaume });

    await deletePerson(guillaume);

    const ride = await getRideById(rideId);
    expect(ride).toBeDefined();
    expect(ride?.driverId).toBeUndefined();
    expect(await getRidesByDriverId(guillaume)).toEqual([]);
  });

  it('clears a deleted guest’s car ownership but keeps the car', async () => {
    // The car is still parked outside and still seats five. What must not
    // survive is the dangling `ownerId`: it renders as a blank owner and makes
    // the row unfilterable by owner forever.
    const vehicle = await createVehicle(tripId, {
      name: 'Clio',
      ownerId: guillaume,
    });

    await deletePerson(guillaume);

    const stored = await db.vehicles.get(vehicle.id);
    expect(stored).toBeDefined();
    expect(stored?.ownerId).toBeUndefined();
  });

  it('forgets a deleted ride’s own notice, but not its passengers’ watermarks', async () => {
    // A surviving `leave:` row would suppress the alert if the id ever came
    // back over a re-join. The legs' `moved:` watermarks must survive, though —
    // the legs outlive the ride, and dropping them would make every one of them
    // look like a fresh change.
    const rideId = await makeRide(),
      legId = await makeLeg(alice, rideId);

    await db.rideNotices.bulkPut([
      { key: `leave:${rideId}`, tripId, firedAtMs: Date.now() },
      { key: `moved:${legId}`, tripId, seenDatetime: '2026-07-15T15:02:00.000Z' },
    ]);

    await deleteRideWithOwnershipCheck(rideId, tripId);

    expect(await db.rideNotices.get(`leave:${rideId}`)).toBeUndefined();
    expect(await db.rideNotices.get(`moved:${legId}`)).toBeDefined();
  });

  it('takes rides and vehicles with the trip', async () => {
    const vehicle = await createVehicle(tripId, { name: 'Espace' });
    await makeRide({ vehicleId: vehicle.id });

    await deleteTrip(tripId);

    expect(await db.rides.where('tripId').equals(tripId).count()).toBe(0);
    expect(await db.vehicles.where('tripId').equals(tripId).count()).toBe(0);
  });

  it('takes the device-local ride notices with the trip', async () => {
    await db.rideNotices.put({
      key: 'leave:some-ride',
      tripId,
      firedAtMs: Date.now(),
    });

    await deleteTrip(tripId);

    expect(await db.rideNotices.where('tripId').equals(tripId).count()).toBe(0);
  });
});

describe('ownership of a vehicle id across trips', () => {
  it('refuses to delete another trip’s car', async () => {
    const other = await createTrip({
        name: 'Other',
        startDate: toISODateStringFromString('2026-08-01'),
        endDate: toISODateStringFromString('2026-08-05'),
      }),
      vehicle = await createVehicle(tripId, { name: 'Espace' });

    await expect(
      deleteVehicleWithOwnershipCheck(vehicle.id as VehicleId, other.id),
    ).rejects.toThrow(/does not belong to current trip/);
  });
});
