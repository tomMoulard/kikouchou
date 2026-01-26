/**
 * Trip Repository
 *
 * Provides CRUD operations for Trip entities with cascade delete support.
 * All operations use the Dexie.js database and branded types for type safety.
 *
 * @module lib/db/repositories/trip-repository
 */

import Dexie from 'dexie';
import { db } from '@/lib/db/database';
import {
  createShareId,
  createTimestamps,
  createTripId,
  updateTimestamp,
} from '@/lib/db/utils';
import type { Trip, TripFormData, TripId } from '@/types';

/** Maximum retry attempts for ID collision recovery */
const MAX_ID_RETRIES = 3;

/**
 * Creates a new trip in the database.
 *
 * Generates unique IDs for the trip and share link, sets creation timestamps,
 * and persists the trip to IndexedDB. Handles rare shareId collisions with retry logic.
 *
 * @param data - The trip form data (name, location, startDate, endDate)
 * @returns The created Trip object with all generated fields
 * @throws {Error} If unable to generate unique ID after maximum retries
 *
 * @example
 * ```typescript
 * const trip = await createTrip({
 *   name: 'Summer Vacation 2024',
 *   location: 'Beach House, Brittany',
 *   startDate: '2024-07-15',
 *   endDate: '2024-07-22',
 * });
 * console.log(trip.id); // Generated TripId
 * console.log(trip.shareId); // Generated ShareId for sharing
 * ```
 */
export async function createTrip(data: TripFormData): Promise<Trip> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ID_RETRIES; attempt++) {
    const trip: Trip = {
      id: createTripId(),
      ...data,
      shareId: createShareId(),
      ...createTimestamps(),
    };

    try {
      await db.trips.add(trip);
      return trip;
    } catch (error) {
      // Check if this is a constraint error (shareId collision)
      if (error instanceof Dexie.ConstraintError) {
        lastError = error;
        // Retry with new IDs
        continue;
      }
      // For other errors, throw immediately
      throw error;
    }
  }

  throw new Error(
    `Failed to create trip after ${MAX_ID_RETRIES} attempts due to ID collisions`,
    { cause: lastError },
  );
}

/**
 * Retrieves all trips ordered by start date (most recent first).
 *
 * Uses the `startDate` index for efficient sorting.
 *
 * @returns Array of all trips, sorted by startDate descending
 *
 * @example
 * ```typescript
 * const trips = await getAllTrips();
 * // trips[0] is the most recently starting trip
 * ```
 */
export async function getAllTrips(): Promise<Trip[]> {
  return db.trips.orderBy('startDate').reverse().toArray();
}

/**
 * Retrieves a trip by its unique ID.
 *
 * @param id - The trip's unique identifier
 * @returns The trip if found, undefined otherwise
 *
 * @example
 * ```typescript
 * const trip = await getTripById(tripId);
 * if (trip) {
 *   console.log(trip.name);
 * }
 * ```
 */
export async function getTripById(id: TripId): Promise<Trip | undefined> {
  return db.trips.get(id);
}

/**
 * Retrieves a trip by its share ID (for the sharing feature).
 *
 * Uses the unique `shareId` index for efficient O(log n) lookup.
 *
 * @param shareId - The trip's share identifier (10-character string)
 * @returns The trip if found, undefined otherwise
 *
 * @example
 * ```typescript
 * // When handling a share link: /share/abc1234567
 * const trip = await getTripByShareId('abc1234567');
 * if (trip) {
 *   // Display shared trip view
 * }
 * ```
 */
export async function getTripByShareId(
  shareId: string,
): Promise<Trip | undefined> {
  return db.trips.where('shareId').equals(shareId).first();
}

/**
 * Updates an existing trip with partial data.
 *
 * Only the provided fields in `data` are updated. The `updatedAt` timestamp
 * is always refreshed automatically. Uses atomic update to avoid TOCTOU race conditions.
 *
 * @param id - The trip's unique identifier
 * @param data - Partial trip form data to update
 * @throws {Error} If the trip with the given ID does not exist
 *
 * @example
 * ```typescript
 * // Update just the trip name
 * await updateTrip(tripId, { name: 'New Trip Name' });
 *
 * // Update multiple fields
 * await updateTrip(tripId, {
 *   name: 'Updated Name',
 *   location: 'New Location',
 * });
 * ```
 */
export async function updateTrip(
  id: TripId,
  data: Partial<TripFormData>,
): Promise<void> {
  // Use update() return value to check existence atomically (avoids TOCTOU race)
  const updatedCount = await db.trips.update(id, {
    ...data,
    ...updateTimestamp(),
  });

  if (updatedCount === 0) {
    throw new Error(`Trip with id "${id}" not found`);
  }
}

/**
 * Deletes a trip and all its related data (cascade delete).
 *
 * Removes all associated records in a single atomic transaction:
 * - Room assignments
 * - Transports (arrivals/departures)
 * - Persons (participants)
 * - Rooms
 * - The trip itself
 *
 * If any deletion fails, the entire operation is rolled back.
 * Deleting a non-existent trip is a no-op (idempotent).
 *
 * @param id - The trip's unique identifier
 *
 * @example
 * ```typescript
 * // Delete a trip and all its data
 * await deleteTrip(tripId);
 * // All rooms, persons, assignments, and transports are also deleted
 * ```
 */
export async function deleteTrip(id: TripId): Promise<void> {
  await db.transaction(
    'rw',
    [db.trips, db.rooms, db.persons, db.roomAssignments, db.transports],
    async () => {
      // Delete related records in parallel for better performance
      // Within a transaction, all operations are atomic regardless of order
      await Promise.all([
        db.roomAssignments.where('tripId').equals(id).delete(),
        db.transports.where('tripId').equals(id).delete(),
        db.persons.where('tripId').equals(id).delete(),
        db.rooms.where('tripId').equals(id).delete(),
      ]);

      // Delete the trip itself after related data is removed
      await db.trips.delete(id);
    },
  );
}
