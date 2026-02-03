/**
 * Room Repository
 *
 * Provides CRUD operations for Room entities with reordering support.
 * All operations use the Dexie.js database and branded types for type safety.
 *
 * @module lib/db/repositories/room-repository
 */

import { db } from '@/lib/db/database';
import { sanitizeRoomData } from '@/lib/db/sanitize';
import { createRoomId } from '@/lib/db/utils';
import type { Room, RoomFormData, RoomId, TripId } from '@/types';

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Validates that a room's capacity is a positive integer.
 *
 * @param capacity - The capacity value to validate
 * @throws {Error} If capacity is not a positive integer
 */
function validateCapacity(capacity: number): void {
  if (capacity < 1 || !Number.isInteger(capacity)) {
    throw new Error('Room capacity must be a positive integer');
  }
}

/**
 * Creates a new room in the database.
 *
 * Automatically assigns the next order value based on existing rooms in the trip.
 *
 * @param tripId - The trip this room belongs to
 * @param data - The room form data (name, capacity, description)
 * @returns The created Room object with all generated fields
 *
 * @example
 * ```typescript
 * const room = await createRoom(tripId, {
 *   name: 'Master bedroom',
 *   capacity: 2,
 *   description: 'King bed with ensuite',
 * });
 * ```
 */
export async function createRoom(
  tripId: TripId,
  data: RoomFormData,
): Promise<Room> {
  // Sanitize input data (trim whitespace, enforce max lengths)
  const sanitizedData = sanitizeRoomData(data);

  // Validate capacity (IMP-5 fix)
  validateCapacity(sanitizedData.capacity);

  try {
    // Get the next order value using last() on compound index (O(log n) instead of O(n))
    const lastRoom = await db.rooms
      .where('[tripId+order]')
      .between([tripId, 0], [tripId, Infinity])
      .last(),
     maxOrder = lastRoom?.order ?? -1,

     room: Room = {
      id: createRoomId(),
      tripId,
      ...sanitizedData,
      order: maxOrder + 1,
    };

    await db.rooms.add(room);
    return room;
  } catch (error) {
    throw new Error(`Failed to create room "${sanitizedData.name}" for trip ${tripId}`, { cause: error });
  }
}

/**
 * Retrieves all rooms for a trip, ordered by their display order.
 *
 * Uses the compound index [tripId+order] for efficient querying.
 *
 * @param tripId - The trip ID to filter by
 * @returns Array of rooms sorted by order ascending
 *
 * @example
 * ```typescript
 * const rooms = await getRoomsByTripId(tripId);
 * // rooms[0] is the first room in display order
 * ```
 */
export async function getRoomsByTripId(tripId: TripId): Promise<Room[]> {
  return db.rooms.where('[tripId+order]').between([tripId, 0], [tripId, Infinity]).toArray();
}

/**
 * Retrieves a room by its unique ID.
 *
 * @param id - The room's unique identifier
 * @returns The room if found, undefined otherwise
 *
 * @example
 * ```typescript
 * const room = await getRoomById(roomId);
 * if (room) {
 *   console.log(room.name);
 * }
 * ```
 */
export async function getRoomById(id: RoomId): Promise<Room | undefined> {
  return db.rooms.get(id);
}

/**
 * Updates an existing room with partial data.
 *
 * Only the provided fields in `data` are updated.
 *
 * @param id - The room's unique identifier
 * @param data - Partial room form data to update
 * @throws {Error} If the room with the given ID does not exist
 *
 * @example
 * ```typescript
 * await updateRoom(roomId, { name: 'New Room Name' });
 * ```
 */
export async function updateRoom(
  id: RoomId,
  data: Partial<RoomFormData>,
): Promise<void> {
  // Sanitize input data (trim whitespace, enforce max lengths)
  const sanitizedData: Partial<RoomFormData> = { ...data };
  if (sanitizedData.name !== undefined) {
    sanitizedData.name = sanitizeRoomData({
      name: sanitizedData.name,
      capacity: 1,
    }).name;
  }
  if (sanitizedData.description !== undefined) {
    sanitizedData.description = sanitizeRoomData({
      name: '',
      capacity: 1,
      description: sanitizedData.description,
    }).description;
  }

  // Validate capacity if being updated (IMP-5 fix)
  if (sanitizedData.capacity !== undefined) {
    validateCapacity(sanitizedData.capacity);
  }

  const updatedCount = await db.rooms.update(id, sanitizedData);

  if (updatedCount === 0) {
    throw new Error(`Room with id "${id}" not found`);
  }
}

/**
 * Deletes a room and all its associated room assignments.
 *
 * Uses a transaction to ensure atomicity. If any deletion fails,
 * the entire operation is rolled back.
 *
 * @param id - The room's unique identifier
 *
 * @example
 * ```typescript
 * await deleteRoom(roomId);
 * // Room and its assignments are deleted
 * ```
 */
export async function deleteRoom(id: RoomId): Promise<void> {
  try {
    await db.transaction('rw', [db.rooms, db.roomAssignments], async () => {
      // Delete room assignments for this room
      await db.roomAssignments.where('roomId').equals(id).delete();

      // Delete the room itself
      await db.rooms.delete(id);
    });
  } catch (error) {
    throw new Error(`Failed to delete room ${id}`, { cause: error });
  }
}

/**
 * Reorders rooms within a trip by updating their order values.
 *
 * The order of room IDs in the array determines the new display order.
 * Uses a transaction to ensure atomicity.
 *
 * @param tripId - The trip ID (used for validation)
 * @param roomIds - Array of room IDs in the desired order
 * @throws {Error} If any room ID doesn't exist or doesn't belong to the trip
 *
 * @example
 * ```typescript
 * // Move room3 to the top
 * await reorderRooms(tripId, [room3Id, room1Id, room2Id]);
 * ```
 */
export async function reorderRooms(
  tripId: TripId,
  roomIds: RoomId[],
): Promise<void> {
  try {
    await db.transaction('rw', db.rooms, async () => {
      // Validate all rooms exist and belong to the trip
      const rooms = await db.rooms.where('tripId').equals(tripId).toArray(),
       roomMap = new Map(rooms.map((r) => [r.id, r]));

      for (const roomId of roomIds) {
        if (!roomMap.has(roomId)) {
          throw new Error(
            `Room with id "${roomId}" not found or doesn't belong to trip "${tripId}"`,
          );
        }
      }

      // Update order values
      const updates = roomIds.map((roomId, index) =>
        db.rooms.update(roomId, { order: index }),
      );

      await Promise.all(updates);
    });
  } catch (error) {
    // Re-throw validation errors as-is, wrap database errors with context
    if (error instanceof Error && error.message.includes('not found or doesn\'t belong to trip')) {
      throw error;
    }
    throw new Error(`Failed to reorder rooms for trip ${tripId}`, { cause: error });
  }
}

/**
 * Gets the count of rooms for a trip.
 *
 * @param tripId - The trip ID to count rooms for
 * @returns Number of rooms in the trip
 *
 * @example
 * ```typescript
 * const count = await getRoomCount(tripId);
 * ```
 */
export async function getRoomCount(tripId: TripId): Promise<number> {
  return db.rooms.where('tripId').equals(tripId).count();
}

// ============================================================================
// Transactional Operations with Ownership Validation (CR-2 fix)
// ============================================================================

/**
 * Updates a room with ownership validation in a single transaction.
 * Prevents TOCTOU race condition by combining validation and mutation atomically.
 *
 * @param id - The room's unique identifier
 * @param tripId - The expected trip ID for ownership validation
 * @param data - Partial room form data to update
 * @throws {Error} If room not found or doesn't belong to the specified trip
 *
 * @example
 * ```typescript
 * await updateRoomWithOwnershipCheck(roomId, currentTripId, { name: 'New Name' });
 * ```
 */
export async function updateRoomWithOwnershipCheck(
  id: RoomId,
  tripId: TripId,
  data: Partial<RoomFormData>,
): Promise<void> {
  // Validate capacity if being updated (IMP-5 fix)
  if (data.capacity !== undefined) {
    validateCapacity(data.capacity);
  }

  await db.transaction('rw', db.rooms, async () => {
    const room = await db.rooms.get(id);

    if (!room) {
      throw new Error(`Room with ID "${id}" not found`);
    }
    if (room.tripId !== tripId) {
      throw new Error('Cannot update room: room does not belong to current trip');
    }

    await db.rooms.update(id, data);
  });
}

/**
 * Deletes a room with ownership validation in a single transaction.
 * Prevents TOCTOU race condition by combining validation and deletion atomically.
 * Also deletes associated room assignments.
 *
 * @param id - The room's unique identifier
 * @param tripId - The expected trip ID for ownership validation
 * @throws {Error} If room not found or doesn't belong to the specified trip
 *
 * @example
 * ```typescript
 * await deleteRoomWithOwnershipCheck(roomId, currentTripId);
 * ```
 */
export async function deleteRoomWithOwnershipCheck(
  id: RoomId,
  tripId: TripId,
): Promise<void> {
  await db.transaction('rw', [db.rooms, db.roomAssignments], async () => {
    const room = await db.rooms.get(id);

    if (!room) {
      throw new Error(`Room with ID "${id}" not found`);
    }
    if (room.tripId !== tripId) {
      throw new Error('Cannot delete room: room does not belong to current trip');
    }

    // Delete room assignments for this room
    await db.roomAssignments.where('roomId').equals(id).delete();

    // Delete the room itself
    await db.rooms.delete(id);
  });
}
