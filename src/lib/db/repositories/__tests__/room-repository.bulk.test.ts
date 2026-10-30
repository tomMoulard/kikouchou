/**
 * Integration tests for creating rooms several at a time, and for copying one.
 *
 * @module lib/db/repositories/__tests__/room-repository.bulk.test
 */
import { describe, it, expect } from 'vitest';

import { db } from '@/lib/db/database';
import {
  MAX_ROOMS_PER_SAVE,
  createRoom,
  createRooms,
  duplicateRoomWithOwnershipCheck,
  getRoomCount,
  getRoomsByTripId,
} from '@/lib/db/repositories/room-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { createPerson } from '@/lib/db/repositories/person-repository';
import { createAssignment } from '@/lib/db/repositories/assignment-repository';
import { hexColor, isoDate } from '@/test/utils';
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
    startDate: isoDate('2024-07-15'),
    endDate: isoDate('2024-07-22'),
  });
  return trip.id;
}

// ============================================================================
// Bulk Creation
// ============================================================================

describe('createRooms', () => {
  it('creates one room named exactly as asked', async () => {
    const tripId = await createTestTrip(),
     rooms = await createRooms(
      tripId,
      createTestRoomData({ name: 'Attic' }),
      1,
    );

    expect(rooms).toHaveLength(1);
    expect(rooms[0]?.name).toBe('Attic');
    expect(await getRoomCount(tripId)).toBe(1);
  });

  it('creates several numbered rooms in one call', async () => {
    const tripId = await createTestTrip(),
     rooms = await createRooms(
      tripId,
      createTestRoomData({ name: 'Double bed', capacity: 2 }),
      3,
    );

    expect(rooms.map((room) => room.name)).toEqual([
      'Double bed 1',
      'Double bed 2',
      'Double bed 3',
    ]);
    for (const room of rooms) {
      expect(room.capacity).toBe(2);
    }
  });

  it('gives every room its own id and a consecutive order', async () => {
    const tripId = await createTestTrip();

    await createRoom(tripId, createTestRoomData({ name: 'Existing' }));
    await createRooms(tripId, createTestRoomData({ name: 'Double bed' }), 3);

    const stored = await getRoomsByTripId(tripId);

    expect(stored.map((room) => room.order)).toEqual([0, 1, 2, 3]);
    expect(new Set(stored.map((room) => room.id)).size).toBe(4);
  });

  it('skips numbers the trip already uses', async () => {
    const tripId = await createTestTrip();

    await createRooms(tripId, createTestRoomData({ name: 'Double bed' }), 2);

    const more = await createRooms(
      tripId,
      createTestRoomData({ name: 'Double bed' }),
      2,
    );

    expect(more.map((room) => room.name)).toEqual([
      'Double bed 3',
      'Double bed 4',
    ]);
  });

  it('rejects a count below one', async () => {
    const tripId = await createTestTrip();

    await expect(createRooms(tripId, createTestRoomData(), 0)).rejects.toThrow(
      /how many rooms/iu,
    );
    expect(await getRoomCount(tripId)).toBe(0);
  });

  it('rejects a count above the per-save limit', async () => {
    const tripId = await createTestTrip();

    await expect(
      createRooms(tripId, createTestRoomData(), MAX_ROOMS_PER_SAVE + 1),
    ).rejects.toThrow(/how many rooms/iu);
    expect(await getRoomCount(tripId)).toBe(0);
  });

  it('rejects a fractional count', async () => {
    const tripId = await createTestTrip();

    await expect(
      createRooms(tripId, createTestRoomData(), 2.5),
    ).rejects.toThrow(/how many rooms/iu);
    expect(await getRoomCount(tripId)).toBe(0);
  });

  it('rejects an invalid capacity before writing anything', async () => {
    const tripId = await createTestTrip();

    await expect(
      createRooms(tripId, createTestRoomData({ capacity: 0 }), 3),
    ).rejects.toThrow(/capacity/iu);
    expect(await getRoomCount(tripId)).toBe(0);
  });
});

// ============================================================================
// Duplication
// ============================================================================

describe('duplicateRoomWithOwnershipCheck', () => {
  it('copies every detail of the room', async () => {
    const tripId = await createTestTrip(),
     source = await createRoom(
      tripId,
      createTestRoomData({
        name: 'Double bed',
        capacity: 2,
        description: 'Sea view',
        icon: 'bed-double',
      }),
    ),
     copy = await duplicateRoomWithOwnershipCheck(source.id, tripId);

    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toBe('Double bed 2');
    expect(copy.capacity).toBe(2);
    expect(copy.description).toBe('Sea view');
    expect(copy.icon).toBe('bed-double');
  });

  it('places the copy right after the original', async () => {
    const tripId = await createTestTrip(),
     first = await createRoom(tripId, createTestRoomData({ name: 'Attic' }));

    await createRoom(tripId, createTestRoomData({ name: 'Cellar' }));
    await createRoom(tripId, createTestRoomData({ name: 'Barn' }));

    await duplicateRoomWithOwnershipCheck(first.id, tripId);

    const stored = await getRoomsByTripId(tripId);

    expect(stored.map((room) => room.name)).toEqual([
      'Attic',
      'Attic 2',
      'Cellar',
      'Barn',
    ]);
    expect(stored.map((room) => room.order)).toEqual([0, 1, 2, 3]);
  });

  it('carries no assignment over from the original', async () => {
    const tripId = await createTestTrip(),
     source = await createRoom(tripId, createTestRoomData()),
     person = await createPerson(tripId, {
      name: 'Alice',
      color: hexColor('#ff0000'),
    });

    await createAssignment(tripId, {
      roomId: source.id,
      personId: person.id,
      startDate: isoDate('2024-07-15'),
      endDate: isoDate('2024-07-18'),
    });

    const copy = await duplicateRoomWithOwnershipCheck(source.id, tripId);

    expect(
      await db.roomAssignments.where('roomId').equals(copy.id).count(),
    ).toBe(0);
  });

  it('refuses a room from another trip', async () => {
    const tripId1 = await createTestTrip('Trip 1'),
     tripId2 = await createTestTrip('Trip 2'),
     room = await createRoom(tripId1, createTestRoomData());

    await expect(
      duplicateRoomWithOwnershipCheck(room.id, tripId2),
    ).rejects.toThrow('does not belong');
    expect(await getRoomCount(tripId1)).toBe(1);
  });

  it('refuses a room that does not exist', async () => {
    const tripId = await createTestTrip();

    await expect(
      duplicateRoomWithOwnershipCheck('missing' as RoomId, tripId),
    ).rejects.toThrow('not found');
  });
});
