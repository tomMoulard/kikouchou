/**
 * Integration tests for Trip Repository
 *
 * Tests CRUD operations, cascade delete, and ID collision handling
 * for the trip-repository module.
 *
 * @module lib/db/repositories/__tests__/trip-repository.test
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db } from '@/lib/db/database';
import {
  createTrip,
  getAllTrips,
  getTripById,
  getTripByShareId,
  updateTrip,
  deleteTrip,
} from '@/lib/db/repositories/trip-repository';
import { createRoom } from '@/lib/db/repositories/room-repository';
import { createPerson } from '@/lib/db/repositories/person-repository';
import { createAssignment } from '@/lib/db/repositories/assignment-repository';
import { createTransport } from '@/lib/db/repositories/transport-repository';
import * as dbUtils from '@/lib/db/utils';
import type { TripFormData, TripId, ShareId } from '@/types';

// ============================================================================
// Test Data Factories
// ============================================================================

/**
 * Creates valid trip form data with optional overrides.
 */
function createValidTripData(overrides?: Partial<TripFormData>): TripFormData {
  return {
    name: 'Test Trip',
    location: 'Beach House, Brittany',
    startDate: '2024-07-15',
    endDate: '2024-07-22',
    ...overrides,
  };
}

// ============================================================================
// Test Setup
// ============================================================================

beforeEach(async () => {
  // Clear all tables to ensure test isolation
  await Promise.all([
    db.trips.clear(),
    db.rooms.clear(),
    db.persons.clear(),
    db.roomAssignments.clear(),
    db.transports.clear(),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// createTrip Tests
// ============================================================================

describe('createTrip', () => {
  it('creates trip with all required fields', async () => {
    const data = createValidTripData();

    const trip = await createTrip(data);

    expect(trip.name).toBe(data.name);
    expect(trip.location).toBe(data.location);
    expect(trip.startDate).toBe(data.startDate);
    expect(trip.endDate).toBe(data.endDate);
  });

  it('generates unique id and shareId', async () => {
    const trip1 = await createTrip(createValidTripData({ name: 'Trip 1' }));
    const trip2 = await createTrip(createValidTripData({ name: 'Trip 2' }));
    const trip3 = await createTrip(createValidTripData({ name: 'Trip 3' }));

    // All IDs should be unique
    const ids = [trip1.id, trip2.id, trip3.id];
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(3);

    // All shareIds should be unique
    const shareIds = [trip1.shareId, trip2.shareId, trip3.shareId];
    const uniqueShareIds = new Set(shareIds);
    expect(uniqueShareIds.size).toBe(3);

    // IDs should have expected format (21-char nanoid for id, 10-char for shareId)
    expect(trip1.id).toHaveLength(21);
    expect(trip1.shareId).toHaveLength(10);
  });

  it('sets createdAt and updatedAt timestamps', async () => {
    const beforeCreate = Date.now();
    const trip = await createTrip(createValidTripData());
    const afterCreate = Date.now();

    // Both timestamps should be set and equal initially
    expect(trip.createdAt).toBe(trip.updatedAt);

    // Timestamps should be within the test execution window
    expect(trip.createdAt).toBeGreaterThanOrEqual(beforeCreate);
    expect(trip.createdAt).toBeLessThanOrEqual(afterCreate);
  });

  it('persists trip to database', async () => {
    const trip = await createTrip(createValidTripData());

    // Verify trip is in database
    const retrieved = await getTripById(trip.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(trip.id);
    expect(retrieved?.name).toBe(trip.name);
  });

  it('creates trip without optional location', async () => {
    const data: TripFormData = {
      name: 'Trip Without Location',
      startDate: '2024-08-01',
      endDate: '2024-08-05',
    };

    const trip = await createTrip(data);

    expect(trip.name).toBe(data.name);
    expect(trip.location).toBeUndefined();
  });

  describe('handles shareId collision with retry', () => {
    it('retries on ConstraintError and succeeds', async () => {
      // Create first trip to occupy a shareId
      const existingTrip = await createTrip(createValidTripData({ name: 'Existing Trip' }));

      // Mock createShareId to return the existing shareId twice, then a new one
      const uniqueShareId = 'unique1234' as ShareId;
      const createShareIdSpy = vi
        .spyOn(dbUtils, 'createShareId')
        .mockReturnValueOnce(existingTrip.shareId)
        .mockReturnValueOnce(existingTrip.shareId)
        .mockReturnValueOnce(uniqueShareId);

      const newTrip = await createTrip(createValidTripData({ name: 'New Trip' }));

      expect(createShareIdSpy).toHaveBeenCalledTimes(3);
      expect(newTrip.shareId).toBe(uniqueShareId);
      expect(newTrip.name).toBe('New Trip');
    });

    it('throws after MAX_ID_RETRIES attempts', async () => {
      // Create first trip to occupy a shareId
      const existingTrip = await createTrip(createValidTripData({ name: 'Existing Trip' }));

      // Always return the same colliding shareId
      const createShareIdSpy = vi.spyOn(dbUtils, 'createShareId').mockReturnValue(existingTrip.shareId);

      await expect(
        createTrip(createValidTripData({ name: 'Will Fail' }))
      ).rejects.toThrow(/Failed to create trip after 3 attempts/);

      // Verify exactly 3 retry attempts were made
      expect(createShareIdSpy).toHaveBeenCalledTimes(3);
    });

    it('throws immediately for non-ConstraintError exceptions', async () => {
      // Mock db.trips.add to throw a non-ConstraintError
      const dbError = new Error('Database connection lost');
      vi.spyOn(db.trips, 'add').mockRejectedValue(dbError);

      await expect(createTrip(createValidTripData())).rejects.toThrow('Database connection lost');
    });
  });
});

// ============================================================================
// getAllTrips Tests
// ============================================================================

describe('getAllTrips', () => {
  it('returns empty array when no trips', async () => {
    const trips = await getAllTrips();

    expect(trips).toEqual([]);
    expect(trips).toHaveLength(0);
  });

  it('returns trips sorted by startDate descending', async () => {
    // Create trips with different start dates (out of order)
    await createTrip(createValidTripData({ name: 'Middle', startDate: '2024-06-01' }));
    await createTrip(createValidTripData({ name: 'Earliest', startDate: '2024-01-15' }));
    await createTrip(createValidTripData({ name: 'Latest', startDate: '2024-12-01' }));

    const trips = await getAllTrips();

    expect(trips).toHaveLength(3);
    // Should be sorted by startDate descending (most recent first)
    expect(trips[0]?.name).toBe('Latest');
    expect(trips[1]?.name).toBe('Middle');
    expect(trips[2]?.name).toBe('Earliest');
  });

  it('returns single trip in array', async () => {
    const trip = await createTrip(createValidTripData({ name: 'Only Trip' }));

    const trips = await getAllTrips();

    expect(trips).toHaveLength(1);
    expect(trips[0]?.id).toBe(trip.id);
  });

  it('handles trips with same start date', async () => {
    await createTrip(createValidTripData({ name: 'Trip A', startDate: '2024-07-01' }));
    await createTrip(createValidTripData({ name: 'Trip B', startDate: '2024-07-01' }));

    const trips = await getAllTrips();

    expect(trips).toHaveLength(2);
    // Both should be returned (order between same dates is implementation-defined)
    const names = trips.map((t) => t.name);
    expect(names).toContain('Trip A');
    expect(names).toContain('Trip B');
  });
});

// ============================================================================
// getTripById Tests
// ============================================================================

describe('getTripById', () => {
  it('returns trip when found', async () => {
    const created = await createTrip(createValidTripData({ name: 'Find Me' }));

    const found = await getTripById(created.id);

    expect(found).toBeDefined();
    expect(found?.id).toBe(created.id);
    expect(found?.name).toBe('Find Me');
    expect(found?.shareId).toBe(created.shareId);
  });

  it('returns undefined when not found', async () => {
    const nonExistentId = 'trip_does_not_exist_x' as TripId;

    const found = await getTripById(nonExistentId);

    expect(found).toBeUndefined();
  });

  it('returns correct trip when multiple exist', async () => {
    const trip1 = await createTrip(createValidTripData({ name: 'Trip 1' }));
    const trip2 = await createTrip(createValidTripData({ name: 'Trip 2' }));
    const trip3 = await createTrip(createValidTripData({ name: 'Trip 3' }));

    const found = await getTripById(trip2.id);

    expect(found?.id).toBe(trip2.id);
    expect(found?.name).toBe('Trip 2');
    // Verify others are not returned
    expect(found?.id).not.toBe(trip1.id);
    expect(found?.id).not.toBe(trip3.id);
  });
});

// ============================================================================
// getTripByShareId Tests
// ============================================================================

describe('getTripByShareId', () => {
  it('returns trip when shareId matches', async () => {
    const created = await createTrip(createValidTripData({ name: 'Shared Trip' }));

    const found = await getTripByShareId(created.shareId);

    expect(found).toBeDefined();
    expect(found?.id).toBe(created.id);
    expect(found?.shareId).toBe(created.shareId);
    expect(found?.name).toBe('Shared Trip');
  });

  it('returns undefined for non-existent shareId', async () => {
    // Create a trip to ensure the table isn't empty
    await createTrip(createValidTripData());

    const found = await getTripByShareId('nonexist12');

    expect(found).toBeUndefined();
  });

  it('returns correct trip when multiple exist', async () => {
    const trip1 = await createTrip(createValidTripData({ name: 'Trip 1' }));
    const trip2 = await createTrip(createValidTripData({ name: 'Trip 2' }));

    const found = await getTripByShareId(trip1.shareId);

    expect(found?.id).toBe(trip1.id);
    expect(found?.name).toBe('Trip 1');
    expect(found?.id).not.toBe(trip2.id);
  });
});

// ============================================================================
// updateTrip Tests
// ============================================================================

describe('updateTrip', () => {
  it('updates trip fields', async () => {
    const trip = await createTrip(createValidTripData({ name: 'Original Name' }));

    await updateTrip(trip.id, { name: 'Updated Name', location: 'New Location' });

    const updated = await getTripById(trip.id);
    expect(updated?.name).toBe('Updated Name');
    expect(updated?.location).toBe('New Location');
  });

  it('updates only updatedAt timestamp', async () => {
    const trip = await createTrip(createValidTripData());
    const originalCreatedAt = trip.createdAt;
    const originalUpdatedAt = trip.updatedAt;

    // Mock Date.now to return a future timestamp for the update
    const futureTimestamp = originalUpdatedAt + 1000;
    vi.spyOn(Date, 'now').mockReturnValue(futureTimestamp);

    await updateTrip(trip.id, { name: 'Modified' });

    const updated = await getTripById(trip.id);
    expect(updated?.createdAt).toBe(originalCreatedAt);
    expect(updated?.updatedAt).toBeGreaterThan(originalUpdatedAt);
  });

  it('throws error for non-existent trip', async () => {
    const nonExistentId = 'trip_does_not_exist_x' as TripId;

    await expect(updateTrip(nonExistentId, { name: 'New Name' })).rejects.toThrow(
      `Trip with id "${nonExistentId}" not found`
    );
  });

  it('preserves unchanged fields', async () => {
    const trip = await createTrip(
      createValidTripData({
        name: 'Original',
        location: 'Original Location',
        startDate: '2024-01-01',
        endDate: '2024-01-10',
      })
    );

    // Only update name
    await updateTrip(trip.id, { name: 'New Name' });

    const updated = await getTripById(trip.id);
    expect(updated?.name).toBe('New Name');
    expect(updated?.location).toBe('Original Location');
    expect(updated?.startDate).toBe('2024-01-01');
    expect(updated?.endDate).toBe('2024-01-10');
  });

  it('can update dates', async () => {
    const trip = await createTrip(createValidTripData());

    await updateTrip(trip.id, {
      startDate: '2025-01-01',
      endDate: '2025-01-15',
    });

    const updated = await getTripById(trip.id);
    expect(updated?.startDate).toBe('2025-01-01');
    expect(updated?.endDate).toBe('2025-01-15');
  });
});

// ============================================================================
// deleteTrip Tests
// ============================================================================

describe('deleteTrip', () => {
  it('deletes trip', async () => {
    const trip = await createTrip(createValidTripData());

    await deleteTrip(trip.id);

    const found = await getTripById(trip.id);
    expect(found).toBeUndefined();
  });

  it('cascade deletes associated rooms', async () => {
    const trip = await createTrip(createValidTripData());
    await createRoom(trip.id, { name: 'Room 1', capacity: 2 });
    await createRoom(trip.id, { name: 'Room 2', capacity: 3 });

    // Verify rooms exist
    expect(await db.rooms.count()).toBe(2);

    await deleteTrip(trip.id);

    // Verify rooms are deleted
    expect(await db.rooms.count()).toBe(0);
  });

  it('cascade deletes associated persons', async () => {
    const trip = await createTrip(createValidTripData());
    await createPerson(trip.id, { name: 'Alice', color: '#ef4444' });
    await createPerson(trip.id, { name: 'Bob', color: '#3b82f6' });

    // Verify persons exist
    expect(await db.persons.count()).toBe(2);

    await deleteTrip(trip.id);

    // Verify persons are deleted
    expect(await db.persons.count()).toBe(0);
  });

  it('cascade deletes associated assignments', async () => {
    const trip = await createTrip(createValidTripData());
    const room = await createRoom(trip.id, { name: 'Room 1', capacity: 2 });
    const person = await createPerson(trip.id, { name: 'Alice', color: '#ef4444' });
    await createAssignment(trip.id, {
      roomId: room.id,
      personId: person.id,
      startDate: '2024-07-15',
      endDate: '2024-07-20',
    });

    // Verify assignment exists
    expect(await db.roomAssignments.count()).toBe(1);

    await deleteTrip(trip.id);

    // Verify assignment is deleted
    expect(await db.roomAssignments.count()).toBe(0);
  });

  it('cascade deletes associated transports', async () => {
    const trip = await createTrip(createValidTripData());
    const person = await createPerson(trip.id, { name: 'Alice', color: '#ef4444' });
    await createTransport(trip.id, {
      personId: person.id,
      type: 'arrival',
      datetime: '2024-07-15T14:30:00.000Z',
      location: 'Gare Montparnasse',
      needsPickup: true,
    });

    // Verify transport exists
    expect(await db.transports.count()).toBe(1);

    await deleteTrip(trip.id);

    // Verify transport is deleted
    expect(await db.transports.count()).toBe(0);
  });

  it('cascade deletes all associated entities at once', async () => {
    // Create trip with all related entities
    const trip = await createTrip(createValidTripData());
    const room1 = await createRoom(trip.id, { name: 'Room 1', capacity: 2 });
    const room2 = await createRoom(trip.id, { name: 'Room 2', capacity: 3 });
    const person1 = await createPerson(trip.id, { name: 'Alice', color: '#ef4444' });
    const person2 = await createPerson(trip.id, { name: 'Bob', color: '#3b82f6' });

    // Create multiple assignments
    await createAssignment(trip.id, {
      roomId: room1.id,
      personId: person1.id,
      startDate: '2024-07-15',
      endDate: '2024-07-18',
    });
    await createAssignment(trip.id, {
      roomId: room2.id,
      personId: person2.id,
      startDate: '2024-07-15',
      endDate: '2024-07-22',
    });

    // Create multiple transports
    await createTransport(trip.id, {
      personId: person1.id,
      type: 'arrival',
      datetime: '2024-07-15T10:00:00.000Z',
      location: 'Airport',
      needsPickup: true,
    });
    await createTransport(trip.id, {
      personId: person2.id,
      type: 'departure',
      datetime: '2024-07-22T18:00:00.000Z',
      location: 'Train Station',
      needsPickup: false,
    });

    // Verify all entities exist
    expect(await db.trips.count()).toBe(1);
    expect(await db.rooms.count()).toBe(2);
    expect(await db.persons.count()).toBe(2);
    expect(await db.roomAssignments.count()).toBe(2);
    expect(await db.transports.count()).toBe(2);

    // Delete trip
    await deleteTrip(trip.id);

    // Verify all entities are deleted
    expect(await db.trips.count()).toBe(0);
    expect(await db.rooms.count()).toBe(0);
    expect(await db.persons.count()).toBe(0);
    expect(await db.roomAssignments.count()).toBe(0);
    expect(await db.transports.count()).toBe(0);
  });

  it('only deletes entities belonging to the specified trip', async () => {
    // Create two trips with related entities
    const trip1 = await createTrip(createValidTripData({ name: 'Trip 1' }));
    const trip2 = await createTrip(createValidTripData({ name: 'Trip 2' }));

    // Create entities for both trips
    await createRoom(trip1.id, { name: 'Room for Trip 1', capacity: 2 });
    await createRoom(trip2.id, { name: 'Room for Trip 2', capacity: 2 });

    const person1 = await createPerson(trip1.id, { name: 'Person 1', color: '#ef4444' });
    const person2 = await createPerson(trip2.id, { name: 'Person 2', color: '#3b82f6' });

    await createTransport(trip1.id, {
      personId: person1.id,
      type: 'arrival',
      datetime: '2024-07-15T10:00:00.000Z',
      location: 'Airport 1',
      needsPickup: true,
    });
    await createTransport(trip2.id, {
      personId: person2.id,
      type: 'arrival',
      datetime: '2024-08-15T10:00:00.000Z',
      location: 'Airport 2',
      needsPickup: false,
    });

    // Verify initial counts
    expect(await db.trips.count()).toBe(2);
    expect(await db.rooms.count()).toBe(2);
    expect(await db.persons.count()).toBe(2);
    expect(await db.transports.count()).toBe(2);

    // Delete only trip1
    await deleteTrip(trip1.id);

    // Verify trip1 and its entities are deleted
    expect(await getTripById(trip1.id)).toBeUndefined();

    // Verify trip2 and its entities still exist
    expect(await getTripById(trip2.id)).toBeDefined();
    expect(await db.trips.count()).toBe(1);
    expect(await db.rooms.count()).toBe(1);
    expect(await db.persons.count()).toBe(1);
    expect(await db.transports.count()).toBe(1);

    // Verify remaining entities belong to trip2
    const remainingRooms = await db.rooms.toArray();
    expect(remainingRooms[0]?.tripId).toBe(trip2.id);

    const remainingPersons = await db.persons.toArray();
    expect(remainingPersons[0]?.tripId).toBe(trip2.id);

    const remainingTransports = await db.transports.toArray();
    expect(remainingTransports[0]?.tripId).toBe(trip2.id);
  });

  it('succeeds even when trip has no related entities', async () => {
    const trip = await createTrip(createValidTripData());

    // Delete trip with no related entities - should not throw
    await expect(deleteTrip(trip.id)).resolves.not.toThrow();

    expect(await getTripById(trip.id)).toBeUndefined();
  });

  it('is idempotent - deleting non-existent trip does not throw', async () => {
    const nonExistentId = 'trip_does_not_exist_x' as TripId;

    // Deleting non-existent trip should be a no-op
    await expect(deleteTrip(nonExistentId)).resolves.not.toThrow();
  });
});
