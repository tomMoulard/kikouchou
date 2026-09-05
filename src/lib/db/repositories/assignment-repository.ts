/**
 * Room Assignment Repository
 *
 * Provides CRUD operations for RoomAssignment entities with conflict detection.
 * All operations use the Dexie.js database and branded types for type safety.
 *
 * @module lib/db/repositories/assignment-repository
 */

import { db } from '@/lib/db/database';
import { createRoomAssignmentId } from '@/lib/db/utils';
import type {
  ISODateString,
  PersonId,
  RoomAssignment,
  RoomAssignmentFormData,
  RoomAssignmentId,
  RoomId,
  TripId,
} from '@/types';

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Validates that an assignment's date range is valid (startDate <= endDate).
 *
 * @param startDate - The start date (YYYY-MM-DD)
 * @param endDate - The end date (YYYY-MM-DD)
 * @throws {Error} If startDate is after endDate
 */
function validateDateRange(startDate: ISODateString, endDate: ISODateString): void {
  if (startDate > endDate) {
    throw new Error(
      `Invalid date range: start date (${startDate}) must be on or before end date (${endDate})`,
    );
  }
}

/**
 * Creates a new room assignment in the database.
 *
 * @param tripId - The trip this assignment belongs to
 * @param data - The assignment form data (roomId, personId, startDate, endDate)
 * @returns The created RoomAssignment object
 *
 * @example
 * ```typescript
 * const assignment = await createAssignment(tripId, {
 *   roomId,
 *   personId,
 *   startDate: '2024-07-15',
 *   endDate: '2024-07-19',
 * });
 * ```
 */
export async function createAssignment(
  tripId: TripId,
  data: RoomAssignmentFormData,
): Promise<RoomAssignment> {
  // Validate date range before creating
  validateDateRange(data.startDate, data.endDate);

  try {
    const assignment: RoomAssignment = {
      id: createRoomAssignmentId(),
      tripId,
      ...data,
    };

    await db.roomAssignments.add(assignment);
    return assignment;
  } catch (error) {
    throw new Error(
      `Failed to create assignment for person ${data.personId} in room ${data.roomId} (${data.startDate} to ${data.endDate})`,
      { cause: error },
    );
  }
}

/**
 * Retrieves all assignments for a trip.
 *
 * @param tripId - The trip ID to filter by
 * @returns Array of room assignments
 *
 * @example
 * ```typescript
 * const assignments = await getAssignmentsByTripId(tripId);
 * ```
 */
export async function getAssignmentsByTripId(
  tripId: TripId,
): Promise<RoomAssignment[]> {
  return db.roomAssignments.where('tripId').equals(tripId).toArray();
}

/**
 * Retrieves all assignments for a specific room.
 *
 * @param roomId - The room ID to filter by
 * @returns Array of assignments for the room, sorted by start date
 *
 * @example
 * ```typescript
 * const assignments = await getAssignmentsByRoomId(roomId);
 * ```
 */
export async function getAssignmentsByRoomId(
  roomId: RoomId,
): Promise<RoomAssignment[]> {
  const assignments = await db.roomAssignments
    .where('roomId')
    .equals(roomId)
    .toArray();

  // Sort by startDate
  return assignments.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/**
 * Retrieves all assignments for a specific person.
 *
 * @param personId - The person ID to filter by
 * @returns Array of assignments for the person, sorted by start date
 *
 * @example
 * ```typescript
 * const assignments = await getAssignmentsByPersonId(personId);
 * ```
 */
export async function getAssignmentsByPersonId(
  personId: PersonId,
): Promise<RoomAssignment[]> {
  const assignments = await db.roomAssignments
    .where('personId')
    .equals(personId)
    .toArray();

  // Sort by startDate
  return assignments.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/**
 * Retrieves an assignment by its unique ID.
 *
 * @param id - The assignment's unique identifier
 * @returns The assignment if found, undefined otherwise
 *
 * @example
 * ```typescript
 * const assignment = await getAssignmentById(assignmentId);
 * ```
 */
export async function getAssignmentById(
  id: RoomAssignmentId,
): Promise<RoomAssignment | undefined> {
  return db.roomAssignments.get(id);
}

/**
 * Updates an existing assignment with partial data.
 *
 * @deprecated Use {@link updateAssignmentWithOwnershipCheck} instead.
 * This function will be removed in a future version.
 *
 * @param id - The assignment's unique identifier
 * @param data - Partial assignment form data to update
 * @throws {Error} If the assignment with the given ID does not exist
 *
 * @example
 * ```typescript
 * await updateAssignment(assignmentId, {
 *   startDate: '2024-07-16',
 *   endDate: '2024-07-20',
 * });
 * ```
 */
export async function updateAssignment(
  id: RoomAssignmentId,
  data: Partial<RoomAssignmentFormData>,
): Promise<void> {
  // Wrap in transaction to prevent TOCTOU race condition (CR-2 fix)
  await db.transaction('rw', db.roomAssignments, async () => {
    const assignment = await db.roomAssignments.get(id);
    if (!assignment) {
      throw new Error(`Assignment with id "${id}" not found`);
    }

    // If updating dates, validate the resulting date range
    if (data.startDate !== undefined || data.endDate !== undefined) {
      const finalStartDate = data.startDate ?? assignment.startDate;
      const finalEndDate = data.endDate ?? assignment.endDate;
      validateDateRange(finalStartDate, finalEndDate);
    }

    await db.roomAssignments.update(id, data);
  });
}

/**
 * Deletes a room assignment.
 *
 * @deprecated Use {@link deleteAssignmentWithOwnershipCheck} instead.
 * This function will be removed in a future version.
 *
 * @param id - The assignment's unique identifier
 *
 * @example
 * ```typescript
 * await deleteAssignment(assignmentId);
 * ```
 */
export async function deleteAssignment(id: RoomAssignmentId): Promise<void> {
  try {
    await db.roomAssignments.delete(id);
  } catch (error) {
    throw new Error(`Failed to delete assignment ${id}`, { cause: error });
  }
}

/**
 * Checks if a person has any conflicting assignments for the given date range.
 *
 * A conflict exists when the person is already assigned to another room
 * for any overlapping dates. Uses inclusive date comparison.
 *
 * @param tripId - The trip ID to search within
 * @param personId - The person to check for conflicts
 * @param startDate - Start date of the proposed assignment (YYYY-MM-DD)
 * @param endDate - End date of the proposed assignment (YYYY-MM-DD)
 * @param excludeId - Optional assignment ID to exclude (for edit scenarios)
 * @returns True if a conflict exists, false otherwise
 *
 * @example
 * ```typescript
 * // Check before creating assignment
 * const hasConflict = await checkAssignmentConflict(
 *   tripId,
 *   personId,
 *   '2024-07-15',
 *   '2024-07-19',
 * );
 *
 * // Check when editing (exclude current assignment)
 * const hasConflict = await checkAssignmentConflict(
 *   tripId,
 *   personId,
 *   '2024-07-15',
 *   '2024-07-19',
 *   currentAssignmentId,
 * );
 * ```
 */
export async function checkAssignmentConflict(
  tripId: TripId,
  personId: PersonId,
  startDate: string,
  endDate: string,
  excludeId?: RoomAssignmentId,
): Promise<boolean> {
  // Get all assignments for this person in this trip using compound index
  const assignments = await db.roomAssignments
    .where('[tripId+personId]')
    .equals([tripId, personId])
    .toArray();

  // Check for overlapping date ranges
  // Two ranges overlap if: start1 <= end2 AND end1 >= start2
  for (const existing of assignments) {
    // Skip the excluded assignment (when editing)
    if (excludeId && existing.id === excludeId) {
      continue;
    }

    // Check for overlap using string comparison (works for ISO dates)
    const overlaps =
      startDate <= existing.endDate && endDate >= existing.startDate;

    if (overlaps) {
      return true;
    }
  }

  return false;
}

/**
 * Gets all assignments for a trip that overlap with a specific date.
 *
 * Useful for getting current room assignments for "today" view.
 *
 * Uses the [tripId+startDate] compound index to efficiently pre-filter
 * assignments that have started by the target date, then applies a
 * client-side filter for endDate >= date. (CR-11 optimization)
 *
 * @param tripId - The trip ID to search within
 * @param date - The date to check (YYYY-MM-DD)
 * @returns Array of assignments active on the given date
 *
 * @example
 * ```typescript
 * const todayAssignments = await getAssignmentsForDate(tripId, '2024-07-17');
 * ```
 */
export async function getAssignmentsForDate(
  tripId: TripId,
  date: string,
): Promise<RoomAssignment[]> {
  // Use compound index to get assignments where startDate <= date
  // This is more efficient than scanning all trip assignments
  return db.roomAssignments
    .where('[tripId+startDate]')
    .between([tripId, ''], [tripId, date], true, true) // startDate <= date
    .filter((a) => a.endDate >= date) // Then filter for endDate >= date
    .toArray();
}

/**
 * Gets the count of assignments for a trip.
 *
 * @param tripId - The trip ID to count assignments for
 * @returns Number of assignments in the trip
 *
 * @example
 * ```typescript
 * const count = await getAssignmentCount(tripId);
 * ```
 */
export async function getAssignmentCount(tripId: TripId): Promise<number> {
  return db.roomAssignments.where('tripId').equals(tripId).count();
}

// ============================================================================
// Transactional Operations with Ownership Validation (CR-2 fix)
// ============================================================================

/**
 * Updates an assignment with ownership validation in a single transaction.
 * Prevents TOCTOU race condition by combining validation and mutation atomically.
 *
 * @param id - The assignment's unique identifier
 * @param tripId - The expected trip ID for ownership validation
 * @param data - Partial assignment form data to update
 * @throws {Error} If assignment not found or doesn't belong to the specified trip
 *
 * @example
 * ```typescript
 * await updateAssignmentWithOwnershipCheck(assignmentId, currentTripId, {
 *   startDate: '2024-07-15',
 *   endDate: '2024-07-20',
 * });
 * ```
 */
export async function updateAssignmentWithOwnershipCheck(
  id: RoomAssignmentId,
  tripId: TripId,
  data: Partial<RoomAssignmentFormData>,
): Promise<void> {
  await db.transaction('rw', db.roomAssignments, async () => {
    const assignment = await db.roomAssignments.get(id);

    if (!assignment) {
      throw new Error(`Assignment with ID "${id}" not found`);
    }
    if (assignment.tripId !== tripId) {
      throw new Error('Cannot update assignment: assignment does not belong to current trip');
    }

    // Validate the resulting date range after partial update
    const finalStartDate = data.startDate ?? assignment.startDate;
    const finalEndDate = data.endDate ?? assignment.endDate;
    validateDateRange(finalStartDate, finalEndDate);

    await db.roomAssignments.update(id, data);
  });
}

/**
 * Deletes an assignment with ownership validation in a single transaction.
 * Prevents TOCTOU race condition by combining validation and deletion atomically.
 *
 * @param id - The assignment's unique identifier
 * @param tripId - The expected trip ID for ownership validation
 * @throws {Error} If assignment not found or doesn't belong to the specified trip
 *
 * @example
 * ```typescript
 * await deleteAssignmentWithOwnershipCheck(assignmentId, currentTripId);
 * ```
 */
export async function deleteAssignmentWithOwnershipCheck(
  id: RoomAssignmentId,
  tripId: TripId,
): Promise<void> {
  await db.transaction('rw', db.roomAssignments, async () => {
    const assignment = await db.roomAssignments.get(id);

    if (!assignment) {
      throw new Error(`Assignment with ID "${id}" not found`);
    }
    if (assignment.tripId !== tripId) {
      throw new Error('Cannot delete assignment: assignment does not belong to current trip');
    }

    await db.roomAssignments.delete(id);
  });
}
