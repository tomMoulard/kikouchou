/**
 * Room Repository
 *
 * Provides CRUD operations for Room entities with reordering support.
 * All operations use the Dexie.js database and branded types for type safety.
 *
 * @module lib/db/repositories/room-repository
 */

import { db } from '@/lib/db/database';
import { createRoomId } from '@/lib/db/utils';
import type { Room, RoomFormData, RoomId, TripId } from '@/types';

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
  // Get the next order value using last() on compound index (O(log n) instead of O(n))
  const lastRoom = await db.rooms
    .where('[tripId+order]')
    .between([tripId, 0], [tripId, Infinity])
    .last(),
   maxOrder = lastRoom?.order ?? -1,

   room: Room = {
    id: createRoomId(),
    tripId,
    ...data,
    order: maxOrder + 1,
  };

  await db.rooms.add(room);
  return room;
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
  const updatedCount = await db.rooms.update(id, data);

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
  await db.transaction('rw', [db.rooms, db.roomAssignments], async () => {
    // Delete room assignments for this room
    await db.roomAssignments.where('roomId').equals(id).delete();

    // Delete the room itself
    await db.rooms.delete(id);
  });
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
