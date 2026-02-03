/**
 * Compound Index Verification Tests
 *
 * These tests verify that Dexie correctly uses compound indexes for single-field
 * queries on the leftmost element, as required for efficient cascade delete operations.
 *
 * Background:
 * - IndexedDB compound indexes (e.g., `[tripId+startDate]`) can serve queries on
 *   the leftmost key prefix (e.g., just `tripId`)
 * - Dexie automatically selects an appropriate compound index when querying on
 *   a field that is the first element of a compound index
 *
 * References:
 * - Dexie docs: https://dexie.org/docs/Compound-Index
 * - IndexedDB spec: Compound keys are compared element-by-element from left to right
 *
 * @module lib/db/__tests__/compound-index.test
 */

import { describe, it, expect } from 'vitest';
import { db } from '@/lib/db/database';
import {
  createTripId,
  createRoomId,
  createPersonId,
  createRoomAssignmentId,
  createTransportId,
  createShareId,
  createTimestamps,
} from '@/lib/db/utils';
import type {
  Trip,
  Room,
  Person,
  RoomAssignment,
  Transport,
  TripId,
} from '@/types';

// ============================================================================
// Test Data Factories
// ============================================================================

function createTestTrip(overrides?: Partial<Trip>): Trip {
  return {
    id: createTripId(),
    name: 'Test Trip',
    startDate: '2024-07-15',
    endDate: '2024-07-22',
    shareId: createShareId(),
    ...createTimestamps(),
    ...overrides,
  };
}

function createTestRoom(tripId: TripId, order: number): Room {
  return {
    id: createRoomId(),
    tripId,
    name: `Room ${order}`,
    capacity: 2,
    order,
  };
}

function createTestPerson(tripId: TripId, index: number): Person {
  return {
    id: createPersonId(),
    tripId,
    name: `Person ${index}`,
    color: '#ef4444',
  };
}

function createTestAssignment(
  tripId: TripId,
  roomId: string,
  personId: string,
  dayOffset: number
): RoomAssignment {
  return {
    id: createRoomAssignmentId(),
    tripId,
    roomId: roomId as RoomAssignment['roomId'],
    personId: personId as RoomAssignment['personId'],
    startDate: `2024-07-${15 + dayOffset}`,
    endDate: `2024-07-${16 + dayOffset}`,
  };
}

function createTestTransport(
  tripId: TripId,
  personId: string,
  hourOffset: number
): Transport {
  return {
    id: createTransportId(),
    tripId,
    personId: personId as Transport['personId'],
    type: hourOffset % 2 === 0 ? 'arrival' : 'departure',
    datetime: `2024-07-15T${10 + hourOffset}:00:00.000Z`,
    location: 'Test Station',
    needsPickup: false,
  };
}

// ============================================================================
// Test Setup
// ============================================================================

// Note: Database is cleared by global setup in src/test/setup.ts before each test

// ============================================================================
// Compound Index Verification Tests
// ============================================================================

describe('Compound Index Verification', () => {
  describe('rooms table - [tripId+order] compound index', () => {
    it('supports where(tripId) query using compound index prefix', async () => {
      // Create multiple trips with many rooms each
      const trip1 = createTestTrip({ name: 'Trip 1' });
      const trip2 = createTestTrip({ name: 'Trip 2' });
      const trip3 = createTestTrip({ name: 'Trip 3' });
      await db.trips.bulkAdd([trip1, trip2, trip3]);

      // Create 50 rooms per trip (150 total)
      const rooms: Room[] = [];
      for (let i = 0; i < 50; i++) {
        rooms.push(createTestRoom(trip1.id, i));
        rooms.push(createTestRoom(trip2.id, i));
        rooms.push(createTestRoom(trip3.id, i));
      }
      await db.rooms.bulkAdd(rooms);

      expect(await db.rooms.count()).toBe(150);

      // Query using tripId (should use [tripId+order] compound index)
      const trip1Rooms = await db.rooms.where('tripId').equals(trip1.id).toArray();
      const trip2Rooms = await db.rooms.where('tripId').equals(trip2.id).toArray();

      // Verify correct filtering
      expect(trip1Rooms).toHaveLength(50);
      expect(trip2Rooms).toHaveLength(50);
      expect(trip1Rooms.every((r) => r.tripId === trip1.id)).toBe(true);
      expect(trip2Rooms.every((r) => r.tripId === trip2.id)).toBe(true);

      // Verify delete using compound index
      const deletedCount = await db.rooms.where('tripId').equals(trip1.id).delete();
      expect(deletedCount).toBe(50);

      // Verify only trip1 rooms were deleted
      expect(await db.rooms.count()).toBe(100);
      const remainingForTrip1 = await db.rooms.where('tripId').equals(trip1.id).count();
      expect(remainingForTrip1).toBe(0);
    });
  });

  describe('roomAssignments table - [tripId+*] compound indexes', () => {
    it('supports where(tripId) query using compound index prefix', async () => {
      // Create trips, rooms, persons
      const trip1 = createTestTrip({ name: 'Trip 1' });
      const trip2 = createTestTrip({ name: 'Trip 2' });
      await db.trips.bulkAdd([trip1, trip2]);

      const room1 = createTestRoom(trip1.id, 1);
      const room2 = createTestRoom(trip2.id, 1);
      await db.rooms.bulkAdd([room1, room2]);

      const person1 = createTestPerson(trip1.id, 1);
      const person2 = createTestPerson(trip2.id, 1);
      await db.persons.bulkAdd([person1, person2]);

      // Create 100 assignments per trip (200 total)
      const assignments: RoomAssignment[] = [];
      for (let i = 0; i < 100; i++) {
        assignments.push(createTestAssignment(trip1.id, room1.id, person1.id, i % 7));
        assignments.push(createTestAssignment(trip2.id, room2.id, person2.id, i % 7));
      }
      await db.roomAssignments.bulkAdd(assignments);

      expect(await db.roomAssignments.count()).toBe(200);

      // Query using tripId (should use [tripId+startDate] compound index)
      const trip1Assignments = await db.roomAssignments
        .where('tripId')
        .equals(trip1.id)
        .toArray();

      expect(trip1Assignments).toHaveLength(100);
      expect(trip1Assignments.every((a) => a.tripId === trip1.id)).toBe(true);

      // Verify delete using compound index
      const deletedCount = await db.roomAssignments
        .where('tripId')
        .equals(trip1.id)
        .delete();
      expect(deletedCount).toBe(100);

      // Verify only trip1 assignments were deleted
      expect(await db.roomAssignments.count()).toBe(100);
    });
  });

  describe('transports table - [tripId+*] compound indexes', () => {
    it('supports where(tripId) query using compound index prefix', async () => {
      // Create trips and persons
      const trip1 = createTestTrip({ name: 'Trip 1' });
      const trip2 = createTestTrip({ name: 'Trip 2' });
      await db.trips.bulkAdd([trip1, trip2]);

      const person1 = createTestPerson(trip1.id, 1);
      const person2 = createTestPerson(trip2.id, 1);
      await db.persons.bulkAdd([person1, person2]);

      // Create 100 transports per trip (200 total)
      const transports: Transport[] = [];
      for (let i = 0; i < 100; i++) {
        transports.push(createTestTransport(trip1.id, person1.id, i % 8));
        transports.push(createTestTransport(trip2.id, person2.id, i % 8));
      }
      await db.transports.bulkAdd(transports);

      expect(await db.transports.count()).toBe(200);

      // Query using tripId (should use [tripId+datetime] compound index)
      const trip1Transports = await db.transports
        .where('tripId')
        .equals(trip1.id)
        .toArray();

      expect(trip1Transports).toHaveLength(100);
      expect(trip1Transports.every((t) => t.tripId === trip1.id)).toBe(true);

      // Verify delete using compound index
      const deletedCount = await db.transports
        .where('tripId')
        .equals(trip1.id)
        .delete();
      expect(deletedCount).toBe(100);

      // Verify only trip1 transports were deleted
      expect(await db.transports.count()).toBe(100);
    });
  });

  describe('cascade delete with compound indexes', () => {
    it('efficiently deletes all trip-related data using compound index prefixes', async () => {
      // Create 5 trips with extensive related data
      const trips: Trip[] = [];
      const rooms: Room[] = [];
      const persons: Person[] = [];
      const assignments: RoomAssignment[] = [];
      const transports: Transport[] = [];

      for (let t = 0; t < 5; t++) {
        const trip = createTestTrip({ name: `Trip ${t}` });
        trips.push(trip);

        // 10 rooms per trip
        for (let r = 0; r < 10; r++) {
          rooms.push(createTestRoom(trip.id, r));
        }

        // 20 persons per trip
        for (let p = 0; p < 20; p++) {
          persons.push(createTestPerson(trip.id, p));
        }
      }

      await db.trips.bulkAdd(trips);
      await db.rooms.bulkAdd(rooms);
      await db.persons.bulkAdd(persons);

      // Create assignments and transports using the created entities
      for (const trip of trips) {
        const tripRooms = rooms.filter((r) => r.tripId === trip.id);
        const tripPersons = persons.filter((p) => p.tripId === trip.id);

        // 50 assignments per trip (using first room and first person)
        const room = tripRooms[0];
        const person = tripPersons[0];
        if (room && person) {
          for (let a = 0; a < 50; a++) {
            assignments.push(createTestAssignment(trip.id, room.id, person.id, a % 7));
          }
        }

        // 30 transports per trip
        if (person) {
          for (let tr = 0; tr < 30; tr++) {
            transports.push(createTestTransport(trip.id, person.id, tr % 8));
          }
        }
      }

      await db.roomAssignments.bulkAdd(assignments);
      await db.transports.bulkAdd(transports);

      // Verify initial counts
      expect(await db.trips.count()).toBe(5);
      expect(await db.rooms.count()).toBe(50);
      expect(await db.persons.count()).toBe(100);
      expect(await db.roomAssignments.count()).toBe(250);
      expect(await db.transports.count()).toBe(150);

      // Delete one trip's data using compound index queries
      const tripToDelete = trips[0];
      if (!tripToDelete) throw new Error('No trip to delete');

      await db.transaction(
        'rw',
        [db.trips, db.rooms, db.persons, db.roomAssignments, db.transports],
        async () => {
          await Promise.all([
            db.roomAssignments.where('tripId').equals(tripToDelete.id).delete(),
            db.transports.where('tripId').equals(tripToDelete.id).delete(),
            db.persons.where('tripId').equals(tripToDelete.id).delete(),
            db.rooms.where('tripId').equals(tripToDelete.id).delete(),
          ]);
          await db.trips.delete(tripToDelete.id);
        }
      );

      // Verify counts after deletion (4/5 of each remain)
      expect(await db.trips.count()).toBe(4);
      expect(await db.rooms.count()).toBe(40);
      expect(await db.persons.count()).toBe(80);
      expect(await db.roomAssignments.count()).toBe(200);
      expect(await db.transports.count()).toBe(120);

      // Verify the deleted trip's data is completely gone
      expect(
        await db.rooms.where('tripId').equals(tripToDelete.id).count()
      ).toBe(0);
      expect(
        await db.persons.where('tripId').equals(tripToDelete.id).count()
      ).toBe(0);
      expect(
        await db.roomAssignments.where('tripId').equals(tripToDelete.id).count()
      ).toBe(0);
      expect(
        await db.transports.where('tripId').equals(tripToDelete.id).count()
      ).toBe(0);
    });
  });
});

/**
 * Documentation: Compound Index Behavior in Dexie/IndexedDB
 *
 * ## How Compound Indexes Work
 *
 * In IndexedDB (and Dexie), a compound index like `[tripId+order]` stores keys
 * as arrays: [tripId, order]. The index is sorted first by tripId, then by order
 * within each tripId.
 *
 * ## Leftmost Prefix Queries
 *
 * Because of this sorting, queries on just the first element (tripId) can
 * efficiently use the compound index. IndexedDB can find the range of entries
 * where tripId matches using binary search (O(log n)).
 *
 * Example:
 * - Index: [tripId+order]
 * - Query: db.rooms.where('tripId').equals('abc')
 * - Dexie translates this to an IDBKeyRange for ['abc', Dexie.minKey] to ['abc', Dexie.maxKey]
 * - This is an efficient range scan on the compound index
 *
 * ## Verification
 *
 * The tests in this file verify that:
 * 1. Single-field queries on the first element of compound indexes return correct results
 * 2. Delete operations using these queries work correctly
 * 3. Large datasets (hundreds of records) are handled properly
 *
 * ## Performance Note
 *
 * While we cannot directly measure index usage in fake-indexeddb (used for testing),
 * the IndexedDB specification guarantees O(log n) lookup time for indexed queries.
 * The compound index approach is the standard, efficient pattern for this use case.
 *
 * ## Schema Reference
 *
 * Current compound indexes in Kikoushou:
 * - rooms: [tripId+order]
 * - roomAssignments: [tripId+startDate], [tripId+personId], [tripId+roomId]
 * - transports: [tripId+datetime], [tripId+personId], [tripId+type]
 *
 * All support efficient where('tripId').equals(id) queries.
 */
