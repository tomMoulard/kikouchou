/**
 * Integration tests for Assignment Repository
 *
 * Tests CRUD operations and conflict detection for room assignments.
 * The checkAssignmentConflict function is CRITICAL for preventing
 * double-booking of persons to rooms.
 *
 * @module lib/db/repositories/__tests__/assignment-repository.test
 */
import { describe, it, expect } from 'vitest';
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

    it('returns true when assignments share single boundary date - start', async () => {
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

      // New: July 19-22 (starts on existing's end date)
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-19',
        '2024-07-22'
      );

      expect(hasConflict).toBe(true);
    });

    it('returns true when assignments share single boundary date - end', async () => {
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

      // New: July 15-20 (ends on existing's start date)
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-15',
        '2024-07-20'
      );

      expect(hasConflict).toBe(true);
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

    it('handles single day assignments', async () => {
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

      // Exact same single day - conflict
      const exactConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-17',
        '2024-07-17'
      );
      expect(exactConflict).toBe(true);

      // Overlapping single day - conflict
      const overlapConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-15',
        '2024-07-17'
      );
      expect(overlapConflict).toBe(true);

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
