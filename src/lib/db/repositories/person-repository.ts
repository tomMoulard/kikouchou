/**
 * Person Repository
 *
 * Provides CRUD operations for Person entities with automatic color assignment.
 * All operations use the Dexie.js database and branded types for type safety.
 *
 * @module lib/db/repositories/person-repository
 */

import { db } from '@/lib/db/database';
import { createPersonId } from '@/lib/db/utils';
import type { Person, PersonFormData, PersonId, TripId } from '@/types';
import { getDefaultPersonColor } from '@/types';

/**
 * Creates a new person in the database.
 *
 * @param tripId - The trip this person belongs to
 * @param data - The person form data (name, color)
 * @returns The created Person object
 *
 * @example
 * ```typescript
 * const person = await createPerson(tripId, {
 *   name: 'Marie',
 *   color: '#ef4444',
 * });
 * ```
 */
export async function createPerson(
  tripId: TripId,
  data: PersonFormData,
): Promise<Person> {
  const person: Person = {
    id: createPersonId(),
    tripId,
    ...data,
  };

  await db.persons.add(person);
  return person;
}

/**
 * Creates a new person with an automatically assigned color.
 *
 * The color is selected from the default palette based on the current
 * number of persons in the trip, cycling through if needed.
 *
 * @param tripId - The trip this person belongs to
 * @param name - The person's display name
 * @returns The created Person object with auto-assigned color
 *
 * @example
 * ```typescript
 * const person = await createPersonWithAutoColor(tripId, 'Marie');
 * // Color is automatically assigned
 * ```
 */
export async function createPersonWithAutoColor(
  tripId: TripId,
  name: string,
): Promise<Person> {
  const existingCount = await db.persons.where('tripId').equals(tripId).count(),
   color = getDefaultPersonColor(existingCount);

  return createPerson(tripId, { name, color });
}

/**
 * Retrieves all persons for a trip, ordered by name.
 *
 * Uses the compound index [tripId+name] for efficient querying.
 *
 * @param tripId - The trip ID to filter by
 * @returns Array of persons sorted by name ascending
 *
 * @example
 * ```typescript
 * const persons = await getPersonsByTripId(tripId);
 * ```
 */
export async function getPersonsByTripId(tripId: TripId): Promise<Person[]> {
  return db.persons.where('[tripId+name]').between([tripId, ''], [tripId, '\uffff']).toArray();
}

/**
 * Retrieves a person by their unique ID.
 *
 * @param id - The person's unique identifier
 * @returns The person if found, undefined otherwise
 *
 * @example
 * ```typescript
 * const person = await getPersonById(personId);
 * if (person) {
 *   console.log(person.name);
 * }
 * ```
 */
export async function getPersonById(id: PersonId): Promise<Person | undefined> {
  return db.persons.get(id);
}

/**
 * Updates an existing person with partial data.
 *
 * Only the provided fields in `data` are updated.
 *
 * @param id - The person's unique identifier
 * @param data - Partial person form data to update
 * @throws {Error} If the person with the given ID does not exist
 *
 * @example
 * ```typescript
 * await updatePerson(personId, { name: 'New Name' });
 * await updatePerson(personId, { color: '#3b82f6' });
 * ```
 */
export async function updatePerson(
  id: PersonId,
  data: Partial<PersonFormData>,
): Promise<void> {
  const updatedCount = await db.persons.update(id, data);

  if (updatedCount === 0) {
    throw new Error(`Person with id "${id}" not found`);
  }
}

/**
 * Deletes a person and all their associated data.
 *
 * Removes in a single atomic transaction:
 * - Room assignments for this person
 * - Transports (arrivals/departures) for this person
 * - The person record itself
 *
 * Also clears driverId references in transports where this person was the driver.
 *
 * @param id - The person's unique identifier
 *
 * @example
 * ```typescript
 * await deletePerson(personId);
 * // Person, their assignments, and transports are deleted
 * ```
 */
export async function deletePerson(id: PersonId): Promise<void> {
  await db.transaction(
    'rw',
    [db.persons, db.roomAssignments, db.transports],
    async () => {
      // Delete related records in parallel
      await Promise.all([
        // Delete room assignments for this person
        db.roomAssignments.where('personId').equals(id).delete(),

        // Delete transports for this person
        db.transports.where('personId').equals(id).delete(),

        // Clear driverId references where this person was the driver
        db.transports
          .where('driverId')
          .equals(id)
          .modify({ driverId: undefined }),
      ]);

      // Delete the person
      await db.persons.delete(id);
    },
  );
}

/**
 * Gets the count of persons for a trip.
 *
 * @param tripId - The trip ID to count persons for
 * @returns Number of persons in the trip
 *
 * @example
 * ```typescript
 * const count = await getPersonCount(tripId);
 * ```
 */
export async function getPersonCount(tripId: TripId): Promise<number> {
  return db.persons.where('tripId').equals(tripId).count();
}

/**
 * Searches for persons by name within a trip.
 *
 * Case-insensitive partial match search.
 *
 * @param tripId - The trip ID to search within
 * @param query - The search query string
 * @returns Array of matching persons
 *
 * @example
 * ```typescript
 * const results = await searchPersonsByName(tripId, 'mar');
 * // Returns persons like "Marie", "Marc", etc.
 * ```
 */
export async function searchPersonsByName(
  tripId: TripId,
  query: string,
): Promise<Person[]> {
  const lowerQuery = query.toLowerCase();
  return db.persons
    .where('tripId')
    .equals(tripId)
    .filter((person) => person.name.toLowerCase().includes(lowerQuery))
    .toArray();
}

// ============================================================================
// Transactional Operations with Ownership Validation (CR-2 fix)
// ============================================================================

/**
 * Updates a person with ownership validation in a single transaction.
 * Prevents TOCTOU race condition by combining validation and mutation atomically.
 *
 * @param id - The person's unique identifier
 * @param tripId - The expected trip ID for ownership validation
 * @param data - Partial person form data to update
 * @throws {Error} If person not found or doesn't belong to the specified trip
 *
 * @example
 * ```typescript
 * await updatePersonWithOwnershipCheck(personId, currentTripId, { name: 'New Name' });
 * ```
 */
export async function updatePersonWithOwnershipCheck(
  id: PersonId,
  tripId: TripId,
  data: Partial<PersonFormData>,
): Promise<void> {
  await db.transaction('rw', db.persons, async () => {
    const person = await db.persons.get(id);

    if (!person) {
      throw new Error(`Person with ID "${id}" not found`);
    }
    if (person.tripId !== tripId) {
      throw new Error('Cannot update person: person does not belong to current trip');
    }

    await db.persons.update(id, data);
  });
}

/**
 * Deletes a person with ownership validation in a single transaction.
 * Prevents TOCTOU race condition by combining validation and deletion atomically.
 * Also deletes associated room assignments and transports.
 *
 * @param id - The person's unique identifier
 * @param tripId - The expected trip ID for ownership validation
 * @throws {Error} If person not found or doesn't belong to the specified trip
 *
 * @example
 * ```typescript
 * await deletePersonWithOwnershipCheck(personId, currentTripId);
 * ```
 */
export async function deletePersonWithOwnershipCheck(
  id: PersonId,
  tripId: TripId,
): Promise<void> {
  await db.transaction(
    'rw',
    [db.persons, db.roomAssignments, db.transports],
    async () => {
      const person = await db.persons.get(id);

      if (!person) {
        throw new Error(`Person with ID "${id}" not found`);
      }
      if (person.tripId !== tripId) {
        throw new Error('Cannot delete person: person does not belong to current trip');
      }

      // Delete related records in parallel
      await Promise.all([
        // Delete room assignments for this person
        db.roomAssignments.where('personId').equals(id).delete(),

        // Delete transports for this person
        db.transports.where('personId').equals(id).delete(),

        // Clear driverId references where this person was the driver
        db.transports
          .where('driverId')
          .equals(id)
          .modify({ driverId: undefined }),
      ]);

      // Delete the person
      await db.persons.delete(id);
    },
  );
}
