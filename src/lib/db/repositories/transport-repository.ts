/**
 * Transport Repository
 *
 * Provides CRUD operations for Transport entities (arrivals/departures).
 * All operations use the Dexie.js database and branded types for type safety.
 *
 * @module lib/db/repositories/transport-repository
 */

import { db } from '@/lib/db/database';
import { sanitizeTransportData } from '@/lib/db/sanitize';
import { createTransportId } from '@/lib/db/utils';
import type {
  PersonId,
  Transport,
  TransportFormData,
  TransportId,
  TripId,
} from '@/types';

/**
 * Creates a new transport in the database.
 *
 * @param tripId - The trip this transport belongs to
 * @param data - The transport form data
 * @returns The created Transport object
 *
 * @example
 * ```typescript
 * const transport = await createTransport(tripId, {
 *   personId,
 *   type: 'arrival',
 *   datetime: '2024-07-15T14:30:00.000Z',
 *   location: 'Gare Montparnasse',
 *   transportMode: 'train',
 *   transportNumber: 'TGV 8541',
 *   needsPickup: true,
 * });
 * ```
 */
export async function createTransport(
  tripId: TripId,
  data: TransportFormData,
): Promise<Transport> {
  // Sanitize input data (trim whitespace, enforce max lengths)
  const sanitizedData = sanitizeTransportData(data);

  try {
    const transport: Transport = {
      id: createTransportId(),
      tripId,
      ...sanitizedData,
    };

    await db.transports.add(transport);
    return transport;
  } catch (error) {
    throw new Error(
      `Failed to create ${sanitizedData.type} transport for person ${sanitizedData.personId} at "${sanitizedData.location}"`,
      { cause: error },
    );
  }
}

/**
 * Retrieves all transports for a trip, ordered by datetime.
 *
 * Uses the compound index [tripId+datetime] for efficient querying.
 *
 * @param tripId - The trip ID to filter by
 * @returns Array of transports sorted by datetime ascending
 *
 * @example
 * ```typescript
 * const transports = await getTransportsByTripId(tripId);
 * ```
 */
export async function getTransportsByTripId(tripId: TripId): Promise<Transport[]> {
  return db.transports
    .where('[tripId+datetime]')
    .between([tripId, ''], [tripId, '\uffff'])
    .toArray();
}

/**
 * Retrieves all transports for a specific person, ordered by datetime.
 *
 * @param personId - The person ID to filter by
 * @returns Array of transports sorted by datetime ascending
 *
 * @example
 * ```typescript
 * const transports = await getTransportsByPersonId(personId);
 * ```
 */
export async function getTransportsByPersonId(
  personId: PersonId,
): Promise<Transport[]> {
  const transports = await db.transports
    .where('personId')
    .equals(personId)
    .toArray();

  // Sort by datetime
  return transports.sort((a, b) => a.datetime.localeCompare(b.datetime));
}

/**
 * Retrieves all arrivals for a trip, ordered by datetime.
 *
 * @param tripId - The trip ID to filter by
 * @returns Array of arrival transports sorted by datetime ascending
 *
 * @example
 * ```typescript
 * const arrivals = await getArrivals(tripId);
 * ```
 */
export async function getArrivals(tripId: TripId): Promise<Transport[]> {
  const transports = await db.transports
    .where('tripId')
    .equals(tripId)
    .filter((t) => t.type === 'arrival')
    .toArray();

  return transports.sort((a, b) => a.datetime.localeCompare(b.datetime));
}

/**
 * Retrieves all departures for a trip, ordered by datetime.
 *
 * @param tripId - The trip ID to filter by
 * @returns Array of departure transports sorted by datetime ascending
 *
 * @example
 * ```typescript
 * const departures = await getDepartures(tripId);
 * ```
 */
export async function getDepartures(tripId: TripId): Promise<Transport[]> {
  const transports = await db.transports
    .where('tripId')
    .equals(tripId)
    .filter((t) => t.type === 'departure')
    .toArray();

  return transports.sort((a, b) => a.datetime.localeCompare(b.datetime));
}

/**
 * Retrieves a transport by its unique ID.
 *
 * @param id - The transport's unique identifier
 * @returns The transport if found, undefined otherwise
 *
 * @example
 * ```typescript
 * const transport = await getTransportById(transportId);
 * ```
 */
export async function getTransportById(
  id: TransportId,
): Promise<Transport | undefined> {
  return db.transports.get(id);
}

/**
 * Updates an existing transport with partial data.
 *
 * @deprecated Use {@link updateTransportWithOwnershipCheck} instead.
 * This function will be removed in a future version.
 *
 * @param id - The transport's unique identifier
 * @param data - Partial transport form data to update
 * @throws {Error} If the transport with the given ID does not exist
 *
 * @example
 * ```typescript
 * await updateTransport(transportId, {
 *   datetime: '2024-07-15T15:00:00.000Z',
 *   location: 'Gare de Lyon',
 * });
 * ```
 */
export async function updateTransport(
  id: TransportId,
  data: Partial<TransportFormData>,
): Promise<void> {
  // Sanitize input data (trim whitespace, enforce max lengths)
  const sanitizedData: Partial<TransportFormData> = { ...data };
  if (sanitizedData.location !== undefined) {
    sanitizedData.location = sanitizeTransportData({
      location: sanitizedData.location,
      type: 'arrival',
      personId: '' as PersonId,
      datetime: '',
      needsPickup: false,
    }).location;
  }
  if (sanitizedData.transportNumber !== undefined) {
    sanitizedData.transportNumber = sanitizeTransportData({
      location: '',
      transportNumber: sanitizedData.transportNumber,
      type: 'arrival',
      personId: '' as PersonId,
      datetime: '',
      needsPickup: false,
    }).transportNumber;
  }
  if (sanitizedData.notes !== undefined) {
    sanitizedData.notes = sanitizeTransportData({
      location: '',
      notes: sanitizedData.notes,
      type: 'arrival',
      personId: '' as PersonId,
      datetime: '',
      needsPickup: false,
    }).notes;
  }

  const updatedCount = await db.transports.update(id, sanitizedData);

  if (updatedCount === 0) {
    throw new Error(`Transport with id "${id}" not found`);
  }
}

/**
 * Deletes a transport.
 *
 * @deprecated Use {@link deleteTransportWithOwnershipCheck} instead.
 * This function will be removed in a future version.
 *
 * @param id - The transport's unique identifier
 *
 * @example
 * ```typescript
 * await deleteTransport(transportId);
 * ```
 */
export async function deleteTransport(id: TransportId): Promise<void> {
  try {
    await db.transports.delete(id);
  } catch (error) {
    throw new Error(`Failed to delete transport ${id}`, { cause: error });
  }
}

/**
 * Gets upcoming transports that need pickup, sorted by datetime.
 *
 * Returns transports where:
 * - needsPickup is true
 * - datetime is in the future (or optionally from a specific date)
 *
 * @param tripId - The trip ID to search within
 * @param fromDatetime - Optional ISO datetime to filter from (defaults to now)
 * @returns Array of transports needing pickup, sorted by datetime
 *
 * @example
 * ```typescript
 * // Get all upcoming pickups from now
 * const pickups = await getUpcomingPickups(tripId);
 *
 * // Get pickups from a specific date
 * const pickups = await getUpcomingPickups(tripId, '2024-07-15T00:00:00.000Z');
 * ```
 */
export async function getUpcomingPickups(
  tripId: TripId,
  fromDatetime?: string,
): Promise<Transport[]> {
  const now = fromDatetime ?? new Date().toISOString(),

   transports = await db.transports
    .where('tripId')
    .equals(tripId)
    .filter((t) => t.needsPickup && t.datetime >= now)
    .toArray();

  return transports.sort((a, b) => a.datetime.localeCompare(b.datetime));
}

/**
 * Gets transports for a trip on a specific date.
 *
 * @param tripId - The trip ID to search within
 * @param date - The date to filter by (YYYY-MM-DD)
 * @returns Array of transports on the given date, sorted by datetime
 *
 * @example
 * ```typescript
 * const todayTransports = await getTransportsForDate(tripId, '2024-07-15');
 * ```
 */
export async function getTransportsForDate(
  tripId: TripId,
  date: string,
): Promise<Transport[]> {
  // Match datetimes that start with the date (YYYY-MM-DD)
  const transports = await db.transports
    .where('tripId')
    .equals(tripId)
    .filter((t) => t.datetime.startsWith(date))
    .toArray();

  return transports.sort((a, b) => a.datetime.localeCompare(b.datetime));
}

/**
 * Gets the count of transports for a trip.
 *
 * @param tripId - The trip ID to count transports for
 * @returns Number of transports in the trip
 *
 * @example
 * ```typescript
 * const count = await getTransportCount(tripId);
 * ```
 */
export async function getTransportCount(tripId: TripId): Promise<number> {
  return db.transports.where('tripId').equals(tripId).count();
}

/**
 * Gets transports where a specific person is the driver.
 *
 * @param driverId - The person ID of the driver
 * @returns Array of transports where this person is assigned as driver
 *
 * @example
 * ```typescript
 * const driverAssignments = await getTransportsByDriverId(personId);
 * ```
 */
export async function getTransportsByDriverId(
  driverId: PersonId,
): Promise<Transport[]> {
  const transports = await db.transports
    .where('driverId')
    .equals(driverId)
    .toArray();

  return transports.sort((a, b) => a.datetime.localeCompare(b.datetime));
}

// ============================================================================
// Transactional Operations with Ownership Validation (CR-2 fix)
// ============================================================================

/**
 * Updates a transport with ownership validation in a single transaction.
 * Prevents TOCTOU race condition by combining validation and mutation atomically.
 *
 * @param id - The transport's unique identifier
 * @param tripId - The expected trip ID for ownership validation
 * @param data - Partial transport form data to update
 * @throws {Error} If transport not found or doesn't belong to the specified trip
 *
 * @example
 * ```typescript
 * await updateTransportWithOwnershipCheck(transportId, currentTripId, { location: 'New Location' });
 * ```
 */
export async function updateTransportWithOwnershipCheck(
  id: TransportId,
  tripId: TripId,
  data: Partial<TransportFormData>,
): Promise<void> {
  await db.transaction('rw', db.transports, async () => {
    const transport = await db.transports.get(id);

    if (!transport) {
      throw new Error(`Transport with ID "${id}" not found`);
    }
    if (transport.tripId !== tripId) {
      throw new Error('Cannot update transport: transport does not belong to current trip');
    }

    await db.transports.update(id, data);
  });
}

/**
 * Deletes a transport with ownership validation in a single transaction.
 * Prevents TOCTOU race condition by combining validation and deletion atomically.
 *
 * @param id - The transport's unique identifier
 * @param tripId - The expected trip ID for ownership validation
 * @throws {Error} If transport not found or doesn't belong to the specified trip
 *
 * @example
 * ```typescript
 * await deleteTransportWithOwnershipCheck(transportId, currentTripId);
 * ```
 */
export async function deleteTransportWithOwnershipCheck(
  id: TransportId,
  tripId: TripId,
): Promise<void> {
  await db.transaction('rw', db.transports, async () => {
    const transport = await db.transports.get(id);

    if (!transport) {
      throw new Error(`Transport with ID "${id}" not found`);
    }
    if (transport.tripId !== tripId) {
      throw new Error('Cannot delete transport: transport does not belong to current trip');
    }

    await db.transports.delete(id);
  });
}
