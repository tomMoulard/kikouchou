/**
 * @fileoverview Ride and vehicle persistence, and the cascades either side.
 *
 * The cases that matter here are the ones where deleting something must *not*
 * delete something else: cancelling a car does not cancel anybody's train, and
 * sending the hire car back does not cancel the airport run.
 *
 * @module lib/db/repositories/__tests__/ride-repository.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db/database';
import { createPerson, deletePerson } from '@/lib/db/repositories/person-repository';
import {
  createRide,
  deleteRideWithOwnershipCheck,
  getRideById,
  getRideCount,
  getRidesByDriverId,
  getRidesByTripId,
  getRidesByVehicleId,
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
  getVehicleCount,
  getVehiclesByOwnerId,
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

    await updateVehicleWithOwnershipCheck(vehicle.id, tripId, {
      luggageNotes: 'Coffre pris par la poussette',
    });

    const stored = await db.vehicles.get(vehicle.id);
    expect(stored?.name).toBe('Espace');
    expect(stored?.seatCount).toBe(7);
    expect(stored?.luggageNotes).toBe('Coffre pris par la poussette');
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

// ============================================================================
// Reads of rows other writers stored
// ============================================================================

/** A row as the Yjs projection or the share merge would store it: unsanitised. */
async function storeRawRide(row: Record<string, unknown> & { readonly id: string }): Promise<RideId> {
  const ride = {
    tripId,
    direction: 'pickup',
    meetDatetime: '2026-07-15T15:02:00.000Z',
    location: 'Lyon Part-Dieu',
    ...row,
  };
  await db.rides.put(ride as never);
  return ride.id as RideId;
}

describe('reading rides back', () => {
  it('re-expresses a stored offset time as a UTC instant and keeps the rest', async () => {
    const id = await storeRawRide({
      id: 'ride-offset',
      meetDatetime: '2026-07-15T17:02:00+02:00',
      notes: 'bring bread',
    });

    expect(await getRideById(id)).toEqual({
      id,
      tripId,
      direction: 'pickup',
      meetDatetime: '2026-07-15T15:02:00.000Z',
      location: 'Lyon Part-Dieu',
      notes: 'bring bread',
    });
  });

  it('orders by instant, then by id, and puts unplaceable rows last', async () => {
    // Stored strings sort differently from instants: the `+02:00` spelling of
    // ten o'clock sorts after the `Z` one, and a value starting with `!` sorts
    // before every date. The ids are cased so the store's binary order and
    // `localeCompare` disagree, which is what the tie-break has to settle.
    await storeRawRide({ id: 'B-tie', meetDatetime: '2026-07-15T10:00:00.000Z' });
    await storeRawRide({ id: 'a-tie', meetDatetime: '2026-07-15T12:00:00+02:00' });
    await storeRawRide({ id: 'early', meetDatetime: '2026-07-15T09:00:00.000Z' });
    await storeRawRide({ id: 'late', meetDatetime: '2026-07-15T11:00:00.000Z' });
    await storeRawRide({ id: 'Z-unplaceable', meetDatetime: '!not a time' });
    await storeRawRide({ id: 'y-unplaceable', meetDatetime: '!never' });

    expect((await getRidesByTripId(tripId)).map((ride) => ride.id)).toEqual([
      'early',
      'a-tie',
      'B-tie',
      'late',
      'y-unplaceable',
      'Z-unplaceable',
    ]);
  });

  it('finds the rides a guest drives, and only those', async () => {
    const driving = await makeRide({ driverId: alice });
    await makeRide({ driverId: guillaume });

    expect((await getRidesByDriverId(alice)).map((ride) => ride.id)).toEqual([driving]);
  });

  it('finds the rides that use a car, and counts the trip\'s rides', async () => {
    const vehicle = await createVehicle(tripId, { name: 'Espace' });
    const inCar = await makeRide({ vehicleId: vehicle.id });
    await makeRide();

    expect((await getRidesByVehicleId(vehicle.id)).map((ride) => ride.id)).toEqual([inCar]);
    expect(await getRideCount(tripId)).toBe(2);
  });
});

// ============================================================================
// Write failures and refusals
// ============================================================================

describe('ride writes that cannot happen', () => {
  it('names the ride it failed to create', async () => {
    vi.spyOn(db.rides, 'add').mockRejectedValueOnce(new Error('disk full'));

    await expect(makeRide()).rejects.toThrow('Failed to create pickup ride at "Lyon Part-Dieu"');
  });

  it('refuses to update a ride that does not exist', async () => {
    await expect(
      updateRideWithOwnershipCheck('ride-missing' as RideId, tripId, { notes: 'x' }),
    ).rejects.toThrow('Ride with ID "ride-missing" not found');
  });

  it('refuses to move a leg that does not exist', async () => {
    await expect(
      setTransportRide('leg-missing' as never, tripId, undefined),
    ).rejects.toThrow('Transport with ID "leg-missing" not found');
  });

  it('refuses to move another trip\'s leg', async () => {
    const legId = await makeLeg(alice);
    const other = await createTrip({
      name: 'Other',
      startDate: toISODateStringFromString('2026-08-01'),
      endDate: toISODateStringFromString('2026-08-05'),
    });

    await expect(setTransportRide(legId as never, other.id, undefined)).rejects.toThrow(
      'Cannot change ride: transport does not belong to current trip',
    );
  });

  it('refuses to put a leg in a ride that does not exist', async () => {
    const legId = await makeLeg(alice);

    await expect(
      setTransportRide(legId as never, tripId, 'ride-missing' as RideId),
    ).rejects.toThrow('Ride with ID "ride-missing" not found');
  });

  it('refuses to delete a ride that does not exist', async () => {
    await expect(
      deleteRideWithOwnershipCheck('ride-missing' as RideId, tripId),
    ).rejects.toThrow('Ride with ID "ride-missing" not found');
  });

  it('refuses to delete another trip\'s ride, and keeps it', async () => {
    const rideId = await makeRide();
    const other = await createTrip({
      name: 'Other',
      startDate: toISODateStringFromString('2026-08-01'),
      endDate: toISODateStringFromString('2026-08-05'),
    });

    await expect(deleteRideWithOwnershipCheck(rideId, other.id)).rejects.toThrow(
      'Cannot delete ride: ride does not belong to current trip',
    );
    expect(await db.rides.get(rideId)).toBeDefined();
  });
});

// ============================================================================
// Partial updates touch the fields they name, and sanitise those
// ============================================================================

describe('updateRideWithOwnershipCheck: field by field', () => {
  it('sanitises each field the patch names', async () => {
    const rideId = await makeRide();

    await updateRideWithOwnershipCheck(rideId, tripId, {
      location: '  Lyon Perrache  ',
      leadTimeMinutes: 10_000_000,
      notes: '  bring bread  ',
      meetDatetime: '2026-07-15T19:02:00+02:00',
    });

    expect(await db.rides.get(rideId)).toMatchObject({
      location: 'Lyon Perrache',
      leadTimeMinutes: 24 * 60,
      notes: 'bring bread',
      meetDatetime: '2026-07-15T17:02:00.000Z',
    });
  });

  it('rewrites no field the patch does not name', async () => {
    const rideId = await storeRawRide({
      id: 'ride-raw',
      location: '  Lyon  ',
      leadTimeMinutes: 99_999,
      notes: '  as stored  ',
    });

    await updateRideWithOwnershipCheck(rideId, tripId, { driverId: alice });

    expect(await db.rides.get(rideId)).toMatchObject({
      location: '  Lyon  ',
      leadTimeMinutes: 99_999,
      notes: '  as stored  ',
      driverId: alice,
    });
  });
});

// ============================================================================
// Vehicles
// ============================================================================

describe('vehicle reads and writes', () => {
  it('orders by name whatever order the store returns, ties by id', async () => {
    // Primary keys chosen so the store's order is the reverse of the right one,
    // and so binary order and `localeCompare` disagree on the tie.
    await db.vehicles.bulkPut([
      { id: 'A-zoe', tripId, name: 'Zoe' },
      { id: 'B-clio', tripId, name: 'Clio' },
      { id: 'a-clio', tripId, name: 'Clio' },
    ] as never);

    expect((await getVehiclesByTripId(tripId)).map((vehicle) => vehicle.id)).toEqual([
      'a-clio',
      'B-clio',
      'A-zoe',
    ]);
  });

  it('finds the cars a guest owns, and counts the trip\'s cars', async () => {
    const owned = await createVehicle(tripId, { name: 'Espace', ownerId: alice });
    await createVehicle(tripId, { name: 'Clio', ownerId: guillaume });

    expect((await getVehiclesByOwnerId(alice)).map((vehicle) => vehicle.id)).toEqual([
      owned.id,
    ]);
    expect(await getVehicleCount(tripId)).toBe(2);
  });

  it('names the car it failed to create', async () => {
    vi.spyOn(db.vehicles, 'add').mockRejectedValueOnce(new Error('disk full'));

    await expect(createVehicle(tripId, { name: '  Espace ' })).rejects.toThrow(
      'Failed to create vehicle "Espace"',
    );
  });

  it('refuses to update a car that does not exist', async () => {
    await expect(
      updateVehicleWithOwnershipCheck('vehicle-missing' as VehicleId, tripId, { notes: 'x' }),
    ).rejects.toThrow('Vehicle with ID "vehicle-missing" not found');
  });

  it('refuses to update another trip\'s car', async () => {
    const vehicle = await createVehicle(tripId, { name: 'Espace' });
    const other = await createTrip({
      name: 'Other',
      startDate: toISODateStringFromString('2026-08-01'),
      endDate: toISODateStringFromString('2026-08-05'),
    });

    await expect(
      updateVehicleWithOwnershipCheck(vehicle.id, other.id, { name: 'Hijacked' }),
    ).rejects.toThrow('Cannot update vehicle: vehicle does not belong to current trip');
    expect((await db.vehicles.get(vehicle.id))?.name).toBe('Espace');
  });

  it('refuses to delete a car that does not exist', async () => {
    await expect(
      deleteVehicleWithOwnershipCheck('vehicle-missing' as VehicleId, tripId),
    ).rejects.toThrow('Vehicle with ID "vehicle-missing" not found');
  });

  it('sanitises each field a patch names', async () => {
    const vehicle = await createVehicle(tripId, { name: 'Espace' });

    await updateVehicleWithOwnershipCheck(vehicle.id, tripId, {
      name: '  Clio  ',
      seatCount: 10_000,
      childSeats: ['booster', 'hoverboard' as never],
      luggageNotes: '  roof box  ',
      notes: '  diesel  ',
    });

    expect(await db.vehicles.get(vehicle.id)).toMatchObject({
      name: 'Clio',
      seatCount: 99,
      childSeats: ['booster'],
      luggageNotes: 'roof box',
      notes: 'diesel',
    });
  });

  it('rewrites no field a patch does not name', async () => {
    const raw = {
      id: 'vehicle-raw',
      tripId,
      name: '  Espace  ',
      seatCount: 500,
      childSeats: ['hoverboard'],
      luggageNotes: '  as stored  ',
      notes: '  as stored  ',
    };
    await db.vehicles.put(raw as never);

    await updateVehicleWithOwnershipCheck('vehicle-raw' as VehicleId, tripId, {
      ownerId: alice,
    });

    expect(await db.vehicles.get('vehicle-raw')).toEqual({ ...raw, ownerId: alice });
  });
});

describe('reading rides back, the edges', () => {
  it('puts unplaceable rows after every placeable one, in id order', async () => {
    // Stored after the dates (`z` sorts after `2`) and in the reverse of id order.
    await storeRawRide({ id: 'm-placeable', meetDatetime: '2026-07-15T10:00:00.000Z' });
    await storeRawRide({ id: 'c-unplaceable', meetDatetime: 'zz-0' });
    await storeRawRide({ id: 'b-unplaceable', meetDatetime: 'zz-1' });
    await storeRawRide({ id: 'a-unplaceable', meetDatetime: 'zz-2' });

    expect((await getRidesByTripId(tripId)).map((ride) => ride.id)).toEqual([
      'm-placeable',
      'a-unplaceable',
      'b-unplaceable',
      'c-unplaceable',
    ]);
  });

  it('answers nothing for a ride that does not exist', async () => {
    expect(await getRideById('ride-missing' as RideId)).toBeUndefined();
  });
});
