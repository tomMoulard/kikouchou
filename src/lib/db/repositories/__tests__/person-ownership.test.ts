/**
 * Tests for ownership-check operations in person-repository.
 *
 * @module lib/db/repositories/__tests__/person-ownership.test
 */
import { describe, it, expect } from 'vitest';
import {
  createPerson,
  updatePersonWithOwnershipCheck,
  deletePersonWithOwnershipCheck,
  getPersonById,
  searchPersonsByName,
} from '@/lib/db/repositories/person-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { createRoom } from '@/lib/db/repositories/room-repository';
import { createAssignment } from '@/lib/db/repositories/assignment-repository';
import { createTransport } from '@/lib/db/repositories/transport-repository';
import { db } from '@/lib/db/database';
import type { ChildSeatKind, PersonId, TripId } from '@/types';
import { isoDate, hexColor } from '@/test/utils';

// ============================================================================
// Test Helpers
// ============================================================================

async function createTestTrip(name = 'Test Trip'): Promise<TripId> {
  const trip = await createTrip({
    name,
    startDate: isoDate('2024-07-15'),
    endDate: isoDate('2024-07-22'),
  });
  return trip.id;
}

// ============================================================================
// updatePersonWithOwnershipCheck
// ============================================================================

describe('updatePersonWithOwnershipCheck', () => {
  it('updates person when ownership is valid', async () => {
    const tripId = await createTestTrip();
    const person = await createPerson(tripId, { name: 'Alice', color: hexColor('#ef4444') });

    await updatePersonWithOwnershipCheck(person.id, tripId, { name: 'Alice Updated' });

    const updated = await getPersonById(person.id);
    expect(updated?.name).toBe('Alice Updated');
  });

  it('throws when person does not exist', async () => {
    const tripId = await createTestTrip();

    await expect(
      updatePersonWithOwnershipCheck('nonexistent' as PersonId, tripId, { name: 'x' })
    ).rejects.toThrow('not found');
  });

  it('throws when person belongs to different trip', async () => {
    const tripId1 = await createTestTrip('Trip 1');
    const tripId2 = await createTestTrip('Trip 2');
    const person = await createPerson(tripId1, { name: 'Alice', color: hexColor('#ef4444') });

    await expect(
      updatePersonWithOwnershipCheck(person.id, tripId2, { name: 'x' })
    ).rejects.toThrow('does not belong to current trip');
  });

  it('stores a child seat kind it knows', async () => {
    const tripId = await createTestTrip();
    const person = await createPerson(tripId, { name: 'Lila', color: hexColor('#22c55e') });

    await updatePersonWithOwnershipCheck(person.id, tripId, { childSeat: 'booster' });

    expect((await getPersonById(person.id))?.childSeat).toBe('booster');
  });

  it('drops a child seat kind it does not know', async () => {
    // This is the path the guest form takes, and also the one a non-form caller
    // takes; only the second can name a kind that does not exist.
    const tripId = await createTestTrip();
    const person = await createPerson(tripId, {
      name: 'Lila',
      color: hexColor('#22c55e'),
      childSeat: 'booster',
    });

    await updatePersonWithOwnershipCheck(person.id, tripId, {
      childSeat: 'hammock' as ChildSeatKind,
    });

    expect((await getPersonById(person.id))?.childSeat).toBeUndefined();
  });
});

// ============================================================================
// deletePersonWithOwnershipCheck
// ============================================================================

describe('deletePersonWithOwnershipCheck', () => {
  it('deletes person and related records when ownership is valid', async () => {
    const tripId = await createTestTrip();
    const person = await createPerson(tripId, { name: 'Alice', color: hexColor('#ef4444') });
    const room = await createRoom(tripId, { name: 'Room', capacity: 2 });

    // Create assignment
    await createAssignment(tripId, {
      roomId: room.id,
      personId: person.id,
      startDate: isoDate('2024-07-15'),
      endDate: isoDate('2024-07-20'),
    });

    // Create transport
    await createTransport(tripId, {
      type: 'arrival',
      personId: person.id,
      datetime: '2024-07-15T10:00:00.000Z',
      location: '',
      needsPickup: false,
    });

    await deletePersonWithOwnershipCheck(person.id, tripId);

    // Person should be gone
    const deleted = await getPersonById(person.id);
    expect(deleted).toBeUndefined();

    // Assignments should be gone
    const assignments = await db.roomAssignments.where('personId').equals(person.id).count();
    expect(assignments).toBe(0);

    // Transports should be gone
    const transports = await db.transports.where('personId').equals(person.id).count();
    expect(transports).toBe(0);
  });

  it('clears driverId references when person is deleted', async () => {
    const tripId = await createTestTrip();
    const driver = await createPerson(tripId, { name: 'Driver', color: hexColor('#ef4444') });
    const passenger = await createPerson(tripId, { name: 'Passenger', color: hexColor('#3b82f6') });

    const transport = await createTransport(tripId, {
      type: 'arrival',
      personId: passenger.id,
      datetime: '2024-07-15T10:00:00.000Z',
      driverId: driver.id,
      location: '',
      needsPickup: false,
    });

    await deletePersonWithOwnershipCheck(driver.id, tripId);

    // Transport should still exist but driverId should be cleared
    const updated = await db.transports.get(transport.id);
    expect(updated).toBeDefined();
    expect(updated?.driverId).toBeUndefined();
  });

  it('throws when person does not exist', async () => {
    const tripId = await createTestTrip();

    await expect(
      deletePersonWithOwnershipCheck('nonexistent' as PersonId, tripId)
    ).rejects.toThrow('not found');
  });

  it('throws when person belongs to different trip', async () => {
    const tripId1 = await createTestTrip('Trip 1');
    const tripId2 = await createTestTrip('Trip 2');
    const person = await createPerson(tripId1, { name: 'Alice', color: hexColor('#ef4444') });

    await expect(
      deletePersonWithOwnershipCheck(person.id, tripId2)
    ).rejects.toThrow('does not belong to current trip');
  });
});

// ============================================================================
// searchPersonsByName
// ============================================================================

describe('searchPersonsByName', () => {
  it('finds persons by partial name match', async () => {
    const tripId = await createTestTrip();
    await createPerson(tripId, { name: 'Alice', color: hexColor('#ef4444') });
    await createPerson(tripId, { name: 'Bob', color: hexColor('#3b82f6') });
    await createPerson(tripId, { name: 'Alicia', color: hexColor('#10b981') });

    const results = await searchPersonsByName(tripId, 'ali');
    expect(results).toHaveLength(2);
    expect(results.map((p) => p.name).sort()).toEqual(['Alice', 'Alicia']);
  });

  it('returns empty array when no match', async () => {
    const tripId = await createTestTrip();
    await createPerson(tripId, { name: 'Alice', color: hexColor('#ef4444') });

    const results = await searchPersonsByName(tripId, 'xyz');
    expect(results).toHaveLength(0);
  });
});

describe('deletePersonWithOwnershipCheck, cars and rides', () => {
  it('keeps the guest\'s ride and car but forgets who drove and owned them', async () => {
    const tripId = await createTestTrip();
    const person = await createPerson(tripId, { name: 'Alice', color: hexColor('#ef4444') });
    const other = await createPerson(tripId, { name: 'Bob', color: hexColor('#3b82f6') });
    await db.rides.bulkPut([
      { id: 'ride-1', tripId, direction: 'pickup', meetDatetime: '2024-07-15T10:00:00.000Z', location: 'Station', driverId: person.id },
      { id: 'ride-2', tripId, direction: 'pickup', meetDatetime: '2024-07-15T11:00:00.000Z', location: 'Station', driverId: other.id },
    ] as never);
    await db.vehicles.bulkPut([
      { id: 'vehicle-1', tripId, name: 'Espace', ownerId: person.id },
      { id: 'vehicle-2', tripId, name: 'Clio', ownerId: other.id },
    ] as never);

    await deletePersonWithOwnershipCheck(person.id, tripId);

    expect(await db.rides.get('ride-1')).toMatchObject({ id: 'ride-1' });
    expect((await db.rides.get('ride-1'))?.driverId).toBeUndefined();
    expect((await db.rides.get('ride-2'))?.driverId).toBe(other.id);
    expect(await db.vehicles.get('vehicle-1')).toMatchObject({ name: 'Espace' });
    expect((await db.vehicles.get('vehicle-1'))?.ownerId).toBeUndefined();
    expect((await db.vehicles.get('vehicle-2'))?.ownerId).toBe(other.id);
  });
});
