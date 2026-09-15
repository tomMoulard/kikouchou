/**
 * Room Repository
 *
 * Provides CRUD operations for Room entities with reordering support.
 * All operations use the Dexie.js database and branded types for type safety.
 *
 * @module lib/db/repositories/room-repository
 */

import {
  buildBulkRoomNames,
  buildDuplicateRoomName,
} from '@/features/rooms/utils/room-naming';
import { db } from '@/lib/db/database';
import { sanitizeRoomData } from '@/lib/db/sanitize';
import { createRoomId } from '@/lib/db/utils';
import type { Room, RoomFormData, RoomId, TripId } from '@/types';
import { repositoryError } from '@/lib/db/repository-error';

// ============================================================================
// Constants
// ============================================================================

/**
 * How many rooms one save may create.
 *
 * A house with more sleeping spots than this exists, and it is still entered in
 * more than one save: the count is a convenience for identical rooms, not an
 * import path, and an unbounded one is a way to fill IndexedDB from a single
 * field.
 */
export const MAX_ROOMS_PER_SAVE = 20;

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
 * Validates how many rooms one save asks for.
 *
 * @param count - The number of rooms to create
 * @throws {Error} If count is not a whole number from 1 to {@link MAX_ROOMS_PER_SAVE}
 */
function validateCount(count: number): void {
  if (!Number.isInteger(count) || count < 1 || count > MAX_ROOMS_PER_SAVE) {
    throw new Error(
      `How many rooms must be a whole number from 1 to ${MAX_ROOMS_PER_SAVE}`,
    );
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
  const [room] = await createRooms(tripId, data, 1);

  // createRooms returns exactly `count` rooms or throws, so this is unreachable.
  // It stands in for a non-null assertion under noUncheckedIndexedAccess.
  if (!room) {
    throw new Error(`Failed to create room "${data.name}" for trip ${tripId}`);
  }

  return room;
}

/**
 * Creates one room, or several identical ones, in a single transaction.
 *
 * Six identical doubles is one name and a count rather than six passes through
 * the dialog. Every room shares the capacity, description and icon it was given
 * and takes its own name and order: one room keeps the name as typed, several
 * are numbered from it (see `buildBulkRoomNames`).
 *
 * @param tripId - The trip these rooms belong to
 * @param data - The room form data shared by every room
 * @param count - How many rooms to create, from 1 to {@link MAX_ROOMS_PER_SAVE}
 * @returns The created rooms, in creation order
 * @throws {Error} If the capacity or the count is invalid
 *
 * @example
 * ```typescript
 * const rooms = await createRooms(tripId, {
 *   name: 'Double bed',
 *   capacity: 2,
 * }, 3);
 * // 'Double bed 1', 'Double bed 2', 'Double bed 3'
 * ```
 */
export async function createRooms(
  tripId: TripId,
  data: RoomFormData,
  count = 1,
): Promise<Room[]> {
  // Sanitize input data (trim whitespace, enforce max lengths)
  const sanitizedData = sanitizeRoomData(data);

  // Validate capacity (IMP-5 fix) and the count, before any write
  validateCapacity(sanitizedData.capacity);
  validateCount(count);

  try {
    return await db.transaction('rw', db.rooms, async () => {
      // Read the whole trip rather than only its last room: the names of the
      // rooms already there decide which numbers the new ones may take.
      const existing = await db.rooms
        .where('[tripId+order]')
        .between([tripId, 0], [tripId, Infinity])
        .toArray(),
       maxOrder = existing.at(-1)?.order ?? -1,

       rooms: Room[] = buildBulkRoomNames(
        sanitizedData.name,
        count,
        existing.map((room) => room.name),
      ).map((name, index) => ({
        id: createRoomId(),
        tripId,
        ...sanitizedData,
        name,
        order: maxOrder + 1 + index,
      }));

      await db.rooms.bulkAdd(rooms);
      return rooms;
    });
  } catch (error) {
    throw repositoryError(
      `Failed to create ${count} room(s) "${sanitizedData.name}" for trip ${tripId}`,
      error,
    );
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
 * @deprecated Use {@link updateRoomWithOwnershipCheck} instead.
 * This function will be removed in a future version.
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
 * @deprecated Use {@link deleteRoomWithOwnershipCheck} instead.
 * This function will be removed in a future version.
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
    throw repositoryError(`Failed to delete room ${id}`, error);
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
    throw repositoryError(`Failed to reorder rooms for trip ${tripId}`, error);
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
// Import / Clone Operations
// ============================================================================

/**
 * Clones all rooms from a source trip to a target trip.
 *
 * Creates new rooms in the target trip with new IDs, preserving name, capacity,
 * description, icon, and relative ordering from the source trip.
 * Existing rooms in the target trip are not affected.
 *
 * @param sourceTripId - The trip to clone rooms from
 * @param targetTripId - The trip to clone rooms into
 * @returns Array of newly created Room objects
 *
 * @example
 * ```typescript
 * const clonedRooms = await cloneRoomsToTrip(oldTripId, newTripId);
 * console.log(`Cloned ${clonedRooms.length} rooms`);
 * ```
 */
export async function cloneRoomsToTrip(
  sourceTripId: TripId,
  targetTripId: TripId,
): Promise<Room[]> {
  const sourceRooms = await getRoomsByTripId(sourceTripId);

  if (sourceRooms.length === 0) {
    return [];
  }

  try {
    // Get the current max order in the target trip to append after existing rooms
    const lastTargetRoom = await db.rooms
      .where('[tripId+order]')
      .between([targetTripId, 0], [targetTripId, Infinity])
      .last();
    const baseOrder = lastTargetRoom ? lastTargetRoom.order + 1 : 0;

    const clonedRooms: Room[] = sourceRooms.map((sourceRoom, index) => ({
      id: createRoomId(),
      tripId: targetTripId,
      name: sourceRoom.name,
      capacity: sourceRoom.capacity,
      description: sourceRoom.description,
      icon: sourceRoom.icon,
      order: baseOrder + index,
    }));

    await db.transaction('rw', db.rooms, async () => {
      await db.rooms.bulkAdd(clonedRooms);
    });

    return clonedRooms;
  } catch (error) {
    throw repositoryError(
      `Failed to clone rooms from trip ${sourceTripId} to trip ${targetTripId}`,
      error,
    );
  }
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
 * Copies a room within its trip, with ownership validation, in a single
 * transaction.
 *
 * The copy takes the original's capacity, description and icon, a name that
 * continues the original's number series, and the order right after the
 * original, so it lands beside the room it came from rather than at the end of
 * a long list. Assignments are not copied: the beds are new and empty.
 *
 * @param id - The room to copy
 * @param tripId - The expected trip ID for ownership validation
 * @returns The created copy
 * @throws {Error} If room not found or doesn't belong to the specified trip
 *
 * @example
 * ```typescript
 * const copy = await duplicateRoomWithOwnershipCheck(roomId, currentTripId);
 * ```
 */
export async function duplicateRoomWithOwnershipCheck(
  id: RoomId,
  tripId: TripId,
): Promise<Room> {
  return db.transaction('rw', db.rooms, async () => {
    const source = await db.rooms.get(id);

    if (!source) {
      throw new Error(`Room with ID "${id}" not found`);
    }
    if (source.tripId !== tripId) {
      throw new Error(
        'Cannot duplicate room: room does not belong to current trip',
      );
    }

    const siblings = await db.rooms.where('tripId').equals(tripId).toArray(),

     copy: Room = {
      id: createRoomId(),
      tripId,
      name: buildDuplicateRoomName(
        source.name,
        siblings.map((room) => room.name),
      ),
      capacity: source.capacity,
      description: source.description,
      icon: source.icon,
      order: source.order + 1,
    },

    // Push the rooms below the original down one, so the copy has a free
    // order of its own. Read and rewrite rather than `modify` over the
    // `[tripId+order]` range: raising an indexed key while scanning that same
    // index can hand the same row back a second time.
     shifted = siblings
      .filter((room) => room.order > source.order)
      .map((room) => ({ ...room, order: room.order + 1 }));

    if (shifted.length > 0) {
      await db.rooms.bulkPut(shifted);
    }
    await db.rooms.add(copy);

    return copy;
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
