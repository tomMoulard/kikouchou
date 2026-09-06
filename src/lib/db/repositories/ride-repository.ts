/**
 * Ride Repository
 *
 * Provides CRUD operations for {@link Ride} entities — the car journeys that
 * serve one or more {@link Transport} legs.
 *
 * ## Datetime representation
 *
 * `meetDatetime` follows exactly the rule `transport-repository` sets out for
 * `datetime`, and for the same reasons: write paths normalise through
 * {@link requireCanonicalDatetime}, read paths coerce through
 * {@link toCanonicalDatetime} without rewriting the stored row, and results are
 * re-sorted after coercion because the `[tripId+meetDatetime]` index orders by
 * characters rather than by instant. See that module's header for the full
 * argument against migrating the rows.
 *
 * ## Membership is not stored here
 *
 * A ride has no passenger list. `Transport.rideId` points the other way, so
 * "who is in this car" is {@link getTransportIdsForRide}, a lookup on the legs.
 * The document merges an array field atomically, so a passenger array would
 * lose one of two joins made offline — the bug activity participants already
 * have. Detaching passengers on delete is therefore a write to the legs, which
 * is why {@link deleteRideWithOwnershipCheck} takes both tables.
 *
 * @module lib/db/repositories/ride-repository
 */

import { db } from '@/lib/db/database';
import { sanitizeRideData } from '@/lib/db/sanitize';
import {
  requireCanonicalDatetime,
  toCanonicalDatetime,
} from '@/lib/db/transport-datetime';
import { rideNoticeKey } from '@/lib/db/repositories/ride-notice-repository';
import { createRideId } from '@/lib/db/utils';
import type {
  PersonId,
  Ride,
  RideFormData,
  RideId,
  TransportId,
  TripId,
  VehicleId,
} from '@/types';

// ============================================================================
// Datetime Normalisation
// ============================================================================

/**
 * Re-expresses a row read back from Dexie as a UTC instant.
 *
 * Coercion is deliberately read-only — a row written by the Yjs bridge or the
 * share merge applicator never passed through this repository's write path, and
 * rewriting it would bake the reading device's timezone guess into the shared
 * document as fact.
 *
 * @param ride - A row as stored
 * @returns The same object when already canonical, a coerced copy otherwise
 */
function toCanonicalRow(ride: Ride): Ride {
  const instant = toCanonicalDatetime(ride.meetDatetime);

  return instant === undefined || instant === ride.meetDatetime
    ? ride
    : { ...ride, meetDatetime: instant };
}

/**
 * Orders canonical rows by instant, unplaceable rows last.
 *
 * @param rides - Canonical rows (mutated in place, as `Array#sort` does)
 * @returns The same array, ascending by instant then id
 */
function sortByInstant(rides: Ride[]): Ride[] {
  return rides.sort((left, right) => {
    const leftAt = toCanonicalDatetime(left.meetDatetime),
      rightAt = toCanonicalDatetime(right.meetDatetime);

    if (leftAt === undefined) {
      return rightAt === undefined ? left.id.localeCompare(right.id) : 1;
    }
    if (rightAt === undefined) {
      return -1;
    }
    if (leftAt === rightAt) {
      return left.id.localeCompare(right.id);
    }
    return leftAt < rightAt ? -1 : 1;
  });
}

/**
 * Coerces a result set and sorts it by instant.
 *
 * @param rides - Rows as stored
 * @returns Canonical rows, ascending by instant
 */
function toCanonicalRows(rides: Ride[]): Ride[] {
  return sortByInstant(rides.map(toCanonicalRow));
}

// ============================================================================
// Reads
// ============================================================================

/**
 * Retrieves every ride on a trip, ordered by meeting time.
 *
 * The `[tripId+meetDatetime]` index orders by the stored characters, so results
 * are re-sorted after coercion — a trip mixing representations is otherwise
 * returned in literal-string order, which is not instant order.
 *
 * @param tripId - The trip ID to filter by
 * @returns Array of rides sorted by meeting time ascending
 *
 * @example
 * ```typescript
 * const rides = await getRidesByTripId(tripId);
 * ```
 */
export async function getRidesByTripId(tripId: TripId): Promise<Ride[]> {
  const rides = await db.rides
    .where('[tripId+meetDatetime]')
    .between([tripId, ''], [tripId, '\uffff'])
    .toArray();

  return toCanonicalRows(rides);
}

/**
 * Retrieves a single ride by its identifier.
 *
 * @param id - The ride's unique identifier
 * @returns The ride with a canonical meeting time, or undefined
 */
export async function getRideById(id: RideId): Promise<Ride | undefined> {
  const ride = await db.rides.get(id);

  return ride === undefined ? undefined : toCanonicalRow(ride);
}

/**
 * Retrieves the rides a given guest is driving.
 *
 * This is the query behind "only the driver gets the alert": it answers what
 * *this* person has to do, without walking the whole trip.
 *
 * @param driverId - The driving person's ID
 * @returns Array of rides sorted by meeting time ascending
 */
export async function getRidesByDriverId(driverId: PersonId): Promise<Ride[]> {
  const rides = await db.rides.where('driverId').equals(driverId).toArray();

  return toCanonicalRows(rides);
}

/**
 * Retrieves the rides using a given vehicle.
 *
 * @param vehicleId - The vehicle's ID
 * @returns Array of rides sorted by meeting time ascending
 */
export async function getRidesByVehicleId(vehicleId: VehicleId): Promise<Ride[]> {
  const rides = await db.rides.where('vehicleId').equals(vehicleId).toArray();

  return toCanonicalRows(rides);
}

/**
 * Retrieves the ids of the legs riding in a given car journey.
 *
 * Membership lives on the leg, so this is a lookup rather than a field read.
 *
 * @param rideId - The ride's unique identifier
 * @returns The transport ids pointing at this ride
 */
export async function getTransportIdsForRide(
  rideId: RideId,
): Promise<TransportId[]> {
  const transports = await db.transports.where('rideId').equals(rideId).toArray();

  return transports.map((transport) => transport.id);
}

/**
 * Counts the rides on a trip.
 *
 * @param tripId - The trip ID to count within
 * @returns The number of rides
 */
export async function getRideCount(tripId: TripId): Promise<number> {
  return db.rides.where('tripId').equals(tripId).count();
}

// ============================================================================
// Writes
// ============================================================================

/**
 * Creates a new ride.
 *
 * @param tripId - The trip this ride belongs to
 * @param data - The ride form data
 * @returns The created Ride object
 *
 * @example
 * ```typescript
 * const ride = await createRide(tripId, {
 *   direction: 'pickup',
 *   meetDatetime: '2024-07-15T15:02:00.000Z',
 *   location: 'Lyon Part-Dieu',
 *   leadTimeMinutes: 30,
 *   driverId,
 *   vehicleId,
 * });
 * ```
 */
export async function createRide(
  tripId: TripId,
  data: RideFormData,
): Promise<Ride> {
  const sanitizedData = sanitizeRideData(data),
    // Normalise before the try: an unparseable meeting time is a caller bug and
    // deserves its own message rather than the generic create failure below.
    meetDatetime = requireCanonicalDatetime(sanitizedData.meetDatetime);

  try {
    const ride: Ride = {
      id: createRideId(),
      tripId,
      ...sanitizedData,
      meetDatetime,
    };

    await db.rides.add(ride);
    return ride;
  } catch (error) {
    throw new Error(
      `Failed to create ${sanitizedData.direction} ride at "${sanitizedData.location}"`,
      { cause: error },
    );
  }
}

/**
 * Updates a ride with ownership validation, in a single transaction.
 *
 * @param id - The ride's unique identifier
 * @param tripId - The expected trip ID for ownership validation
 * @param data - Partial ride data to apply
 * @throws {Error} If the ride is missing or belongs to another trip
 */
export async function updateRideWithOwnershipCheck(
  id: RideId,
  tripId: TripId,
  data: Partial<RideFormData>,
): Promise<void> {
  await db.transaction('rw', db.rides, async () => {
    const ride = await db.rides.get(id);

    if (!ride) {
      throw new Error(`Ride with ID "${id}" not found`);
    }
    if (ride.tripId !== tripId) {
      throw new Error('Cannot update ride: ride does not belong to current trip');
    }

    // Sanitise against the merged record: the sanitiser needs `location` to be
    // present, and a patch that does not touch it would otherwise trim
    // `undefined` into an empty meeting point.
    const merged = sanitizeRideData({ ...ride, ...data });

    await db.rides.update(id, {
      ...data,
      ...(data.location === undefined ? {} : { location: merged.location }),
      ...(data.leadTimeMinutes === undefined
        ? {}
        : { leadTimeMinutes: merged.leadTimeMinutes }),
      ...(data.notes === undefined ? {} : { notes: merged.notes }),
      ...(data.meetDatetime === undefined
        ? {}
        : { meetDatetime: requireCanonicalDatetime(data.meetDatetime) }),
    });
  });
}

/**
 * Attaches a leg to a ride, or detaches it when `rideId` is undefined.
 *
 * The whole of "join this car" and "drop Alice from this car" is one scalar
 * write on the passenger's own record. That is what makes two guests joining
 * the same ride while both offline survive the merge, so this is the only
 * supported way to change membership — never write a passenger list.
 *
 * @param transportId - The leg to move
 * @param tripId - The expected trip ID for ownership validation
 * @param rideId - The ride to join, or undefined to leave
 * @throws {Error} If the leg or the ride is missing, or belongs to another trip
 */
export async function setTransportRide(
  transportId: TransportId,
  tripId: TripId,
  rideId: RideId | undefined,
): Promise<void> {
  await db.transaction('rw', [db.transports, db.rides], async () => {
    const transport = await db.transports.get(transportId);

    if (!transport) {
      throw new Error(`Transport with ID "${transportId}" not found`);
    }
    if (transport.tripId !== tripId) {
      throw new Error(
        'Cannot change ride: transport does not belong to current trip',
      );
    }

    if (rideId !== undefined) {
      const ride = await db.rides.get(rideId);

      if (!ride) {
        throw new Error(`Ride with ID "${rideId}" not found`);
      }
      if (ride.tripId !== tripId) {
        throw new Error('Cannot change ride: ride does not belong to current trip');
      }
    }

    await db.transports.update(transportId, { rideId });
  });
}

/**
 * Deletes a ride with ownership validation, detaching its passengers.
 *
 * The legs survive and go back to needing a lift, which is the honest outcome:
 * cancelling the car does not cancel anybody's train. Leaving them pointing at
 * a deleted ride would instead hide them from both lists at once — no ride card
 * to appear on, and not "needing a driver" either, because they look arranged.
 *
 * @param id - The ride's unique identifier
 * @param tripId - The expected trip ID for ownership validation
 * @throws {Error} If the ride is missing or belongs to another trip
 */
export async function deleteRideWithOwnershipCheck(
  id: RideId,
  tripId: TripId,
): Promise<void> {
  await db.transaction(
    'rw',
    [db.rides, db.transports, db.rideNotices],
    async () => {
      const ride = await db.rides.get(id);

      if (!ride) {
        throw new Error(`Ride with ID "${id}" not found`);
      }
      if (ride.tripId !== tripId) {
        throw new Error('Cannot delete ride: ride does not belong to current trip');
      }

      await db.transports.where('rideId').equals(id).modify({ rideId: undefined });
      // The device's own record of having announced this ride goes with it. Left
      // behind, and the id ever comes back over a re-join, the "leave now" alert
      // is suppressed as already fired.
      await db.rideNotices.delete(rideNoticeKey('leave', id));
      await db.rides.delete(id);
    },
  );
}
