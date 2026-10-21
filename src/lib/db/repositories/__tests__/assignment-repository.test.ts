/**
 * Integration tests for Assignment Repository
 *
 * Tests CRUD operations and conflict detection for room assignments.
 * The checkAssignmentConflict function is CRITICAL for preventing
 * double-booking of persons to rooms.
 *
 * @module lib/db/repositories/__tests__/assignment-repository.test
 */
import { describe, it, expect, vi } from 'vitest';
import { db } from '@/lib/db/database';
import {
  createAssignment,
  getAssignmentsByTripId,
  getAssignmentsByRoomId,
  getAssignmentsByPersonId,
  getAssignmentById,
  updateAssignment,
  deleteAssignment,
  checkAssignmentConflict,
  getAssignmentsForDate,
  getAssignmentCount,
  updateAssignmentWithOwnershipCheck,
  deleteAssignmentWithOwnershipCheck,
} from '@/lib/db/repositories/assignment-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { createRoom } from '@/lib/db/repositories/room-repository';
import { createPerson } from '@/lib/db/repositories/person-repository';
import type {
  PersonId,
  RoomAssignmentFormData,
  RoomAssignmentId,
  RoomId,
  TripId,
} from '@/types';
import { isoDate, hexColor } from '@/test/utils';

// ============================================================================
// Test Data Factories
// ============================================================================

/**
 * Creates a test trip and returns its ID.
 */
async function createTestTrip(name = 'Test Trip'): Promise<TripId> {
  const trip = await createTrip({
    name,
    startDate: isoDate('2024-07-15'),
    endDate: isoDate('2024-07-30'),
  });
  return trip.id;
}

/**
 * Creates a test room and returns its ID.
 */
async function createTestRoom(
  tripId: TripId,
  name = 'Test Room'
): Promise<RoomId> {
  const room = await createRoom(tripId, { name, capacity: 2 });
  return room.id;
}

/**
 * Creates a test person and returns their ID.
 */
async function createTestPerson(
  tripId: TripId,
  name = 'Test Person'
): Promise<PersonId> {
  const person = await createPerson(tripId, { name, color: hexColor('#ef4444') });
  return person.id;
}

/**
 * Creates valid assignment form data with optional overrides.
 */
function createTestAssignmentData(
  roomId: RoomId,
  personId: PersonId,
  overrides?: Partial<RoomAssignmentFormData>
): RoomAssignmentFormData {
  return {
    roomId,
    personId,
    startDate: isoDate('2024-07-15'),
    endDate: isoDate('2024-07-20'),
    ...overrides,
  };
}

// ============================================================================
// Test Setup
// ============================================================================

// Note: Database clearing and mock restoration are handled by global setup.ts
// - beforeEach clears all 6 tables
// - afterEach calls cleanup() and vi.clearAllMocks()

// ============================================================================
// createAssignment Tests
// ============================================================================

describe('createAssignment', () => {
  it('creates assignment with all form data fields', async () => {
    const tripId = await createTestTrip();
    const roomId = await createTestRoom(tripId);
    const personId = await createTestPerson(tripId);

    const assignment = await createAssignment(
      tripId,
      createTestAssignmentData(roomId, personId, {
        startDate: isoDate('2024-07-16'),
        endDate: isoDate('2024-07-19'),
      })
    );

    expect(assignment.tripId).toBe(tripId);
    expect(assignment.roomId).toBe(roomId);
    expect(assignment.personId).toBe(personId);
    expect(assignment.startDate).toBe('2024-07-16');
    expect(assignment.endDate).toBe('2024-07-19');
  });

  it('generates unique assignment IDs', async () => {
    const tripId = await createTestTrip();
    const roomId = await createTestRoom(tripId);
    const personId = await createTestPerson(tripId);

    const assignment1 = await createAssignment(
      tripId,
      createTestAssignmentData(roomId, personId, {
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-17'),
      })
    );
    const assignment2 = await createAssignment(
      tripId,
      createTestAssignmentData(roomId, personId, {
        startDate: isoDate('2024-07-18'),
        endDate: isoDate('2024-07-20'),
      })
    );

    expect(assignment1.id).not.toBe(assignment2.id);
  });

  it('persists assignment to database', async () => {
    const tripId = await createTestTrip();
    const roomId = await createTestRoom(tripId);
    const personId = await createTestPerson(tripId);

    const assignment = await createAssignment(
      tripId,
      createTestAssignmentData(roomId, personId)
    );

    const retrieved = await getAssignmentById(assignment.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(assignment.id);
  });

  it('associates assignment with correct tripId', async () => {
    const tripId1 = await createTestTrip('Trip 1');
    const tripId2 = await createTestTrip('Trip 2');
    const room1 = await createTestRoom(tripId1);
    const room2 = await createTestRoom(tripId2);
    const person1 = await createTestPerson(tripId1);
    const person2 = await createTestPerson(tripId2);

    const assignment1 = await createAssignment(
      tripId1,
      createTestAssignmentData(room1, person1)
    );
    const assignment2 = await createAssignment(
      tripId2,
      createTestAssignmentData(room2, person2)
    );

    expect(assignment1.tripId).toBe(tripId1);
    expect(assignment2.tripId).toBe(tripId2);
  });

  it('throws error when startDate is after endDate', async () => {
    const tripId = await createTestTrip();
    const roomId = await createTestRoom(tripId);
    const personId = await createTestPerson(tripId);

    await expect(
      createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-07-20'), // After endDate
        endDate: isoDate('2024-07-15'),
      })
    ).rejects.toThrow('Invalid date range: start date (2024-07-20) must be on or before end date (2024-07-15)');
  });

  it('allows same-day assignments (startDate equals endDate)', async () => {
    const tripId = await createTestTrip();
    const roomId = await createTestRoom(tripId);
    const personId = await createTestPerson(tripId);

    const assignment = await createAssignment(tripId, {
      roomId,
      personId,
      startDate: isoDate('2024-07-20'),
      endDate: isoDate('2024-07-20'), // Same as start date
    });

    expect(assignment.startDate).toBe('2024-07-20');
    expect(assignment.endDate).toBe('2024-07-20');
  });
});

// ============================================================================
// getAssignmentsByTripId Tests
// ============================================================================

describe('getAssignmentsByTripId', () => {
  it('returns all assignments for a trip', async () => {
    const tripId = await createTestTrip();
    const roomId = await createTestRoom(tripId);
    const person1 = await createTestPerson(tripId, 'Person 1');
    const person2 = await createTestPerson(tripId, 'Person 2');

    await createAssignment(
      tripId,
      createTestAssignmentData(roomId, person1, {
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-17'),
      })
    );
    await createAssignment(
      tripId,
      createTestAssignmentData(roomId, person2, {
        startDate: isoDate('2024-07-18'),
        endDate: isoDate('2024-07-20'),
      })
    );

    const assignments = await getAssignmentsByTripId(tripId);

    expect(assignments).toHaveLength(2);
  });

  it('returns empty array for non-existent trip', async () => {
    const nonExistentTripId = 'trip_does_not_exist' as TripId;

    const assignments = await getAssignmentsByTripId(nonExistentTripId);

    expect(assignments).toEqual([]);
  });

  it('returns empty array for trip with no assignments', async () => {
    const tripId = await createTestTrip();

    const assignments = await getAssignmentsByTripId(tripId);

    expect(assignments).toEqual([]);
  });

  it('only returns assignments for specified trip', async () => {
    const tripId1 = await createTestTrip('Trip 1');
    const tripId2 = await createTestTrip('Trip 2');
    const room1 = await createTestRoom(tripId1);
    const room2 = await createTestRoom(tripId2);
    const person1 = await createTestPerson(tripId1);
    const person2 = await createTestPerson(tripId2);

    await createAssignment(tripId1, createTestAssignmentData(room1, person1));
    await createAssignment(tripId2, createTestAssignmentData(room2, person2));

    const assignmentsTrip1 = await getAssignmentsByTripId(tripId1);
    const assignmentsTrip2 = await getAssignmentsByTripId(tripId2);

    expect(assignmentsTrip1).toHaveLength(1);
    expect(assignmentsTrip2).toHaveLength(1);
    expect(assignmentsTrip1[0]?.tripId).toBe(tripId1);
    expect(assignmentsTrip2[0]?.tripId).toBe(tripId2);
  });
});

// ============================================================================
// getAssignmentsByRoomId Tests
// ============================================================================

describe('getAssignmentsByRoomId', () => {
  it('returns assignments sorted by startDate ascending', async () => {
    const tripId = await createTestTrip();
    const roomId = await createTestRoom(tripId);
    const person1 = await createTestPerson(tripId, 'Person 1');
    const person2 = await createTestPerson(tripId, 'Person 2');
    const person3 = await createTestPerson(tripId, 'Person 3');

    // Create in non-chronological order
    await createAssignment(
      tripId,
      createTestAssignmentData(roomId, person2, {
        startDate: isoDate('2024-07-20'),
        endDate: isoDate('2024-07-22'),
      })
    );
    await createAssignment(
      tripId,
      createTestAssignmentData(roomId, person1, {
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-17'),
      })
    );
    await createAssignment(
      tripId,
      createTestAssignmentData(roomId, person3, {
        startDate: isoDate('2024-07-18'),
        endDate: isoDate('2024-07-19'),
      })
    );

    const assignments = await getAssignmentsByRoomId(roomId);

    expect(assignments).toHaveLength(3);
    expect(assignments[0]?.startDate).toBe('2024-07-15');
    expect(assignments[1]?.startDate).toBe('2024-07-18');
    expect(assignments[2]?.startDate).toBe('2024-07-20');
  });

  it('returns empty array for room with no assignments', async () => {
    const tripId = await createTestTrip();
    const roomId = await createTestRoom(tripId);

    const assignments = await getAssignmentsByRoomId(roomId);

    expect(assignments).toEqual([]);
  });

  it('only returns assignments for specified room', async () => {
    const tripId = await createTestTrip();
    const room1 = await createTestRoom(tripId, 'Room 1');
    const room2 = await createTestRoom(tripId, 'Room 2');
    const personId = await createTestPerson(tripId);

    await createAssignment(
      tripId,
      createTestAssignmentData(room1, personId, {
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-17'),
      })
    );
    await createAssignment(
      tripId,
      createTestAssignmentData(room2, personId, {
        startDate: isoDate('2024-07-18'),
        endDate: isoDate('2024-07-20'),
      })
    );

    const assignmentsRoom1 = await getAssignmentsByRoomId(room1);
    const assignmentsRoom2 = await getAssignmentsByRoomId(room2);

    expect(assignmentsRoom1).toHaveLength(1);
    expect(assignmentsRoom2).toHaveLength(1);
    expect(assignmentsRoom1[0]?.roomId).toBe(room1);
    expect(assignmentsRoom2[0]?.roomId).toBe(room2);
  });
});

// ============================================================================
// getAssignmentsByPersonId Tests
// ============================================================================

describe('getAssignmentsByPersonId', () => {
  it('returns assignments sorted by startDate ascending', async () => {
    const tripId = await createTestTrip();
    const room1 = await createTestRoom(tripId, 'Room 1');
    const room2 = await createTestRoom(tripId, 'Room 2');
    const personId = await createTestPerson(tripId);

    // Create in non-chronological order
    await createAssignment(
      tripId,
      createTestAssignmentData(room2, personId, {
        startDate: isoDate('2024-07-20'),
        endDate: isoDate('2024-07-22'),
      })
    );
    await createAssignment(
      tripId,
      createTestAssignmentData(room1, personId, {
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-17'),
      })
    );

    const assignments = await getAssignmentsByPersonId(personId);

    expect(assignments).toHaveLength(2);
    expect(assignments[0]?.startDate).toBe('2024-07-15');
    expect(assignments[1]?.startDate).toBe('2024-07-20');
  });

  it('returns empty array for person with no assignments', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    const assignments = await getAssignmentsByPersonId(personId);

    expect(assignments).toEqual([]);
  });

  it('only returns assignments for specified person', async () => {
    const tripId = await createTestTrip();
    const roomId = await createTestRoom(tripId);
    const person1 = await createTestPerson(tripId, 'Person 1');
    const person2 = await createTestPerson(tripId, 'Person 2');

    await createAssignment(
      tripId,
      createTestAssignmentData(roomId, person1, {
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-17'),
      })
    );
    await createAssignment(
      tripId,
      createTestAssignmentData(roomId, person2, {
        startDate: isoDate('2024-07-18'),
        endDate: isoDate('2024-07-20'),
      })
    );

    const assignmentsPerson1 = await getAssignmentsByPersonId(person1);
    const assignmentsPerson2 = await getAssignmentsByPersonId(person2);

    expect(assignmentsPerson1).toHaveLength(1);
    expect(assignmentsPerson2).toHaveLength(1);
    expect(assignmentsPerson1[0]?.personId).toBe(person1);
    expect(assignmentsPerson2[0]?.personId).toBe(person2);
  });
});

// ============================================================================
// getAssignmentById Tests
// ============================================================================

describe('getAssignmentById', () => {
  it('returns assignment when found', async () => {
    const tripId = await createTestTrip();
    const roomId = await createTestRoom(tripId);
    const personId = await createTestPerson(tripId);

    const created = await createAssignment(
      tripId,
      createTestAssignmentData(roomId, personId)
    );

    const found = await getAssignmentById(created.id);

    expect(found).toBeDefined();
    expect(found?.id).toBe(created.id);
    expect(found?.roomId).toBe(roomId);
    expect(found?.personId).toBe(personId);
  });

  it('returns undefined for non-existent id', async () => {
    const nonExistentId = 'assignment_does_not_exist' as RoomAssignmentId;

    const found = await getAssignmentById(nonExistentId);

    expect(found).toBeUndefined();
  });
});

// ============================================================================
// updateAssignment Tests
// ============================================================================

describe('updateAssignment', () => {
  it('updates assignment properties', async () => {
    const tripId = await createTestTrip();
    const roomId = await createTestRoom(tripId);
    const personId = await createTestPerson(tripId);

    const assignment = await createAssignment(
      tripId,
      createTestAssignmentData(roomId, personId, {
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-20'),
      })
    );

    await updateAssignment(assignment.id, {
      startDate: isoDate('2024-07-16'),
      endDate: isoDate('2024-07-22'),
    });

    const updated = await getAssignmentById(assignment.id);
    expect(updated?.startDate).toBe('2024-07-16');
    expect(updated?.endDate).toBe('2024-07-22');
  });

  it('performs partial updates', async () => {
    const tripId = await createTestTrip();
    const roomId = await createTestRoom(tripId);
    const personId = await createTestPerson(tripId);

    const assignment = await createAssignment(
      tripId,
      createTestAssignmentData(roomId, personId, {
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-20'),
      })
    );

    // Only update endDate
    await updateAssignment(assignment.id, { endDate: isoDate('2024-07-22') });

    const updated = await getAssignmentById(assignment.id);
    expect(updated?.startDate).toBe('2024-07-15'); // Unchanged
    expect(updated?.endDate).toBe('2024-07-22');
  });

  it('updates room assignment', async () => {
    const tripId = await createTestTrip();
    const room1 = await createTestRoom(tripId, 'Room 1');
    const room2 = await createTestRoom(tripId, 'Room 2');
    const personId = await createTestPerson(tripId);

    const assignment = await createAssignment(
      tripId,
      createTestAssignmentData(room1, personId)
    );

    await updateAssignment(assignment.id, { roomId: room2 });

    const updated = await getAssignmentById(assignment.id);
    expect(updated?.roomId).toBe(room2);
  });

  it('throws error when assignment not found', async () => {
    const nonExistentId = 'assignment_does_not_exist' as RoomAssignmentId;

    await expect(
      updateAssignment(nonExistentId, { startDate: isoDate('2024-07-16') })
    ).rejects.toThrow(`Assignment with id "${nonExistentId}" not found`);
  });

  it('throws error when updating startDate to be after endDate', async () => {
    const tripId = await createTestTrip();
    const roomId = await createTestRoom(tripId);
    const personId = await createTestPerson(tripId);

    const assignment = await createAssignment(
      tripId,
      createTestAssignmentData(roomId, personId, {
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-20'),
      })
    );

    // Try to update startDate to after the current endDate
    await expect(
      updateAssignment(assignment.id, { startDate: isoDate('2024-07-25') })
    ).rejects.toThrow('Invalid date range');
  });

  it('throws error when updating endDate to be before startDate', async () => {
    const tripId = await createTestTrip();
    const roomId = await createTestRoom(tripId);
    const personId = await createTestPerson(tripId);

    const assignment = await createAssignment(
      tripId,
      createTestAssignmentData(roomId, personId, {
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-20'),
      })
    );

    // Try to update endDate to before the current startDate
    await expect(
      updateAssignment(assignment.id, { endDate: isoDate('2024-07-10') })
    ).rejects.toThrow('Invalid date range');
  });

  it('allows updating both dates together with valid range', async () => {
    const tripId = await createTestTrip();
    const roomId = await createTestRoom(tripId);
    const personId = await createTestPerson(tripId);

    const assignment = await createAssignment(
      tripId,
      createTestAssignmentData(roomId, personId, {
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-20'),
      })
    );

    // Update both dates together
    await updateAssignment(assignment.id, {
      startDate: isoDate('2024-07-25'),
      endDate: isoDate('2024-07-30'),
    });

    const updated = await getAssignmentById(assignment.id);
    expect(updated?.startDate).toBe('2024-07-25');
    expect(updated?.endDate).toBe('2024-07-30');
  });
});

// ============================================================================
// deleteAssignment Tests
// ============================================================================

describe('deleteAssignment', () => {
  it('deletes assignment from database', async () => {
    const tripId = await createTestTrip();
    const roomId = await createTestRoom(tripId);
    const personId = await createTestPerson(tripId);

    const assignment = await createAssignment(
      tripId,
      createTestAssignmentData(roomId, personId)
    );

    expect(await db.roomAssignments.count()).toBe(1);

    await deleteAssignment(assignment.id);

    expect(await db.roomAssignments.count()).toBe(0);
    expect(await getAssignmentById(assignment.id)).toBeUndefined();
  });

  it('is idempotent - deleting non-existent assignment does not throw', async () => {
    const nonExistentId = 'assignment_does_not_exist' as RoomAssignmentId;

    await expect(deleteAssignment(nonExistentId)).resolves.not.toThrow();
  });

  it('only deletes specified assignment', async () => {
    const tripId = await createTestTrip();
    const roomId = await createTestRoom(tripId);
    const person1 = await createTestPerson(tripId, 'Person 1');
    const person2 = await createTestPerson(tripId, 'Person 2');

    const assignment1 = await createAssignment(
      tripId,
      createTestAssignmentData(roomId, person1, {
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-17'),
      })
    );
    const assignment2 = await createAssignment(
      tripId,
      createTestAssignmentData(roomId, person2, {
        startDate: isoDate('2024-07-18'),
        endDate: isoDate('2024-07-20'),
      })
    );

    await deleteAssignment(assignment1.id);

    expect(await db.roomAssignments.count()).toBe(1);
    expect(await getAssignmentById(assignment2.id)).toBeDefined();
  });
});

// ============================================================================
// checkAssignmentConflict Tests (CRITICAL)
// ============================================================================

describe('checkAssignmentConflict', () => {
  // -------------------------------------------------------------------------
  // No Conflict Cases
  // -------------------------------------------------------------------------

  describe('No conflict cases', () => {
    it('returns false when no existing assignments', async () => {
      const tripId = await createTestTrip();
      const personId = await createTestPerson(tripId);

      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-15',
        '2024-07-20'
      );

      expect(hasConflict).toBe(false);
    });

    it('returns false when dates do not overlap - new before existing', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Existing: July 20-25
      await createAssignment(
        tripId,
        createTestAssignmentData(roomId, personId, {
          startDate: isoDate('2024-07-20'),
          endDate: isoDate('2024-07-25'),
        })
      );

      // New: July 15-19 (before existing)
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-15',
        '2024-07-19'
      );

      expect(hasConflict).toBe(false);
    });

    it('returns false when dates do not overlap - new after existing', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Existing: July 15-19
      await createAssignment(
        tripId,
        createTestAssignmentData(roomId, personId, {
          startDate: isoDate('2024-07-15'),
          endDate: isoDate('2024-07-19'),
        })
      );

      // New: July 20-25 (after existing)
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-20',
        '2024-07-25'
      );

      expect(hasConflict).toBe(false);
    });

    it('returns false when person has no other assignments', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const person1 = await createTestPerson(tripId, 'Person 1');
      const person2 = await createTestPerson(tripId, 'Person 2');

      // Existing assignment for person1
      await createAssignment(
        tripId,
        createTestAssignmentData(roomId, person1, {
          startDate: isoDate('2024-07-15'),
          endDate: isoDate('2024-07-20'),
        })
      );

      // Check conflict for person2 (has no assignments)
      const hasConflict = await checkAssignmentConflict(
        tripId,
        person2,
        '2024-07-15',
        '2024-07-20'
      );

      expect(hasConflict).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Conflict Cases
  // -------------------------------------------------------------------------

  describe('Conflict cases', () => {
    it('returns true when new assignment fully overlaps existing', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Existing: July 17-19
      await createAssignment(
        tripId,
        createTestAssignmentData(roomId, personId, {
          startDate: isoDate('2024-07-17'),
          endDate: isoDate('2024-07-19'),
        })
      );

      // New: July 15-22 (fully contains existing)
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-15',
        '2024-07-22'
      );

      expect(hasConflict).toBe(true);
    });

    it('returns true when new assignment partially overlaps start', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Existing: July 18-22
      await createAssignment(
        tripId,
        createTestAssignmentData(roomId, personId, {
          startDate: isoDate('2024-07-18'),
          endDate: isoDate('2024-07-22'),
        })
      );

      // New: July 15-19 (overlaps start of existing)
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-15',
        '2024-07-19'
      );

      expect(hasConflict).toBe(true);
    });

    it('returns true when new assignment partially overlaps end', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Existing: July 15-19
      await createAssignment(
        tripId,
        createTestAssignmentData(roomId, personId, {
          startDate: isoDate('2024-07-15'),
          endDate: isoDate('2024-07-19'),
        })
      );

      // New: July 18-22 (overlaps end of existing)
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-18',
        '2024-07-22'
      );

      expect(hasConflict).toBe(true);
    });

    it('returns true when new assignment is contained within existing', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Existing: July 15-25
      await createAssignment(
        tripId,
        createTestAssignmentData(roomId, personId, {
          startDate: isoDate('2024-07-15'),
          endDate: isoDate('2024-07-25'),
        })
      );

      // New: July 18-22 (fully within existing)
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-18',
        '2024-07-22'
      );

      expect(hasConflict).toBe(true);
    });

    it('returns true when new assignment contains existing', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Existing: July 18-20
      await createAssignment(
        tripId,
        createTestAssignmentData(roomId, personId, {
          startDate: isoDate('2024-07-18'),
          endDate: isoDate('2024-07-20'),
        })
      );

      // New: July 15-25 (contains existing)
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-15',
        '2024-07-25'
      );

      expect(hasConflict).toBe(true);
    });

    it('lets a guest move rooms on the day they check out', async () => {
      // The user-facing shape of the bug: Marie is in the Attic until the 5th
      // and wants the Barn from the 5th. One night in each, no night shared —
      // and the form told her she was already assigned for those dates.
      const tripId = await createTestTrip();
      const attic = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      await createAssignment(
        tripId,
        createTestAssignmentData(attic, personId, {
          startDate: isoDate('2024-07-01'),
          endDate: isoDate('2024-07-05'),
        })
      );

      expect(
        await checkAssignmentConflict(tripId, personId, '2024-07-05', '2024-07-09')
      ).toBe(false);

      // And a genuine double booking is still caught: back into the Attic on
      // the 4th, a night the existing stay already claims.
      expect(
        await checkAssignmentConflict(tripId, personId, '2024-07-04', '2024-07-09')
      ).toBe(true);
    });

    it('allows a room move on the check-out day - start', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Existing: July 15-19
      await createAssignment(
        tripId,
        createTestAssignmentData(roomId, personId, {
          startDate: isoDate('2024-07-15'),
          endDate: isoDate('2024-07-19'),
        })
      );

      // New: July 19-22, starting on the day the existing stay checks out.
      // `endDate` is the check-out day and not a night slept, so these two
      // share no night: the guest sleeps in the first room up to the 18th and
      // in the second from the 19th. Reported as a double booking, this refused
      // the ordinary room move.
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-19',
        '2024-07-22'
      );

      expect(hasConflict).toBe(false);
    });

    it('allows a room move on the check-out day - end', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Existing: July 20-25
      await createAssignment(
        tripId,
        createTestAssignmentData(roomId, personId, {
          startDate: isoDate('2024-07-20'),
          endDate: isoDate('2024-07-25'),
        })
      );

      // New: July 15-20, checking out on the day the existing stay checks in.
      // The mirror of the case above, and no night is shared either way.
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-15',
        '2024-07-20'
      );

      expect(hasConflict).toBe(false);
    });

    it('returns true when assignments are exactly the same dates', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Existing: July 15-20
      await createAssignment(
        tripId,
        createTestAssignmentData(roomId, personId, {
          startDate: isoDate('2024-07-15'),
          endDate: isoDate('2024-07-20'),
        })
      );

      // New: July 15-20 (exactly the same)
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-15',
        '2024-07-20'
      );

      expect(hasConflict).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Edge Cases
  // -------------------------------------------------------------------------

  describe('Edge cases', () => {
    it('excludes specified assignment ID from check (edit mode)', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Create existing assignment
      const existingAssignment = await createAssignment(
        tripId,
        createTestAssignmentData(roomId, personId, {
          startDate: isoDate('2024-07-15'),
          endDate: isoDate('2024-07-20'),
        })
      );

      // Check conflict for same dates, excluding the existing assignment
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-15',
        '2024-07-20',
        existingAssignment.id
      );

      expect(hasConflict).toBe(false);
    });

    it('still detects conflict when excludeId is for different assignment', async () => {
      const tripId = await createTestTrip();
      const room1 = await createTestRoom(tripId, 'Room 1');
      const room2 = await createTestRoom(tripId, 'Room 2');
      const personId = await createTestPerson(tripId);

      // Create two assignments
      const assignment1 = await createAssignment(
        tripId,
        createTestAssignmentData(room1, personId, {
          startDate: isoDate('2024-07-15'),
          endDate: isoDate('2024-07-20'),
        })
      );
      await createAssignment(
        tripId,
        createTestAssignmentData(room2, personId, {
          startDate: isoDate('2024-07-22'),
          endDate: isoDate('2024-07-25'),
        })
      );

      // Check conflict for dates overlapping assignment1, but exclude assignment1
      // Should still conflict if we try to add a new assignment overlapping assignment1's dates
      // Wait - this tests that excluding assignment1 only excludes assignment1
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-18',
        '2024-07-23', // Overlaps with assignment1 (18-20) but also assignment2 (22-23)
        assignment1.id // Exclude assignment1
      );

      // Should still detect conflict with assignment2
      expect(hasConflict).toBe(true);
    });

    it('only checks assignments for same person', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const person1 = await createTestPerson(tripId, 'Person 1');
      const person2 = await createTestPerson(tripId, 'Person 2');

      // Create assignment for person1
      await createAssignment(
        tripId,
        createTestAssignmentData(roomId, person1, {
          startDate: isoDate('2024-07-15'),
          endDate: isoDate('2024-07-20'),
        })
      );

      // Check conflict for person2 with same dates - should NOT conflict
      const hasConflict = await checkAssignmentConflict(
        tripId,
        person2,
        '2024-07-15',
        '2024-07-20'
      );

      expect(hasConflict).toBe(false);
    });

    it('does not flag different persons in same room', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const person1 = await createTestPerson(tripId, 'Person 1');
      const person2 = await createTestPerson(tripId, 'Person 2');

      // Create assignment for person1 in room
      await createAssignment(
        tripId,
        createTestAssignmentData(roomId, person1, {
          startDate: isoDate('2024-07-15'),
          endDate: isoDate('2024-07-20'),
        })
      );

      // Check conflict for person2 in same room, same dates
      // This should NOT be a conflict (same room is allowed, just not same person)
      const hasConflict = await checkAssignmentConflict(
        tripId,
        person2,
        '2024-07-15',
        '2024-07-20'
      );

      expect(hasConflict).toBe(false);
    });

    it('only checks within same trip', async () => {
      const tripId1 = await createTestTrip('Trip 1');
      const tripId2 = await createTestTrip('Trip 2');
      const room1 = await createTestRoom(tripId1);
      const person1 = await createTestPerson(tripId1);
      const person2 = await createTestPerson(tripId2);

      // Create assignment in trip1
      await createAssignment(
        tripId1,
        createTestAssignmentData(room1, person1, {
          startDate: isoDate('2024-07-15'),
          endDate: isoDate('2024-07-20'),
        })
      );

      // Check conflict in trip2 - different trip, different person
      const hasConflict = await checkAssignmentConflict(
        tripId2,
        person2,
        '2024-07-15',
        '2024-07-20'
      );

      expect(hasConflict).toBe(false);
    });

    it('handles multiple existing assignments correctly', async () => {
      const tripId = await createTestTrip();
      const room1 = await createTestRoom(tripId, 'Room 1');
      const room2 = await createTestRoom(tripId, 'Room 2');
      const personId = await createTestPerson(tripId);

      // Create two non-overlapping assignments
      await createAssignment(
        tripId,
        createTestAssignmentData(room1, personId, {
          startDate: isoDate('2024-07-15'),
          endDate: isoDate('2024-07-17'),
        })
      );
      await createAssignment(
        tripId,
        createTestAssignmentData(room2, personId, {
          startDate: isoDate('2024-07-22'),
          endDate: isoDate('2024-07-25'),
        })
      );

      // New assignment in the gap - no conflict
      const noConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-18',
        '2024-07-21'
      );
      expect(noConflict).toBe(false);

      // New assignment overlapping first - conflict
      const conflictFirst = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-16',
        '2024-07-18'
      );
      expect(conflictFirst).toBe(true);

      // New assignment overlapping second - conflict
      const conflictSecond = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-21',
        '2024-07-23'
      );
      expect(conflictSecond).toBe(true);

      // New assignment overlapping both - conflict
      const conflictBoth = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-16',
        '2024-07-23'
      );
      expect(conflictBoth).toBe(true);
    });

    it('treats a zero-night assignment as claiming nothing', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Single day assignment
      await createAssignment(
        tripId,
        createTestAssignmentData(roomId, personId, {
          startDate: isoDate('2024-07-17'),
          endDate: isoDate('2024-07-17'),
        })
      );

      // An assignment that checks in and out on the same day covers no night:
      // `listStayNights` returns nothing for it and every occupancy figure
      // already counts it as nobody. Reporting it as a conflict was the one
      // place in the app that read it as a stay.
      const exactConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-17',
        '2024-07-17'
      );
      expect(exactConflict).toBe(false);

      // A real stay running up to the 17th checks out that morning, so it
      // claims the nights of the 15th and 16th and still shares none with the
      // zero-night row above.
      const overlapConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-15',
        '2024-07-17'
      );
      expect(overlapConflict).toBe(false);

      // Day before - no conflict
      const beforeNoConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-16',
        '2024-07-16'
      );
      expect(beforeNoConflict).toBe(false);

      // Day after - no conflict
      const afterNoConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-18',
        '2024-07-18'
      );
      expect(afterNoConflict).toBe(false);
    });
  });
});

// ============================================================================
// getAssignmentsForDate Tests
// ============================================================================

describe('getAssignmentsForDate', () => {
  it('returns assignments that include the specified date', async () => {
    const tripId = await createTestTrip();
    const roomId = await createTestRoom(tripId);
    const personId = await createTestPerson(tripId);

    await createAssignment(
      tripId,
      createTestAssignmentData(roomId, personId, {
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-20'),
      })
    );

    const assignments = await getAssignmentsForDate(tripId, '2024-07-17');

    expect(assignments).toHaveLength(1);
  });

  it('returns assignment when date is on startDate', async () => {
    const tripId = await createTestTrip();
    const roomId = await createTestRoom(tripId);
    const personId = await createTestPerson(tripId);

    await createAssignment(
      tripId,
      createTestAssignmentData(roomId, personId, {
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-20'),
      })
    );

    const assignments = await getAssignmentsForDate(tripId, '2024-07-15');

    expect(assignments).toHaveLength(1);
  });

  it('returns assignment when date is on endDate', async () => {
    const tripId = await createTestTrip();
    const roomId = await createTestRoom(tripId);
    const personId = await createTestPerson(tripId);

    await createAssignment(
      tripId,
      createTestAssignmentData(roomId, personId, {
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-20'),
      })
    );

    const assignments = await getAssignmentsForDate(tripId, '2024-07-20');

    expect(assignments).toHaveLength(1);
  });

  it('returns empty array when date is before all assignments', async () => {
    const tripId = await createTestTrip();
    const roomId = await createTestRoom(tripId);
    const personId = await createTestPerson(tripId);

    await createAssignment(
      tripId,
      createTestAssignmentData(roomId, personId, {
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-20'),
      })
    );

    const assignments = await getAssignmentsForDate(tripId, '2024-07-10');

    expect(assignments).toEqual([]);
  });

  it('returns empty array when date is after all assignments', async () => {
    const tripId = await createTestTrip();
    const roomId = await createTestRoom(tripId);
    const personId = await createTestPerson(tripId);

    await createAssignment(
      tripId,
      createTestAssignmentData(roomId, personId, {
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-20'),
      })
    );

    const assignments = await getAssignmentsForDate(tripId, '2024-07-25');

    expect(assignments).toEqual([]);
  });

  it('returns multiple assignments for same date', async () => {
    const tripId = await createTestTrip();
    const roomId = await createTestRoom(tripId);
    const person1 = await createTestPerson(tripId, 'Person 1');
    const person2 = await createTestPerson(tripId, 'Person 2');

    await createAssignment(
      tripId,
      createTestAssignmentData(roomId, person1, {
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-20'),
      })
    );
    await createAssignment(
      tripId,
      createTestAssignmentData(roomId, person2, {
        startDate: isoDate('2024-07-17'),
        endDate: isoDate('2024-07-22'),
      })
    );

    const assignments = await getAssignmentsForDate(tripId, '2024-07-18');

    expect(assignments).toHaveLength(2);
  });

  it('only returns assignments for specified trip', async () => {
    const tripId1 = await createTestTrip('Trip 1');
    const tripId2 = await createTestTrip('Trip 2');
    const room1 = await createTestRoom(tripId1);
    const room2 = await createTestRoom(tripId2);
    const person1 = await createTestPerson(tripId1);
    const person2 = await createTestPerson(tripId2);

    await createAssignment(
      tripId1,
      createTestAssignmentData(room1, person1, {
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-20'),
      })
    );
    await createAssignment(
      tripId2,
      createTestAssignmentData(room2, person2, {
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-20'),
      })
    );

    const assignmentsTrip1 = await getAssignmentsForDate(tripId1, '2024-07-17');

    expect(assignmentsTrip1).toHaveLength(1);
    expect(assignmentsTrip1[0]?.tripId).toBe(tripId1);
  });
});

// ============================================================================
// getAssignmentCount Tests
// ============================================================================

describe('getAssignmentCount', () => {
  it('returns correct count for trip with assignments', async () => {
    const tripId = await createTestTrip();
    const roomId = await createTestRoom(tripId);
    const person1 = await createTestPerson(tripId, 'Person 1');
    const person2 = await createTestPerson(tripId, 'Person 2');

    await createAssignment(
      tripId,
      createTestAssignmentData(roomId, person1, {
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-17'),
      })
    );
    await createAssignment(
      tripId,
      createTestAssignmentData(roomId, person2, {
        startDate: isoDate('2024-07-18'),
        endDate: isoDate('2024-07-20'),
      })
    );

    const count = await getAssignmentCount(tripId);

    expect(count).toBe(2);
  });

  it('returns 0 for trip with no assignments', async () => {
    const tripId = await createTestTrip();

    const count = await getAssignmentCount(tripId);

    expect(count).toBe(0);
  });

  it('returns 0 for non-existent trip', async () => {
    const nonExistentTripId = 'trip_does_not_exist' as TripId;

    const count = await getAssignmentCount(nonExistentTripId);

    expect(count).toBe(0);
  });

  it('only counts assignments for specified trip', async () => {
    const tripId1 = await createTestTrip('Trip 1');
    const tripId2 = await createTestTrip('Trip 2');
    const room1 = await createTestRoom(tripId1);
    const room2 = await createTestRoom(tripId2);
    const person1 = await createTestPerson(tripId1);
    const person2 = await createTestPerson(tripId2);

    await createAssignment(tripId1, createTestAssignmentData(room1, person1));
    await createAssignment(tripId1, createTestAssignmentData(room1, person1, {
      startDate: isoDate('2024-07-21'),
      endDate: isoDate('2024-07-25'),
    }));
    await createAssignment(tripId2, createTestAssignmentData(room2, person2));

    const count1 = await getAssignmentCount(tripId1);
    const count2 = await getAssignmentCount(tripId2);

    expect(count1).toBe(2);
    expect(count2).toBe(1);
  });
});

describe('assignment-repository, in detail', () => {
  async function storeRaw(row: Record<string, unknown> & { readonly id: string }): Promise<RoomAssignmentId> {
    const assignment = {
      roomId: 'room-1',
      personId: 'person-1',
      startDate: '2024-07-15',
      endDate: '2024-07-20',
      ...row,
    };
    await db.roomAssignments.put(assignment as never);
    return assignment.id as RoomAssignmentId;
  }

  it('names the stay it failed to create', async () => {
    const tripId = await createTestTrip();
    vi.spyOn(db.roomAssignments, 'add').mockRejectedValueOnce(new Error('disk full'));

    await expect(
      createAssignment(tripId, createTestAssignmentData('room-1' as RoomId, 'person-1' as PersonId)),
    ).rejects.toThrow(
      'Failed to create assignment for person person-1 in room room-1 (2024-07-15 to 2024-07-20)',
    );
  });

  it('names the stay it failed to delete', async () => {
    vi.spyOn(db.roomAssignments, 'delete').mockRejectedValueOnce(new Error('disk full'));

    await expect(deleteAssignment('assignment-1' as RoomAssignmentId)).rejects.toThrow(
      'Failed to delete assignment assignment-1',
    );
  });

  it('orders a room\'s and a guest\'s stays by start, whatever their ids', async () => {
    const tripId = await createTestTrip();
    await storeRaw({ id: 'a-late', tripId, startDate: '2024-07-25', endDate: '2024-07-27' });
    await storeRaw({ id: 'b-early', tripId, startDate: '2024-07-15', endDate: '2024-07-17' });

    expect((await getAssignmentsByRoomId('room-1' as RoomId)).map((a) => a.id)).toEqual([
      'b-early',
      'a-late',
    ]);
    expect((await getAssignmentsByPersonId('person-1' as PersonId)).map((a) => a.id)).toEqual([
      'b-early',
      'a-late',
    ]);
  });

  it('leaves the dates alone when a patch does not move them', async () => {
    const tripId = await createTestTrip();
    // An inverted range a peer's document could have carried in.
    const id = await storeRaw({ id: 'inverted', tripId, startDate: '2024-07-20', endDate: '2024-07-15' });

    await updateAssignment(id, { roomId: 'room-2' as RoomId });

    expect((await getAssignmentById(id))?.roomId).toBe('room-2');
  });

  it('only lists the stays of the trip it is asked about', async () => {
    await storeRaw({ id: 'other-trip', tripId: 'a-trip', startDate: '2024-07-15', endDate: '2024-07-20' });
    await storeRaw({ id: 'this-trip', tripId: 'b-trip', startDate: '2024-07-15', endDate: '2024-07-20' });

    expect(
      (await getAssignmentsForDate('b-trip' as TripId, '2024-07-16')).map((a) => a.id),
    ).toEqual(['this-trip']);
  });

  it('refuses a checked patch whose new start falls after the stored end', async () => {
    const tripId = await createTestTrip();
    const id = await storeRaw({ id: 'stay', tripId });

    await expect(
      updateAssignmentWithOwnershipCheck(id, tripId, { startDate: isoDate('2024-07-25') }),
    ).rejects.toThrow('Invalid date range');
  });

  it('refuses a checked patch whose new end falls before the stored start', async () => {
    const tripId = await createTestTrip();
    const id = await storeRaw({ id: 'stay', tripId });

    await expect(
      updateAssignmentWithOwnershipCheck(id, tripId, { endDate: isoDate('2024-07-10') }),
    ).rejects.toThrow('Invalid date range');
  });

  it('refuses a checked update of a stay that does not exist', async () => {
    const tripId = await createTestTrip();

    await expect(
      updateAssignmentWithOwnershipCheck('ghost' as RoomAssignmentId, tripId, {}),
    ).rejects.toThrow('Assignment with ID "ghost" not found');
  });

  it('refuses a checked update of another trip\'s stay, and keeps it', async () => {
    const tripId = await createTestTrip();
    const id = await storeRaw({ id: 'stay', tripId: 'other-trip' });

    await expect(
      updateAssignmentWithOwnershipCheck(id, tripId, { roomId: 'room-2' as RoomId }),
    ).rejects.toThrow('Cannot update assignment: assignment does not belong to current trip');
    expect((await getAssignmentById(id))?.roomId).toBe('room-1');
  });

  it('refuses a checked delete of a stay that does not exist', async () => {
    const tripId = await createTestTrip();

    await expect(
      deleteAssignmentWithOwnershipCheck('ghost' as RoomAssignmentId, tripId),
    ).rejects.toThrow('Assignment with ID "ghost" not found');
  });
});
