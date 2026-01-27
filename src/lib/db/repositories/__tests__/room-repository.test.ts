/**
 * Integration tests for Room Repository
 *
 * Tests CRUD operations, auto-ordering, cascade delete, and reordering
 * for the room-repository module.
 *
 * @module lib/db/repositories/__tests__/room-repository.test
 */
import { describe, it, expect } from 'vitest';
import { db } from '@/lib/db/database';
import {
  createRoom,
  getRoomsByTripId,
  getRoomById,
  updateRoom,
  deleteRoom,
  reorderRooms,
  getRoomCount,
} from '@/lib/db/repositories/room-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { createPerson } from '@/lib/db/repositories/person-repository';
import { createAssignment } from '@/lib/db/repositories/assignment-repository';
import type { RoomFormData, RoomId, TripId } from '@/types';

// ============================================================================
// Test Data Factories
// ============================================================================

/**
 * Creates valid room form data with optional overrides.
 */
function createTestRoomData(overrides?: Partial<RoomFormData>): RoomFormData {
  return {
    name: 'Test Room',
    capacity: 2,
    description: 'A test room',
    ...overrides,
  };
}

/**
 * Creates a test trip and returns its ID.
 */
async function createTestTrip(name = 'Test Trip'): Promise<TripId> {
  const trip = await createTrip({
    name,
    startDate: '2024-07-15',
    endDate: '2024-07-22',
  });
  return trip.id;
}

// ============================================================================
// Test Setup
// ============================================================================

// Note: Database clearing and mock restoration are handled by global setup.ts
// - beforeEach clears all 6 tables (trips, rooms, persons, roomAssignments, transports, settings)
// - afterEach calls cleanup() and vi.clearAllMocks()

// ============================================================================
// createRoom Tests
// ============================================================================

describe('createRoom', () => {
  it('creates room with auto-assigned order starting at 0', async () => {
    const tripId = await createTestTrip();
    const data = createTestRoomData({ name: 'First Room' });

    const room = await createRoom(tripId, data);

    expect(room.order).toBe(0);
    expect(room.name).toBe('First Room');
    expect(room.tripId).toBe(tripId);
  });

  it('assigns next order value based on existing rooms', async () => {
    const tripId = await createTestTrip();

    const room1 = await createRoom(tripId, createTestRoomData({ name: 'Room 1' }));
    const room2 = await createRoom(tripId, createTestRoomData({ name: 'Room 2' }));
    const room3 = await createRoom(tripId, createTestRoomData({ name: 'Room 3' }));

    expect(room1.order).toBe(0);
    expect(room2.order).toBe(1);
    expect(room3.order).toBe(2);
  });

  it('handles gaps in order values correctly', async () => {
    const tripId = await createTestTrip();

    // Create first room
    const room1 = await createRoom(tripId, createTestRoomData({ name: 'Room 1' }));
    expect(room1.order).toBe(0);

    // Manually set room order to 10 to create a gap
    await db.rooms.update(room1.id, { order: 10 });

    // Create new room - should get order 11 (max + 1)
    const room2 = await createRoom(tripId, createTestRoomData({ name: 'Room 2' }));
    expect(room2.order).toBe(11);
  });

  it('generates unique room IDs', async () => {
    const tripId = await createTestTrip();

    const room1 = await createRoom(tripId, createTestRoomData({ name: 'Room 1' }));
    const room2 = await createRoom(tripId, createTestRoomData({ name: 'Room 2' }));
    const room3 = await createRoom(tripId, createTestRoomData({ name: 'Room 3' }));

    const ids = [room1.id, room2.id, room3.id];
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(3);
  });

  it('associates room with correct tripId', async () => {
    const tripId1 = await createTestTrip('Trip 1');
    const tripId2 = await createTestTrip('Trip 2');

    const room1 = await createRoom(tripId1, createTestRoomData({ name: 'Room for Trip 1' }));
    const room2 = await createRoom(tripId2, createTestRoomData({ name: 'Room for Trip 2' }));

    expect(room1.tripId).toBe(tripId1);
    expect(room2.tripId).toBe(tripId2);
  });

  it('persists room to database', async () => {
    const tripId = await createTestTrip();
    const room = await createRoom(tripId, createTestRoomData());

    const retrieved = await getRoomById(room.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(room.id);
  });

  it('creates room with all form data fields', async () => {
    const tripId = await createTestTrip();
    const data = createTestRoomData({
      name: 'Master Bedroom',
      capacity: 4,
      description: 'King bed with ensuite bathroom',
    });

    const room = await createRoom(tripId, data);

    expect(room.name).toBe('Master Bedroom');
    expect(room.capacity).toBe(4);
    expect(room.description).toBe('King bed with ensuite bathroom');
  });

  it('creates room without optional description', async () => {
    const tripId = await createTestTrip();
    const data: RoomFormData = {
      name: 'Simple Room',
      capacity: 2,
    };

    const room = await createRoom(tripId, data);

    expect(room.name).toBe('Simple Room');
    expect(room.capacity).toBe(2);
    expect(room.description).toBeUndefined();
  });
});

// ============================================================================
// getRoomsByTripId Tests
// ============================================================================

describe('getRoomsByTripId', () => {
  it('returns rooms sorted by order ascending', async () => {
    const tripId = await createTestTrip();

    // Create rooms
    const room1 = await createRoom(tripId, createTestRoomData({ name: 'Room A' }));
    const room2 = await createRoom(tripId, createTestRoomData({ name: 'Room B' }));
    const room3 = await createRoom(tripId, createTestRoomData({ name: 'Room C' }));

    // Manually reorder them in database
    await db.rooms.update(room1.id, { order: 2 });
    await db.rooms.update(room2.id, { order: 0 });
    await db.rooms.update(room3.id, { order: 1 });

    const rooms = await getRoomsByTripId(tripId);

    expect(rooms).toHaveLength(3);
    expect(rooms[0]?.name).toBe('Room B'); // order 0
    expect(rooms[1]?.name).toBe('Room C'); // order 1
    expect(rooms[2]?.name).toBe('Room A'); // order 2
  });

  it('returns empty array for non-existent trip', async () => {
    const nonExistentTripId = 'trip_does_not_exist' as TripId;

    const rooms = await getRoomsByTripId(nonExistentTripId);

    expect(rooms).toEqual([]);
    expect(rooms).toHaveLength(0);
  });

  it('returns empty array for trip with no rooms', async () => {
    const tripId = await createTestTrip();

    const rooms = await getRoomsByTripId(tripId);

    expect(rooms).toEqual([]);
  });

  it('only returns rooms for specified trip', async () => {
    const tripId1 = await createTestTrip('Trip 1');
    const tripId2 = await createTestTrip('Trip 2');

    await createRoom(tripId1, createTestRoomData({ name: 'Room for Trip 1 - A' }));
    await createRoom(tripId1, createTestRoomData({ name: 'Room for Trip 1 - B' }));
    await createRoom(tripId2, createTestRoomData({ name: 'Room for Trip 2' }));

    const roomsTrip1 = await getRoomsByTripId(tripId1);
    const roomsTrip2 = await getRoomsByTripId(tripId2);

    expect(roomsTrip1).toHaveLength(2);
    expect(roomsTrip2).toHaveLength(1);
    expect(roomsTrip1[0]?.tripId).toBe(tripId1);
    expect(roomsTrip1[1]?.tripId).toBe(tripId1);
    expect(roomsTrip2[0]?.tripId).toBe(tripId2);
  });
});

// ============================================================================
// getRoomById Tests
// ============================================================================

describe('getRoomById', () => {
  it('returns room when found', async () => {
    const tripId = await createTestTrip();
    const created = await createRoom(tripId, createTestRoomData({ name: 'Find Me' }));

    const found = await getRoomById(created.id);

    expect(found).toBeDefined();
    expect(found?.id).toBe(created.id);
    expect(found?.name).toBe('Find Me');
    expect(found?.tripId).toBe(tripId);
  });

  it('returns undefined for non-existent id', async () => {
    const nonExistentId = 'room_does_not_exist' as RoomId;

    const found = await getRoomById(nonExistentId);

    expect(found).toBeUndefined();
  });

  it('returns correct room when multiple exist', async () => {
    const tripId = await createTestTrip();
    const room1 = await createRoom(tripId, createTestRoomData({ name: 'Room 1' }));
    const room2 = await createRoom(tripId, createTestRoomData({ name: 'Room 2' }));

    const found = await getRoomById(room2.id);

    expect(found?.id).toBe(room2.id);
    expect(found?.name).toBe('Room 2');
    expect(found?.id).not.toBe(room1.id);
  });
});

// ============================================================================
// updateRoom Tests
// ============================================================================

describe('updateRoom', () => {
  it('updates room properties', async () => {
    const tripId = await createTestTrip();
    const room = await createRoom(tripId, createTestRoomData({ name: 'Original' }));

    await updateRoom(room.id, { name: 'Updated', capacity: 5 });

    const updated = await getRoomById(room.id);
    expect(updated?.name).toBe('Updated');
    expect(updated?.capacity).toBe(5);
  });

  it('performs partial updates', async () => {
    const tripId = await createTestTrip();
    const room = await createRoom(
      tripId,
      createTestRoomData({
        name: 'Original Name',
        capacity: 3,
        description: 'Original Description',
      })
    );

    // Only update name
    await updateRoom(room.id, { name: 'New Name' });

    const updated = await getRoomById(room.id);
    expect(updated?.name).toBe('New Name');
    expect(updated?.capacity).toBe(3); // Unchanged
    expect(updated?.description).toBe('Original Description'); // Unchanged
  });

  it('throws error when room not found', async () => {
    const nonExistentId = 'room_does_not_exist' as RoomId;

    await expect(updateRoom(nonExistentId, { name: 'New Name' })).rejects.toThrow(
      `Room with id "${nonExistentId}" not found`
    );
  });

  it('does not modify other rooms', async () => {
    const tripId = await createTestTrip();
    const room1 = await createRoom(tripId, createTestRoomData({ name: 'Room 1' }));
    const room2 = await createRoom(tripId, createTestRoomData({ name: 'Room 2' }));

    await updateRoom(room1.id, { name: 'Updated Room 1' });

    const retrieved1 = await getRoomById(room1.id);
    const retrieved2 = await getRoomById(room2.id);

    expect(retrieved1?.name).toBe('Updated Room 1');
    expect(retrieved2?.name).toBe('Room 2'); // Unchanged
  });
});

// ============================================================================
// deleteRoom Tests
// ============================================================================

describe('deleteRoom', () => {
  it('deletes room from database', async () => {
    const tripId = await createTestTrip();
    const room = await createRoom(tripId, createTestRoomData());

    expect(await db.rooms.count()).toBe(1);

    await deleteRoom(room.id);

    expect(await db.rooms.count()).toBe(0);
    expect(await getRoomById(room.id)).toBeUndefined();
  });

  it('cascade deletes room assignments', async () => {
    const tripId = await createTestTrip();
    const room = await createRoom(tripId, createTestRoomData());
    const person = await createPerson(tripId, { name: 'Alice', color: '#ef4444' });

    // Create room assignment
    await createAssignment(tripId, {
      roomId: room.id,
      personId: person.id,
      startDate: '2024-07-15',
      endDate: '2024-07-20',
    });

    // Verify assignment exists
    expect(await db.roomAssignments.count()).toBe(1);

    // Delete room
    await deleteRoom(room.id);

    // Verify room deleted
    expect(await db.rooms.count()).toBe(0);

    // Verify assignment cascade deleted
    expect(await db.roomAssignments.count()).toBe(0);

    // Verify person still exists (not cascade deleted)
    expect(await db.persons.count()).toBe(1);
  });

  it('only deletes assignments for specified room', async () => {
    const tripId = await createTestTrip();
    const room1 = await createRoom(tripId, createTestRoomData({ name: 'Room 1' }));
    const room2 = await createRoom(tripId, createTestRoomData({ name: 'Room 2' }));
    const person = await createPerson(tripId, { name: 'Alice', color: '#ef4444' });

    // Create assignment for each room
    await createAssignment(tripId, {
      roomId: room1.id,
      personId: person.id,
      startDate: '2024-07-15',
      endDate: '2024-07-17',
    });
    await createAssignment(tripId, {
      roomId: room2.id,
      personId: person.id,
      startDate: '2024-07-18',
      endDate: '2024-07-20',
    });

    expect(await db.roomAssignments.count()).toBe(2);

    // Delete only room1
    await deleteRoom(room1.id);

    // Verify room1's assignment deleted but room2's remains
    expect(await db.rooms.count()).toBe(1);
    expect(await db.roomAssignments.count()).toBe(1);

    const remainingAssignments = await db.roomAssignments.toArray();
    expect(remainingAssignments[0]?.roomId).toBe(room2.id);
  });

  it('handles room with no assignments', async () => {
    const tripId = await createTestTrip();
    const room = await createRoom(tripId, createTestRoomData());

    // Delete room without assignments - should not throw
    await expect(deleteRoom(room.id)).resolves.not.toThrow();

    expect(await db.rooms.count()).toBe(0);
  });

  it('is idempotent - deleting non-existent room does not throw', async () => {
    const nonExistentId = 'room_does_not_exist' as RoomId;

    await expect(deleteRoom(nonExistentId)).resolves.not.toThrow();
  });
});

// ============================================================================
// reorderRooms Tests
// ============================================================================

describe('reorderRooms', () => {
  it('reorders rooms correctly', async () => {
    const tripId = await createTestTrip();

    // Create rooms in order A:0, B:1, C:2
    const roomA = await createRoom(tripId, createTestRoomData({ name: 'Room A' }));
    const roomB = await createRoom(tripId, createTestRoomData({ name: 'Room B' }));
    const roomC = await createRoom(tripId, createTestRoomData({ name: 'Room C' }));

    // Reorder to C, A, B
    await reorderRooms(tripId, [roomC.id, roomA.id, roomB.id]);

    // Verify new orders
    const reorderedC = await getRoomById(roomC.id);
    const reorderedA = await getRoomById(roomA.id);
    const reorderedB = await getRoomById(roomB.id);

    expect(reorderedC?.order).toBe(0);
    expect(reorderedA?.order).toBe(1);
    expect(reorderedB?.order).toBe(2);

    // Verify getRoomsByTripId returns in new order
    const rooms = await getRoomsByTripId(tripId);
    expect(rooms[0]?.name).toBe('Room C');
    expect(rooms[1]?.name).toBe('Room A');
    expect(rooms[2]?.name).toBe('Room B');
  });

  it('validates room ownership within trip', async () => {
    const tripId1 = await createTestTrip('Trip 1');
    const tripId2 = await createTestTrip('Trip 2');

    const room1 = await createRoom(tripId1, createTestRoomData({ name: 'Room for Trip 1' }));
    const room2 = await createRoom(tripId2, createTestRoomData({ name: 'Room for Trip 2' }));

    // Attempt to reorder trip1's rooms with trip2's room
    await expect(reorderRooms(tripId1, [room1.id, room2.id])).rejects.toThrow(
      `Room with id "${room2.id}" not found or doesn't belong to trip "${tripId1}"`
    );
  });

  it('rejects invalid room IDs', async () => {
    const tripId = await createTestTrip();
    const room = await createRoom(tripId, createTestRoomData());
    const nonExistentId = 'room_does_not_exist' as RoomId;

    await expect(reorderRooms(tripId, [room.id, nonExistentId])).rejects.toThrow(
      `Room with id "${nonExistentId}" not found or doesn't belong to trip "${tripId}"`
    );
  });

  it('handles empty roomIds array', async () => {
    const tripId = await createTestTrip();
    await createRoom(tripId, createTestRoomData({ name: 'Room 1' }));

    // Reorder with empty array should succeed without changes
    await expect(reorderRooms(tripId, [])).resolves.not.toThrow();

    // Verify room order unchanged
    const rooms = await getRoomsByTripId(tripId);
    expect(rooms[0]?.order).toBe(0);
  });

  it('handles partial room list', async () => {
    const tripId = await createTestTrip();

    const room1 = await createRoom(tripId, createTestRoomData({ name: 'Room 1' }));
    const room2 = await createRoom(tripId, createTestRoomData({ name: 'Room 2' }));
    const room3 = await createRoom(tripId, createTestRoomData({ name: 'Room 3' }));

    // Only reorder 2 of 3 rooms
    await reorderRooms(tripId, [room2.id, room1.id]);

    // Verify specified rooms reordered
    const reordered1 = await getRoomById(room1.id);
    const reordered2 = await getRoomById(room2.id);
    const reordered3 = await getRoomById(room3.id);

    expect(reordered2?.order).toBe(0);
    expect(reordered1?.order).toBe(1);
    // Room 3 was not in reorder list - order unchanged
    expect(reordered3?.order).toBe(2);
  });

  it('maintains atomicity on validation error', async () => {
    const tripId = await createTestTrip();

    const room1 = await createRoom(tripId, createTestRoomData({ name: 'Room 1' }));
    const room2 = await createRoom(tripId, createTestRoomData({ name: 'Room 2' }));
    const nonExistentId = 'room_does_not_exist' as RoomId;

    // Get original orders
    const original1 = await getRoomById(room1.id);
    const original2 = await getRoomById(room2.id);

    // Attempt reorder with invalid ID (should fail validation before any updates)
    await expect(
      reorderRooms(tripId, [room2.id, nonExistentId, room1.id])
    ).rejects.toThrow(
      `Room with id "${nonExistentId}" not found or doesn't belong to trip "${tripId}"`
    );

    // Verify orders unchanged (transaction rolled back)
    const after1 = await getRoomById(room1.id);
    const after2 = await getRoomById(room2.id);

    expect(after1?.order).toBe(original1?.order);
    expect(after2?.order).toBe(original2?.order);
  });
});

// ============================================================================
// getRoomCount Tests
// ============================================================================

describe('getRoomCount', () => {
  it('returns correct count for trip with rooms', async () => {
    const tripId = await createTestTrip();

    await createRoom(tripId, createTestRoomData({ name: 'Room 1' }));
    await createRoom(tripId, createTestRoomData({ name: 'Room 2' }));
    await createRoom(tripId, createTestRoomData({ name: 'Room 3' }));

    const count = await getRoomCount(tripId);

    expect(count).toBe(3);
  });

  it('returns 0 for trip with no rooms', async () => {
    const tripId = await createTestTrip();

    const count = await getRoomCount(tripId);

    expect(count).toBe(0);
  });

  it('returns 0 for non-existent trip', async () => {
    const nonExistentTripId = 'trip_does_not_exist' as TripId;

    const count = await getRoomCount(nonExistentTripId);

    expect(count).toBe(0);
  });

  it('only counts rooms for specified trip', async () => {
    const tripId1 = await createTestTrip('Trip 1');
    const tripId2 = await createTestTrip('Trip 2');

    await createRoom(tripId1, createTestRoomData({ name: 'Trip 1 - Room 1' }));
    await createRoom(tripId1, createTestRoomData({ name: 'Trip 1 - Room 2' }));
    await createRoom(tripId2, createTestRoomData({ name: 'Trip 2 - Room 1' }));

    const count1 = await getRoomCount(tripId1);
    const count2 = await getRoomCount(tripId2);

    expect(count1).toBe(2);
    expect(count2).toBe(1);
  });
});
