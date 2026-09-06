/**
 * Transport Repository
 *
 * Provides CRUD operations for Transport entities (arrivals/departures).
 * All operations use the Dexie.js database and branded types for type safety.
 *
 * ## Datetime representation
 *
 * A transport's `datetime` is stored as a UTC ISO instant (`…Z`) and nothing
 * else. Every write path here normalises through
 * {@link requireCanonicalDatetime} so a caller holding a raw `datetime-local`
 * value (`2026-09-03T14:30`) cannot persist it, and every read path *here*
 * coerces through {@link toCanonicalDatetime} so rows written before that rule
 * — or written straight to Dexie by the Yjs bridge and the share merge
 * applicator — are still comparable as instants. Coercion reaches only this
 * repository's readers: `TransportContext`, `trip-stats` and the Yjs bridge
 * query `db.transports` themselves. Every row written from now on is canonical
 * wherever it is read, so that gap is a legacy-row gap, not a new one.
 *
 * **No migration rewrites the stored rows.** An offset-less value has lost the
 * information needed to place it on the timeline: the only way to interpret it
 * is to guess a zone. Read-time coercion guesses the *reading* device's zone,
 * which for a locally entered row is the zone it was typed in, and it stays a
 * guess — reversible, and re-evaluated on whichever device reads. A Dexie
 * upgrade would instead bake one device's guess into the shared document, sync
 * it to every peer as fact, and be irreversible. For rows that arrived over
 * sync from a peer in another zone the guess is simply wrong, and no migration
 * can make it right. So the ambiguity is contained rather than laundered:
 * ordering and day bucketing become self-consistent on each device, and the
 * cross-device skew of legacy rows is accepted and documented.
 *
 * @module lib/db/repositories/transport-repository
 */

import { db } from '@/lib/db/database';
import { sanitizeTransportData } from '@/lib/db/sanitize';
import {
  requireCanonicalDatetime,
  toCanonicalDatetime,
} from '@/lib/db/transport-datetime';
import { createTransportId } from '@/lib/db/utils';
import type {
  PersonId,
  Transport,
  TransportFormData,
  TransportId,
  TripId,
} from '@/types';

// ============================================================================
// Datetime Normalisation
// ============================================================================

/**
 * Re-expresses a row read back from Dexie as a UTC instant.
 *
 * Rows predating write-time normalisation, and rows written straight to Dexie
 * by the Yjs bridge or the share merge applicator, can still carry a bare
 * `2026-09-03T14:30` or an offset form. Every consumer of this repository
 * orders and buckets by the raw string, so they are coerced here — the reader
 * sees one representation whatever the writer used.
 *
 * Coercion is deliberately read-only. See the module note on migration.
 *
 * @param transport - A row as stored
 * @returns The same object when already canonical, a coerced copy otherwise
 */
function toCanonicalRow(transport: Transport): Transport {
  const instant = toCanonicalDatetime(transport.datetime);

  return instant === undefined || instant === transport.datetime
    ? transport
    : { ...transport, datetime: instant };
}

/**
 * Orders canonical rows by instant, unparseable rows last.
 *
 * The sort is not redundant with the `[tripId+datetime]` index: that index
 * orders by the stored characters, so a set mixing representations comes back
 * in the wrong order and has to be re-sorted once canonical. A row nobody can
 * place in time sorts to the end rather than floating to the top, matching
 * `sortTransportsByInstant` in the transports feature.
 *
 * @param transports - Canonical rows (mutated in place, as `Array#sort` does)
 * @returns The same array, ascending by instant
 */
function sortByInstant(transports: Transport[]): Transport[] {
  return transports.sort((a, b) => {
    const left = toCanonicalDatetime(a.datetime),
      right = toCanonicalDatetime(b.datetime);

    if (left === undefined) {
      return right === undefined ? 0 : 1;
    }
    if (right === undefined) {
      return -1;
    }
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/**
 * Coerces a result set and sorts it by instant.
 *
 * @param transports - Rows as stored
 * @returns Canonical rows, ascending by instant
 */
function toCanonicalRows(transports: Transport[]): Transport[] {
  return sortByInstant(transports.map(toCanonicalRow));
}

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
  const sanitizedData = sanitizeTransportData(data),
    // Normalise before the try: an unparseable datetime is a caller bug and
    // deserves its own message rather than the generic create failure below.
    datetime = requireCanonicalDatetime(sanitizedData.datetime);

  try {
    const transport: Transport = {
      id: createTransportId(),
      tripId,
      ...sanitizedData,
      datetime,
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
 * Uses the compound index [tripId+datetime] for efficient querying. The index
 * orders by the stored characters, so results are re-sorted after coercion —
 * a trip mixing representations is otherwise returned in literal-string order,
 * which is not instant order.
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
  const transports = await db.transports
    .where('[tripId+datetime]')
    .between([tripId, ''], [tripId, '\uffff'])
    .toArray();

  return toCanonicalRows(transports);
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

  return toCanonicalRows(transports);
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

  return toCanonicalRows(transports);
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

  return toCanonicalRows(transports);
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
  const transport = await db.transports.get(id);

  return transport === undefined ? undefined : toCanonicalRow(transport);
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
  if (sanitizedData.datetime !== undefined) {
    sanitizedData.datetime = requireCanonicalDatetime(sanitizedData.datetime);
  }
  if (sanitizedData.location !== undefined) {
    sanitizedData.location = sanitizeTransportData({
      location: sanitizedData.location,
      type: 'arrival',
      personId: '' as PersonId,
      datetime: '',
      needsPickup: false,
    }).location;
  }
  if (sanitizedData.startLocation !== undefined) {
    sanitizedData.startLocation = sanitizeTransportData({
      location: '',
      startLocation: sanitizedData.startLocation,
      type: 'arrival',
      personId: '' as PersonId,
      datetime: '',
      needsPickup: false,
    }).startLocation;
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
  // The cutoff is normalised too: a caller may pass a local-shaped value, and
  // comparing that against canonical rows would be the same category of bug.
  // `||`, not `??`: an empty string is a cleared filter, not a cutoff of "the
  // epoch", and normalising it would throw.
  const now = requireCanonicalDatetime(fromDatetime || new Date().toISOString()),

   transports = await db.transports
    .where('tripId')
    .equals(tripId)
    .filter((t) => t.needsPickup)
    .toArray();

  // Coerce before comparing: a legacy row's stored characters do not order
  // against an ISO instant, so filtering on the raw value drops or keeps the
  // wrong rows.
  return sortByInstant(
    transports.map(toCanonicalRow).filter((t) => t.datetime >= now),
  );
}

/**
 * Gets transports for a trip on a specific UTC date.
 *
 * The day is taken from the canonical instant, so the bucket a row falls in
 * does not depend on which writer produced it.
 *
 * @param tripId - The trip ID to search within
 * @param date - The UTC date to filter by (YYYY-MM-DD)
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
  const transports = await db.transports
    .where('tripId')
    .equals(tripId)
    .toArray();

  // Match on the canonical instant, not the stored characters: the day of a
  // row is its UTC day for every row or for none, never per representation.
  return sortByInstant(
    transports.map(toCanonicalRow).filter((t) => t.datetime.startsWith(date)),
  );
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

  return toCanonicalRows(transports);
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

    // Naming a driver on the leg takes it out of any shared car it was in.
    //
    // `setTransportRide` clears the leg's `driverId` when it joins a ride, so
    // that a leg never names two drivers. This is the other half of that rule,
    // and without it the invariant was simply false: put Alice's arrival in
    // Guillaume's car, then open the same arrival and pick Bob as her driver,
    // and the row carried both. `resolveRides` lets the ride win, so the trip
    // showed Guillaume while any surface reading the leg showed Bob — and if the
    // ride had no driver at all, `isLegCovered` reported Alice as covered by Bob
    // while the ride card still read "nobody driving yet".
    //
    // Only a *truthy* driver detaches. A form that saves an unrelated edit sends
    // `driverId: undefined` for a leg whose driver lives on its ride, and that
    // must not quietly remove the passenger from the car — which is why this
    // tests the value rather than the key's presence.
    const detachesFromRide = Boolean(data.driverId);

    await db.transports.update(id, {
      ...data,
      ...(data.datetime === undefined
        ? {}
        : { datetime: requireCanonicalDatetime(data.datetime) }),
      ...(detachesFromRide ? { rideId: undefined } : {}),
    });
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
