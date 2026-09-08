/**
 * Vehicle Repository
 *
 * Provides CRUD operations for {@link Vehicle} entities — the cars available to
 * a trip, picked per {@link Ride}.
 *
 * A vehicle owns no schedule, so unlike transports and rides there is no
 * datetime normalisation here. What it does own is a cascade of its own:
 * deleting a car has to clear the `vehicleId` of every ride that used it, or
 * those rides keep pointing at a row nobody can read and every capacity check
 * silently compares against nothing.
 *
 * @module lib/db/repositories/vehicle-repository
 */

import { db } from '@/lib/db/database';
import { sanitizeVehicleData } from '@/lib/db/sanitize';
import { createVehicleId } from '@/lib/db/utils';
import type { PersonId, TripId, Vehicle, VehicleFormData, VehicleId } from '@/types';

// ============================================================================
// Reads
// ============================================================================

/**
 * Orders vehicles by name, so every device renders the same list.
 *
 * Ties break on `id` because two people can legitimately name two cars the
 * same thing — "la voiture de Papa" twice over — and a tie resolved by
 * insertion order renders differently on each device.
 *
 * @param vehicles - Rows as stored (mutated in place, as `Array#sort` does)
 * @returns The same array, ascending by name then id
 */
function sortByName(vehicles: Vehicle[]): Vehicle[] {
  return vehicles.sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    return byName === 0 ? left.id.localeCompare(right.id) : byName;
  });
}

/**
 * Retrieves every vehicle on a trip, ordered by name.
 *
 * @param tripId - The trip ID to filter by
 * @returns Array of vehicles sorted by name ascending
 *
 * @example
 * ```typescript
 * const vehicles = await getVehiclesByTripId(tripId);
 * ```
 */
export async function getVehiclesByTripId(tripId: TripId): Promise<Vehicle[]> {
  const vehicles = await db.vehicles.where('tripId').equals(tripId).toArray();

  return sortByName(vehicles);
}

/**
 * Retrieves a single vehicle by its identifier.
 *
 * @param id - The vehicle's unique identifier
 * @returns The vehicle, or undefined when no such row exists
 */
export async function getVehicleById(id: VehicleId): Promise<Vehicle | undefined> {
  return db.vehicles.get(id);
}

/**
 * Retrieves the vehicles a given guest owns.
 *
 * @param ownerId - The owning person's ID
 * @returns Array of vehicles sorted by name ascending
 */
export async function getVehiclesByOwnerId(ownerId: PersonId): Promise<Vehicle[]> {
  const vehicles = await db.vehicles.where('ownerId').equals(ownerId).toArray();

  return sortByName(vehicles);
}

/**
 * Counts the vehicles on a trip.
 *
 * @param tripId - The trip ID to count within
 * @returns The number of vehicles
 */
export async function getVehicleCount(tripId: TripId): Promise<number> {
  return db.vehicles.where('tripId').equals(tripId).count();
}

// ============================================================================
// Writes
// ============================================================================

/**
 * Creates a new vehicle.
 *
 * @param tripId - The trip this vehicle belongs to
 * @param data - The vehicle form data
 * @returns The created Vehicle object
 *
 * @example
 * ```typescript
 * const vehicle = await createVehicle(tripId, {
 *   name: 'Espace de location',
 *   seatCount: 7,
 *   childSeats: ['booster', 'booster'],
 * });
 * ```
 */
export async function createVehicle(
  tripId: TripId,
  data: VehicleFormData,
): Promise<Vehicle> {
  const sanitizedData = sanitizeVehicleData(data);

  try {
    const vehicle: Vehicle = {
      id: createVehicleId(),
      tripId,
      ...sanitizedData,
    };

    await db.vehicles.add(vehicle);
    return vehicle;
  } catch (error) {
    throw new Error(`Failed to create vehicle "${sanitizedData.name}"`, {
      cause: error,
    });
  }
}

/**
 * Updates a vehicle with ownership validation, in a single transaction.
 *
 * Validation and write share one transaction so a trip switched between the
 * two cannot let an edit land on another trip's row — the TOCTOU shape the
 * transport repository documents.
 *
 * @param id - The vehicle's unique identifier
 * @param tripId - The expected trip ID for ownership validation
 * @param data - Partial vehicle data to apply
 * @throws {Error} If the vehicle is missing or belongs to another trip
 */
export async function updateVehicleWithOwnershipCheck(
  id: VehicleId,
  tripId: TripId,
  data: Partial<VehicleFormData>,
): Promise<void> {
  await db.transaction('rw', db.vehicles, async () => {
    const vehicle = await db.vehicles.get(id);

    if (!vehicle) {
      throw new Error(`Vehicle with ID "${id}" not found`);
    }
    if (vehicle.tripId !== tripId) {
      throw new Error('Cannot update vehicle: vehicle does not belong to current trip');
    }

    // Sanitise against the merged record rather than the patch: the sanitiser
    // needs `name` to be present, and a patch that does not touch it would
    // otherwise trim `undefined`.
    const merged = sanitizeVehicleData({ ...vehicle, ...data });

    await db.vehicles.update(id, {
      ...data,
      ...(data.name === undefined ? {} : { name: merged.name }),
      ...(data.seatCount === undefined ? {} : { seatCount: merged.seatCount }),
      ...(data.childSeats === undefined ? {} : { childSeats: merged.childSeats }),
      ...(data.luggageNotes === undefined
        ? {}
        : { luggageNotes: merged.luggageNotes }),
      ...(data.notes === undefined ? {} : { notes: merged.notes }),
    });
  });
}

/**
 * Deletes a vehicle with ownership validation, clearing every ride that used it.
 *
 * The rides survive. A car being sent back does not cancel the journey — three
 * people still have a train to meet — so the ride is left needing a vehicle,
 * which is a state the UI already knows how to render. What must not survive is
 * the dangling `vehicleId`: a ride pointing at a deleted car reads as "capacity
 * unknown" on every device, and no warning ever fires again.
 *
 * @param id - The vehicle's unique identifier
 * @param tripId - The expected trip ID for ownership validation
 * @throws {Error} If the vehicle is missing or belongs to another trip
 */
export async function deleteVehicleWithOwnershipCheck(
  id: VehicleId,
  tripId: TripId,
): Promise<void> {
  await db.transaction('rw', [db.vehicles, db.rides], async () => {
    const vehicle = await db.vehicles.get(id);

    if (!vehicle) {
      throw new Error(`Vehicle with ID "${id}" not found`);
    }
    if (vehicle.tripId !== tripId) {
      throw new Error('Cannot delete vehicle: vehicle does not belong to current trip');
    }

    await db.rides.where('vehicleId').equals(id).modify({ vehicleId: undefined });
    await db.vehicles.delete(id);
  });
}
