/**
 * Transaction Integration Tests
 *
 * These tests verify atomicity, rollback behavior, and data consistency
 * for database operations that use Dexie transactions.
 *
 * Tests cover:
 * 1. All-or-nothing behavior for cascade deletes
 * 2. Rollback on partial failure
 * 3. Concurrent modification scenarios
 * 4. Data consistency after failed operations
 *
 * @module lib/db/__tests__/transaction-integration.test
 */

import { describe, it, expect } from 'vitest';
import { db } from '@/lib/db/database';
import {
  createTrip,
  deleteTrip,
} from '@/lib/db/repositories/trip-repository';
import {
  createRoom,
  deleteRoom,
  deleteRoomWithOwnershipCheck,
} from '@/lib/db/repositories/room-repository';
import {
  createPerson,
  deletePerson,
} from '@/lib/db/repositories/person-repository';
import {
  createAssignment,
  updateAssignment,
  deleteAssignmentWithOwnershipCheck,
} from '@/lib/db/repositories/assignment-repository';
import { createTransport } from '@/lib/db/repositories/transport-repository';
import type { TripId, RoomId, PersonId } from '@/types';
import { isoDate, hexColor } from '@/test/utils';

// ============================================================================
// Test Data Factories
// ============================================================================

async function createTestTrip(name = 'Test Trip'): Promise<TripId> {
  const trip = await createTrip({
    name,
    startDate: isoDate('2024-07-15'),
    endDate: isoDate('2024-07-22'),
  });
  return trip.id;
}

async function createTestRoom(tripId: TripId, name = 'Test Room'): Promise<RoomId> {
  const room = await createRoom(tripId, { name, capacity: 2 });
  return room.id;
}

async function createTestPerson(tripId: TripId, name = 'Test Person'): Promise<PersonId> {
  const person = await createPerson(tripId, { name, color: hexColor('#ef4444') });
  return person.id;
}

// ============================================================================
// Cascade Delete Atomicity Tests
// ============================================================================

describe('Cascade Delete Atomicity', () => {
  describe('deleteTrip cascade', () => {
    it('deletes all related entities atomically', async () => {
      // Setup: Create trip with rooms, persons, assignments, transports
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);
      
      await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-18'),
      });
      
      await createTransport(tripId, {
        personId,
        type: 'arrival',
        datetime: '2024-07-15T10:00:00.000Z',
        location: 'Airport',
        needsPickup: true,
      });

      // Verify all entities exist
      expect(await db.trips.count()).toBe(1);
      expect(await db.rooms.count()).toBe(1);
      expect(await db.persons.count()).toBe(1);
      expect(await db.roomAssignments.count()).toBe(1);
      expect(await db.transports.count()).toBe(1);

      // Delete trip (cascade)
      await deleteTrip(tripId);

      // Verify all entities are deleted (atomically)
      expect(await db.trips.count()).toBe(0);
      expect(await db.rooms.count()).toBe(0);
      expect(await db.persons.count()).toBe(0);
      expect(await db.roomAssignments.count()).toBe(0);
      expect(await db.transports.count()).toBe(0);
    });

    it('preserves unrelated trip data during cascade delete', async () => {
      // Setup: Create two trips with data
      const trip1Id = await createTestTrip('Trip 1');
      const trip2Id = await createTestTrip('Trip 2');
      
      await createTestRoom(trip1Id, 'Room 1');
      await createTestRoom(trip2Id, 'Room 2');
      
      const person1 = await createTestPerson(trip1Id, 'Person 1');
      const person2 = await createTestPerson(trip2Id, 'Person 2');

      await createTransport(trip1Id, {
        personId: person1,
        type: 'arrival',
        datetime: '2024-07-15T10:00:00.000Z',
        location: 'Airport 1',
        needsPickup: true,
      });
      
      await createTransport(trip2Id, {
        personId: person2,
        type: 'arrival',
        datetime: '2024-07-16T10:00:00.000Z',
        location: 'Airport 2',
        needsPickup: false,
      });

      // Verify initial counts
      expect(await db.trips.count()).toBe(2);
      expect(await db.rooms.count()).toBe(2);
      expect(await db.persons.count()).toBe(2);
      expect(await db.transports.count()).toBe(2);

      // Delete only trip1
      await deleteTrip(trip1Id);

      // Verify trip2 data is preserved
      expect(await db.trips.count()).toBe(1);
      expect(await db.rooms.count()).toBe(1);
      expect(await db.persons.count()).toBe(1);
      expect(await db.transports.count()).toBe(1);

      // Verify remaining data belongs to trip2
      const remainingTrip = await db.trips.toArray();
      expect(remainingTrip[0]?.id).toBe(trip2Id);
      
      const remainingRoom = await db.rooms.toArray();
      expect(remainingRoom[0]?.tripId).toBe(trip2Id);
    });
  });

  describe('deleteRoom cascade', () => {
    it('deletes room and its assignments atomically', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);
      
      // Create multiple assignments for the room
      await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-16'),
      });
      await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-07-17'),
        endDate: isoDate('2024-07-18'),
      });

      expect(await db.rooms.count()).toBe(1);
      expect(await db.roomAssignments.count()).toBe(2);

      await deleteRoom(roomId);

      expect(await db.rooms.count()).toBe(0);
      expect(await db.roomAssignments.count()).toBe(0);
    });

    it('preserves other rooms assignments when deleting one room', async () => {
      const tripId = await createTestTrip();
      const room1Id = await createTestRoom(tripId, 'Room 1');
      const room2Id = await createTestRoom(tripId, 'Room 2');
      const personId = await createTestPerson(tripId);
      
      await createAssignment(tripId, {
        roomId: room1Id,
        personId,
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-16'),
      });
      await createAssignment(tripId, {
        roomId: room2Id,
        personId,
        startDate: isoDate('2024-07-17'),
        endDate: isoDate('2024-07-18'),
      });

      expect(await db.roomAssignments.count()).toBe(2);

      await deleteRoom(room1Id);

      expect(await db.rooms.count()).toBe(1);
      expect(await db.roomAssignments.count()).toBe(1);
      
      const remainingAssignment = await db.roomAssignments.toArray();
      expect(remainingAssignment[0]?.roomId).toBe(room2Id);
    });
  });

  describe('deletePerson cascade', () => {
    it('deletes person, assignments, and transports atomically', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);
      
      await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-18'),
      });
      
      await createTransport(tripId, {
        personId,
        type: 'arrival',
        datetime: '2024-07-15T10:00:00.000Z',
        location: 'Airport',
        needsPickup: true,
      });
      
      await createTransport(tripId, {
        personId,
        type: 'departure',
        datetime: '2024-07-22T15:00:00.000Z',
        location: 'Station',
        needsPickup: false,
      });

      expect(await db.persons.count()).toBe(1);
      expect(await db.roomAssignments.count()).toBe(1);
      expect(await db.transports.count()).toBe(2);

      await deletePerson(personId);

      expect(await db.persons.count()).toBe(0);
      expect(await db.roomAssignments.count()).toBe(0);
      expect(await db.transports.count()).toBe(0);
    });

    it('clears driverId references when deleting driver', async () => {
      const tripId = await createTestTrip();
      const driverId = await createTestPerson(tripId, 'Driver');
      const passengerId = await createTestPerson(tripId, 'Passenger');
      
      // Create transport where the driver is assigned
      const transport = await createTransport(tripId, {
        personId: passengerId,
        type: 'arrival',
        datetime: '2024-07-15T10:00:00.000Z',
        location: 'Airport',
        needsPickup: true,
        driverId,
      });

      // Verify driver is set
      let savedTransport = await db.transports.get(transport.id);
      expect(savedTransport?.driverId).toBe(driverId);

      // Delete the driver
      await deletePerson(driverId);

      // Verify driverId is cleared but transport still exists
      savedTransport = await db.transports.get(transport.id);
      expect(savedTransport).toBeDefined();
      expect(savedTransport?.driverId).toBeUndefined();
      expect(savedTransport?.personId).toBe(passengerId);
    });
  });
});

// ============================================================================
// Ownership Validation Tests
// ============================================================================

describe('Ownership Validation in Transactions', () => {
  it('rejects room update for wrong trip', async () => {
    const trip1Id = await createTestTrip('Trip 1');
    const trip2Id = await createTestTrip('Trip 2');
    const roomId = await createTestRoom(trip1Id);

    // Attempt to update room with wrong tripId
    await expect(
      db.transaction('rw', db.rooms, async () => {
        const room = await db.rooms.get(roomId);
        if (!room) throw new Error('Room not found');
        if (room.tripId !== trip2Id) {
          throw new Error('Cannot update room: room does not belong to current trip');
        }
        await db.rooms.update(roomId, { name: 'New Name' });
      })
    ).rejects.toThrow('Cannot update room: room does not belong to current trip');

    // Verify room is unchanged
    const room = await db.rooms.get(roomId);
    expect(room?.name).toBe('Test Room');
  });

  it('rejects assignment delete for wrong trip', async () => {
    const trip1Id = await createTestTrip('Trip 1');
    const trip2Id = await createTestTrip('Trip 2');
    const roomId = await createTestRoom(trip1Id);
    const personId = await createTestPerson(trip1Id);
    
    const assignment = await createAssignment(trip1Id, {
      roomId,
      personId,
      startDate: isoDate('2024-07-15'),
      endDate: isoDate('2024-07-18'),
    });

    // Attempt to delete with wrong tripId
    await expect(
      deleteAssignmentWithOwnershipCheck(assignment.id, trip2Id)
    ).rejects.toThrow('Cannot delete assignment: assignment does not belong to current trip');

    // Verify assignment still exists
    expect(await db.roomAssignments.count()).toBe(1);
  });
});

// ============================================================================
// Transaction Rollback Tests
// ============================================================================

describe('Transaction Rollback on Failure', () => {
  it('rolls back all changes when assignment update validation fails', async () => {
    const tripId = await createTestTrip();
    const roomId = await createTestRoom(tripId);
    const personId = await createTestPerson(tripId);
    
    const assignment = await createAssignment(tripId, {
      roomId,
      personId,
      startDate: isoDate('2024-07-15'),
      endDate: isoDate('2024-07-18'),
    });

    // Store original values
    const originalAssignment = await db.roomAssignments.get(assignment.id);

    // Attempt to update with invalid date range (endDate before startDate)
    await expect(
      updateAssignment(assignment.id, {
        startDate: isoDate('2024-07-20'), // After original endDate
        endDate: isoDate('2024-07-18'),  // Before new startDate
      })
    ).rejects.toThrow('Invalid date range');

    // Verify assignment is unchanged
    const afterAttempt = await db.roomAssignments.get(assignment.id);
    expect(afterAttempt?.startDate).toBe(originalAssignment?.startDate);
    expect(afterAttempt?.endDate).toBe(originalAssignment?.endDate);
  });

  it('maintains data consistency after ownership validation failure', async () => {
    const trip1Id = await createTestTrip('Trip 1');
    const trip2Id = await createTestTrip('Trip 2');
    const roomId = await createTestRoom(trip1Id);

    // Attempt delete with wrong ownership
    await expect(
      deleteRoomWithOwnershipCheck(roomId, trip2Id)
    ).rejects.toThrow('Cannot delete room: room does not belong to current trip');

    // Verify both trips still exist with their data
    expect(await db.trips.count()).toBe(2);
    expect(await db.rooms.count()).toBe(1);
    
    const room = await db.rooms.get(roomId);
    expect(room?.tripId).toBe(trip1Id);
  });
});

// ============================================================================
// Concurrent Operation Tests
// ============================================================================

describe('Concurrent Operation Handling', () => {
  it('handles simultaneous deletes gracefully', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    // Start two parallel deletes
    const delete1 = deletePerson(personId);
    const delete2 = deletePerson(personId);

    // Both should complete without errors (delete is idempotent)
    await Promise.all([delete1, delete2]);

    // Person should be deleted
    expect(await db.persons.count()).toBe(0);
  });

  it('handles parallel trip deletes correctly', async () => {
    const trip1Id = await createTestTrip('Trip 1');
    const trip2Id = await createTestTrip('Trip 2');
    
    // Add data to both trips
    await createTestRoom(trip1Id, 'Room 1');
    await createTestRoom(trip2Id, 'Room 2');

    // Delete both trips in parallel
    await Promise.all([
      deleteTrip(trip1Id),
      deleteTrip(trip2Id),
    ]);

    // All data should be deleted
    expect(await db.trips.count()).toBe(0);
    expect(await db.rooms.count()).toBe(0);
  });

  it('handles rapid create-delete cycles', async () => {
    const tripId = await createTestTrip();

    // Rapidly create and delete rooms
    const operations = Array.from({ length: 10 }, async (_, i) => {
      const roomId = await createTestRoom(tripId, `Room ${i}`);
      await deleteRoom(roomId);
    });

    await Promise.all(operations);

    // All rooms should be deleted
    expect(await db.rooms.count()).toBe(0);
  });
});

// ============================================================================
// Data Integrity Tests
// ============================================================================

describe('Data Integrity', () => {
  it('deletes room and assignments in single transaction', async () => {
    const tripId = await createTestTrip();
    const roomId = await createTestRoom(tripId);
    const personId = await createTestPerson(tripId);
    
    await createAssignment(tripId, {
      roomId,
      personId,
      startDate: isoDate('2024-07-15'),
      endDate: isoDate('2024-07-18'),
    });

    // Verify both exist
    expect(await db.rooms.count()).toBe(1);
    expect(await db.roomAssignments.count()).toBe(1);

    // Delete room (cascade should delete assignments too)
    await deleteRoom(roomId);

    // Verify both are deleted
    expect(await db.rooms.count()).toBe(0);
    expect(await db.roomAssignments.count()).toBe(0);
  });

  it('handles delete of non-existent entity gracefully', async () => {
    const fakeId = 'non_existent_id_12345' as PersonId;

    // Deleting non-existent person should not throw
    await expect(deletePerson(fakeId)).resolves.not.toThrow();
  });

  it('preserves data when ownership check fails in batch operation', async () => {
    const trip1Id = await createTestTrip('Trip 1');
    const trip2Id = await createTestTrip('Trip 2');
    
    const room1 = await createTestRoom(trip1Id, 'Room 1');
    await createTestRoom(trip2Id, 'Room 2'); // Create room for trip2 (count verification)
    const person1 = await createTestPerson(trip1Id, 'Person 1');
    
    await createAssignment(trip1Id, {
      roomId: room1,
      personId: person1,
      startDate: isoDate('2024-07-15'),
      endDate: isoDate('2024-07-18'),
    });

    // Attempt to delete room from wrong trip should fail
    await expect(
      deleteRoomWithOwnershipCheck(room1, trip2Id)
    ).rejects.toThrow();

    // All data should be preserved
    expect(await db.rooms.count()).toBe(2);
    expect(await db.roomAssignments.count()).toBe(1);
    expect(await db.persons.count()).toBe(1);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  it('handles empty cascade delete', async () => {
    const tripId = await createTestTrip();
    // Trip has no rooms, persons, assignments, or transports

    await expect(deleteTrip(tripId)).resolves.not.toThrow();

    expect(await db.trips.count()).toBe(0);
  });

  it('handles large cascade delete', async () => {
    const tripId = await createTestTrip();
    
    // Create many rooms
    const roomIds: RoomId[] = [];
    for (let i = 0; i < 20; i++) {
      const roomId = await createTestRoom(tripId, `Room ${i}`);
      roomIds.push(roomId);
    }
    
    // Create many persons
    const personIds: PersonId[] = [];
    for (let i = 0; i < 20; i++) {
      const personId = await createTestPerson(tripId, `Person ${i}`);
      personIds.push(personId);
    }
    
    // Create assignments
    for (let i = 0; i < 20; i++) {
      const roomId = roomIds[i % roomIds.length];
      const personId = personIds[i % personIds.length];
      if (roomId && personId) {
        await createAssignment(tripId, {
          roomId,
          personId,
          startDate: isoDate(`2024-07-${15 + (i % 7)}`),
          endDate: isoDate(`2024-07-${16 + (i % 7)}`),
        });
      }
    }

    // Verify setup
    expect(await db.rooms.count()).toBe(20);
    expect(await db.persons.count()).toBe(20);
    expect(await db.roomAssignments.count()).toBe(20);

    // Delete trip with all data
    await deleteTrip(tripId);

    // Verify all deleted
    expect(await db.trips.count()).toBe(0);
    expect(await db.rooms.count()).toBe(0);
    expect(await db.persons.count()).toBe(0);
    expect(await db.roomAssignments.count()).toBe(0);
  });
});
