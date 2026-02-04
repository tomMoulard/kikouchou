/**
 * Integration tests for Person Repository
 *
 * Tests CRUD operations, auto-color assignment, cascade delete,
 * and driverId cleanup for the person-repository module.
 *
 * @module lib/db/repositories/__tests__/person-repository.test
 */
import { describe, it, expect } from 'vitest';
import { db } from '@/lib/db/database';
import {
  createPerson,
  createPersonWithAutoColor,
  getPersonsByTripId,
  getPersonById,
  updatePerson,
  deletePerson,
  getPersonCount,
  searchPersonsByName,
} from '@/lib/db/repositories/person-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { createRoom } from '@/lib/db/repositories/room-repository';
import { createAssignment } from '@/lib/db/repositories/assignment-repository';
import { createTransport } from '@/lib/db/repositories/transport-repository';
import type { PersonFormData, PersonId, TripId } from '@/types';
import { DEFAULT_PERSON_COLORS } from '@/types';
import { isoDate, hexColor } from '@/test/utils';

// ============================================================================
// Test Data Factories
// ============================================================================

/**
 * Creates valid person form data with optional overrides.
 */
function createTestPersonData(overrides?: Partial<PersonFormData>): PersonFormData {
  return {
    name: 'Test Person',
    color: hexColor('#ef4444'),
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
// Test Setup
// ============================================================================

// Note: Database clearing and mock restoration are handled by global setup.ts
// - beforeEach clears all 6 tables (trips, rooms, persons, roomAssignments, transports, settings)
// - afterEach calls cleanup() and vi.clearAllMocks()

// ============================================================================
// createPerson Tests
// ============================================================================

describe('createPerson', () => {
  it('creates person with all form data fields', async () => {
    const tripId = await createTestTrip();
    const data = createTestPersonData({
      name: 'Marie',
      color: hexColor('#3b82f6'),
    });

    const person = await createPerson(tripId, data);

    expect(person.name).toBe('Marie');
    expect(person.color).toBe('#3b82f6');
    expect(person.tripId).toBe(tripId);
  });

  it('generates unique person IDs', async () => {
    const tripId = await createTestTrip();

    const person1 = await createPerson(tripId, createTestPersonData({ name: 'Person 1' }));
    const person2 = await createPerson(tripId, createTestPersonData({ name: 'Person 2' }));
    const person3 = await createPerson(tripId, createTestPersonData({ name: 'Person 3' }));

    const ids = [person1.id, person2.id, person3.id];
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(3);
  });

  it('associates person with correct tripId', async () => {
    const tripId1 = await createTestTrip('Trip 1');
    const tripId2 = await createTestTrip('Trip 2');

    const person1 = await createPerson(tripId1, createTestPersonData({ name: 'Person for Trip 1' }));
    const person2 = await createPerson(tripId2, createTestPersonData({ name: 'Person for Trip 2' }));

    expect(person1.tripId).toBe(tripId1);
    expect(person2.tripId).toBe(tripId2);
  });

  it('persists person to database', async () => {
    const tripId = await createTestTrip();
    const person = await createPerson(tripId, createTestPersonData());

    const retrieved = await getPersonById(person.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(person.id);
  });

  it('allows multiple persons with same name in same trip', async () => {
    const tripId = await createTestTrip();

    const person1 = await createPerson(tripId, createTestPersonData({ name: 'Alice' }));
    const person2 = await createPerson(tripId, createTestPersonData({ name: 'Alice' }));

    expect(person1.id).not.toBe(person2.id);
    expect(person1.name).toBe('Alice');
    expect(person2.name).toBe('Alice');
  });
});

// ============================================================================
// createPersonWithAutoColor Tests
// ============================================================================

describe('createPersonWithAutoColor', () => {
  it('assigns first color from palette for first person', async () => {
    const tripId = await createTestTrip();

    const person = await createPersonWithAutoColor(tripId, 'First Person');

    expect(person.color).toBe(DEFAULT_PERSON_COLORS[0]);
    expect(person.name).toBe('First Person');
  });

  it('assigns colors sequentially from palette', async () => {
    const tripId = await createTestTrip();

    const person1 = await createPersonWithAutoColor(tripId, 'Person 1');
    const person2 = await createPersonWithAutoColor(tripId, 'Person 2');
    const person3 = await createPersonWithAutoColor(tripId, 'Person 3');

    expect(person1.color).toBe(DEFAULT_PERSON_COLORS[0]);
    expect(person2.color).toBe(DEFAULT_PERSON_COLORS[1]);
    expect(person3.color).toBe(DEFAULT_PERSON_COLORS[2]);
  });

  it('cycles through colors when count exceeds palette size', async () => {
    const tripId = await createTestTrip();
    const paletteSize = DEFAULT_PERSON_COLORS.length;

    // Create enough persons to exceed the palette
    const persons = [];
    for (let i = 0; i < paletteSize + 3; i++) {
      persons.push(await createPersonWithAutoColor(tripId, `Person ${i + 1}`));
    }

    // Verify cycling behavior
    expect(persons[paletteSize]?.color).toBe(DEFAULT_PERSON_COLORS[0]); // Cycle back to first
    expect(persons[paletteSize + 1]?.color).toBe(DEFAULT_PERSON_COLORS[1]); // Second color
    expect(persons[paletteSize + 2]?.color).toBe(DEFAULT_PERSON_COLORS[2]); // Third color
  });

  it('assigns colors independently for different trips', async () => {
    const tripId1 = await createTestTrip('Trip 1');
    const tripId2 = await createTestTrip('Trip 2');

    // Create 2 persons in trip 1
    await createPersonWithAutoColor(tripId1, 'Trip1 Person1');
    await createPersonWithAutoColor(tripId1, 'Trip1 Person2');

    // First person in trip 2 should get first color
    const person = await createPersonWithAutoColor(tripId2, 'Trip2 Person1');

    expect(person.color).toBe(DEFAULT_PERSON_COLORS[0]);
  });

  it('counts existing persons for color assignment', async () => {
    const tripId = await createTestTrip();

    // Create 3 persons manually with arbitrary colors
    await createPerson(tripId, { name: 'Manual 1', color: hexColor('#000000') });
    await createPerson(tripId, { name: 'Manual 2', color: hexColor('#111111') });
    await createPerson(tripId, { name: 'Manual 3', color: hexColor('#222222') });

    // Auto-color person should get 4th color (index 3)
    const autoPerson = await createPersonWithAutoColor(tripId, 'Auto Person');

    expect(autoPerson.color).toBe(DEFAULT_PERSON_COLORS[3]);
  });
});

// ============================================================================
// getPersonsByTripId Tests
// ============================================================================

describe('getPersonsByTripId', () => {
  it('returns persons sorted by name ascending', async () => {
    const tripId = await createTestTrip();

    await createPerson(tripId, createTestPersonData({ name: 'Charlie' }));
    await createPerson(tripId, createTestPersonData({ name: 'Alice' }));
    await createPerson(tripId, createTestPersonData({ name: 'Bob' }));

    const persons = await getPersonsByTripId(tripId);

    expect(persons).toHaveLength(3);
    expect(persons[0]?.name).toBe('Alice');
    expect(persons[1]?.name).toBe('Bob');
    expect(persons[2]?.name).toBe('Charlie');
  });

  it('returns empty array for non-existent trip', async () => {
    const nonExistentTripId = 'trip_does_not_exist' as TripId;

    const persons = await getPersonsByTripId(nonExistentTripId);

    expect(persons).toEqual([]);
    expect(persons).toHaveLength(0);
  });

  it('returns empty array for trip with no persons', async () => {
    const tripId = await createTestTrip();

    const persons = await getPersonsByTripId(tripId);

    expect(persons).toEqual([]);
  });

  it('only returns persons for specified trip', async () => {
    const tripId1 = await createTestTrip('Trip 1');
    const tripId2 = await createTestTrip('Trip 2');

    await createPerson(tripId1, createTestPersonData({ name: 'Person for Trip 1 - A' }));
    await createPerson(tripId1, createTestPersonData({ name: 'Person for Trip 1 - B' }));
    await createPerson(tripId2, createTestPersonData({ name: 'Person for Trip 2' }));

    const personsTrip1 = await getPersonsByTripId(tripId1);
    const personsTrip2 = await getPersonsByTripId(tripId2);

    expect(personsTrip1).toHaveLength(2);
    expect(personsTrip2).toHaveLength(1);
    expect(personsTrip1[0]?.tripId).toBe(tripId1);
    expect(personsTrip1[1]?.tripId).toBe(tripId1);
    expect(personsTrip2[0]?.tripId).toBe(tripId2);
  });

  it('handles Unicode names correctly', async () => {
    const tripId = await createTestTrip();

    await createPerson(tripId, createTestPersonData({ name: 'Zürich' }));
    await createPerson(tripId, createTestPersonData({ name: 'André' }));
    await createPerson(tripId, createTestPersonData({ name: '日本語' }));

    const persons = await getPersonsByTripId(tripId);

    expect(persons).toHaveLength(3);
    // Verify all names are retrieved
    const names = persons.map((p) => p.name);
    expect(names).toContain('Zürich');
    expect(names).toContain('André');
    expect(names).toContain('日本語');
  });
});

// ============================================================================
// getPersonById Tests
// ============================================================================

describe('getPersonById', () => {
  it('returns person when found', async () => {
    const tripId = await createTestTrip();
    const created = await createPerson(tripId, createTestPersonData({ name: 'Find Me' }));

    const found = await getPersonById(created.id);

    expect(found).toBeDefined();
    expect(found?.id).toBe(created.id);
    expect(found?.name).toBe('Find Me');
    expect(found?.tripId).toBe(tripId);
  });

  it('returns undefined for non-existent id', async () => {
    const nonExistentId = 'person_does_not_exist' as PersonId;

    const found = await getPersonById(nonExistentId);

    expect(found).toBeUndefined();
  });

  it('returns correct person when multiple exist', async () => {
    const tripId = await createTestTrip();
    const person1 = await createPerson(tripId, createTestPersonData({ name: 'Person 1' }));
    const person2 = await createPerson(tripId, createTestPersonData({ name: 'Person 2' }));

    const found = await getPersonById(person2.id);

    expect(found?.id).toBe(person2.id);
    expect(found?.name).toBe('Person 2');
    expect(found?.id).not.toBe(person1.id);
  });
});

// ============================================================================
// updatePerson Tests
// ============================================================================

describe('updatePerson', () => {
  it('updates person properties', async () => {
    const tripId = await createTestTrip();
    const person = await createPerson(tripId, createTestPersonData({ name: 'Original' }));

    await updatePerson(person.id, { name: 'Updated', color: hexColor('#22c55e') });

    const updated = await getPersonById(person.id);
    expect(updated?.name).toBe('Updated');
    expect(updated?.color).toBe('#22c55e');
  });

  it('performs partial updates - name only', async () => {
    const tripId = await createTestTrip();
    const person = await createPerson(
      tripId,
      createTestPersonData({
        name: 'Original Name',
        color: hexColor('#ef4444'),
      })
    );

    // Only update name
    await updatePerson(person.id, { name: 'New Name' });

    const updated = await getPersonById(person.id);
    expect(updated?.name).toBe('New Name');
    expect(updated?.color).toBe('#ef4444'); // Unchanged
  });

  it('performs partial updates - color only', async () => {
    const tripId = await createTestTrip();
    const person = await createPerson(
      tripId,
      createTestPersonData({
        name: 'Original Name',
        color: hexColor('#ef4444'),
      })
    );

    // Only update color
    await updatePerson(person.id, { color: hexColor('#3b82f6') });

    const updated = await getPersonById(person.id);
    expect(updated?.name).toBe('Original Name'); // Unchanged
    expect(updated?.color).toBe('#3b82f6');
  });

  it('throws error when person not found', async () => {
    const nonExistentId = 'person_does_not_exist' as PersonId;

    await expect(updatePerson(nonExistentId, { name: 'New Name' })).rejects.toThrow(
      `Person with id "${nonExistentId}" not found`
    );
  });

  it('does not modify other persons', async () => {
    const tripId = await createTestTrip();
    const person1 = await createPerson(tripId, createTestPersonData({ name: 'Person 1' }));
    const person2 = await createPerson(tripId, createTestPersonData({ name: 'Person 2' }));

    await updatePerson(person1.id, { name: 'Updated Person 1' });

    const retrieved1 = await getPersonById(person1.id);
    const retrieved2 = await getPersonById(person2.id);

    expect(retrieved1?.name).toBe('Updated Person 1');
    expect(retrieved2?.name).toBe('Person 2'); // Unchanged
  });
});

// ============================================================================
// deletePerson Tests
// ============================================================================

describe('deletePerson', () => {
  it('deletes person from database', async () => {
    const tripId = await createTestTrip();
    const person = await createPerson(tripId, createTestPersonData());

    expect(await db.persons.count()).toBe(1);

    await deletePerson(person.id);

    expect(await db.persons.count()).toBe(0);
    expect(await getPersonById(person.id)).toBeUndefined();
  });

  it('cascade deletes room assignments', async () => {
    const tripId = await createTestTrip();
    const person = await createPerson(tripId, createTestPersonData());
    const room = await createRoom(tripId, { name: 'Test Room', capacity: 2 });

    // Create room assignment
    await createAssignment(tripId, {
      roomId: room.id,
      personId: person.id,
      startDate: isoDate('2024-07-15'),
      endDate: isoDate('2024-07-20'),
    });

    // Verify assignment exists
    expect(await db.roomAssignments.count()).toBe(1);

    // Delete person
    await deletePerson(person.id);

    // Verify person deleted
    expect(await db.persons.count()).toBe(0);

    // Verify assignment cascade deleted
    expect(await db.roomAssignments.count()).toBe(0);

    // Verify room still exists (not cascade deleted)
    expect(await db.rooms.count()).toBe(1);
  });

  it('cascade deletes transports', async () => {
    const tripId = await createTestTrip();
    const person = await createPerson(tripId, createTestPersonData());

    // Create transport for this person
    await createTransport(tripId, {
      personId: person.id,
      type: 'arrival',
      datetime: '2024-07-15T14:00:00Z',
      location: 'Airport',
      needsPickup: true,
    });

    // Verify transport exists
    expect(await db.transports.count()).toBe(1);

    // Delete person
    await deletePerson(person.id);

    // Verify person deleted
    expect(await db.persons.count()).toBe(0);

    // Verify transport cascade deleted
    expect(await db.transports.count()).toBe(0);
  });

  it('clears driverId references in other transports', async () => {
    const tripId = await createTestTrip();
    const driver = await createPerson(tripId, createTestPersonData({ name: 'Driver' }));
    const passenger = await createPerson(tripId, createTestPersonData({ name: 'Passenger' }));

    // Create transport where driver is assigned as the driver
    await createTransport(tripId, {
      personId: passenger.id,
      type: 'arrival',
      datetime: '2024-07-15T14:00:00Z',
      location: 'Airport',
      needsPickup: true,
      driverId: driver.id,
    });

    // Verify transport has driverId set
    const transportsBefore = await db.transports.toArray();
    expect(transportsBefore[0]?.driverId).toBe(driver.id);

    // Delete the driver
    await deletePerson(driver.id);

    // Verify driverId is cleared (set to undefined)
    const transportsAfter = await db.transports.toArray();
    expect(transportsAfter).toHaveLength(1); // Transport still exists
    expect(transportsAfter[0]?.driverId).toBeUndefined();
  });

  it('handles multiple assignments and transports cascade delete', async () => {
    const tripId = await createTestTrip();
    const person = await createPerson(tripId, createTestPersonData());
    const room1 = await createRoom(tripId, { name: 'Room 1', capacity: 2 });
    const room2 = await createRoom(tripId, { name: 'Room 2', capacity: 2 });

    // Create multiple assignments
    await createAssignment(tripId, {
      roomId: room1.id,
      personId: person.id,
      startDate: isoDate('2024-07-15'),
      endDate: isoDate('2024-07-17'),
    });
    await createAssignment(tripId, {
      roomId: room2.id,
      personId: person.id,
      startDate: isoDate('2024-07-18'),
      endDate: isoDate('2024-07-20'),
    });

    // Create multiple transports
    await createTransport(tripId, {
      personId: person.id,
      type: 'arrival',
      datetime: '2024-07-15T14:00:00Z',
      location: 'Airport',
      needsPickup: true,
    });
    await createTransport(tripId, {
      personId: person.id,
      type: 'departure',
      datetime: '2024-07-22T10:00:00Z',
      location: 'Train Station',
      needsPickup: false,
    });

    expect(await db.roomAssignments.count()).toBe(2);
    expect(await db.transports.count()).toBe(2);

    // Delete person
    await deletePerson(person.id);

    // Verify all related data cascade deleted
    expect(await db.persons.count()).toBe(0);
    expect(await db.roomAssignments.count()).toBe(0);
    expect(await db.transports.count()).toBe(0);
  });

  it('only deletes data for specified person', async () => {
    const tripId = await createTestTrip();
    const person1 = await createPerson(tripId, createTestPersonData({ name: 'Person 1' }));
    const person2 = await createPerson(tripId, createTestPersonData({ name: 'Person 2' }));
    const room = await createRoom(tripId, { name: 'Shared Room', capacity: 4 });

    // Create assignment and transport for both persons
    await createAssignment(tripId, {
      roomId: room.id,
      personId: person1.id,
      startDate: isoDate('2024-07-15'),
      endDate: isoDate('2024-07-17'),
    });
    await createAssignment(tripId, {
      roomId: room.id,
      personId: person2.id,
      startDate: isoDate('2024-07-15'),
      endDate: isoDate('2024-07-17'),
    });
    await createTransport(tripId, {
      personId: person1.id,
      type: 'arrival',
      datetime: '2024-07-15T14:00:00Z',
      location: 'Airport',
      needsPickup: true,
    });
    await createTransport(tripId, {
      personId: person2.id,
      type: 'arrival',
      datetime: '2024-07-15T14:00:00Z',
      location: 'Airport',
      needsPickup: true,
    });

    expect(await db.roomAssignments.count()).toBe(2);
    expect(await db.transports.count()).toBe(2);

    // Delete only person1
    await deletePerson(person1.id);

    // Verify person1's data deleted
    expect(await db.persons.count()).toBe(1);
    expect(await db.roomAssignments.count()).toBe(1);
    expect(await db.transports.count()).toBe(1);

    // Verify person2's data remains
    const remainingAssignments = await db.roomAssignments.toArray();
    const remainingTransports = await db.transports.toArray();
    expect(remainingAssignments[0]?.personId).toBe(person2.id);
    expect(remainingTransports[0]?.personId).toBe(person2.id);
  });

  it('handles person with no assignments or transports', async () => {
    const tripId = await createTestTrip();
    const person = await createPerson(tripId, createTestPersonData());

    // Delete person without related data - should not throw
    await expect(deletePerson(person.id)).resolves.not.toThrow();

    expect(await db.persons.count()).toBe(0);
  });

  it('is idempotent - deleting non-existent person does not throw', async () => {
    const nonExistentId = 'person_does_not_exist' as PersonId;

    await expect(deletePerson(nonExistentId)).resolves.not.toThrow();
  });

  it('handles complex driverId cleanup scenario', async () => {
    const tripId = await createTestTrip();
    const driver = await createPerson(tripId, createTestPersonData({ name: 'Driver' }));
    const passenger1 = await createPerson(tripId, createTestPersonData({ name: 'Passenger 1' }));
    const passenger2 = await createPerson(tripId, createTestPersonData({ name: 'Passenger 2' }));

    // Create multiple transports where driver is the assigned driver
    await createTransport(tripId, {
      personId: passenger1.id,
      type: 'arrival',
      datetime: '2024-07-15T14:00:00Z',
      location: 'Airport',
      needsPickup: true,
      driverId: driver.id,
    });
    await createTransport(tripId, {
      personId: passenger2.id,
      type: 'arrival',
      datetime: '2024-07-15T16:00:00Z',
      location: 'Train Station',
      needsPickup: true,
      driverId: driver.id,
    });
    // Transport without driver
    await createTransport(tripId, {
      personId: driver.id, // Driver's own transport
      type: 'arrival',
      datetime: '2024-07-14T10:00:00Z',
      location: 'Airport',
      needsPickup: false,
    });

    expect(await db.transports.count()).toBe(3);

    // Delete the driver
    await deletePerson(driver.id);

    // Driver's own transport should be deleted (cascade)
    // Passenger transports should remain but with driverId cleared
    expect(await db.transports.count()).toBe(2);

    const remainingTransports = await db.transports.toArray();
    expect(remainingTransports[0]?.driverId).toBeUndefined();
    expect(remainingTransports[1]?.driverId).toBeUndefined();
  });
});

// ============================================================================
// getPersonCount Tests
// ============================================================================

describe('getPersonCount', () => {
  it('returns correct count for trip with persons', async () => {
    const tripId = await createTestTrip();

    await createPerson(tripId, createTestPersonData({ name: 'Person 1' }));
    await createPerson(tripId, createTestPersonData({ name: 'Person 2' }));
    await createPerson(tripId, createTestPersonData({ name: 'Person 3' }));

    const count = await getPersonCount(tripId);

    expect(count).toBe(3);
  });

  it('returns 0 for trip with no persons', async () => {
    const tripId = await createTestTrip();

    const count = await getPersonCount(tripId);

    expect(count).toBe(0);
  });

  it('returns 0 for non-existent trip', async () => {
    const nonExistentTripId = 'trip_does_not_exist' as TripId;

    const count = await getPersonCount(nonExistentTripId);

    expect(count).toBe(0);
  });

  it('only counts persons for specified trip', async () => {
    const tripId1 = await createTestTrip('Trip 1');
    const tripId2 = await createTestTrip('Trip 2');

    await createPerson(tripId1, createTestPersonData({ name: 'Trip 1 - Person 1' }));
    await createPerson(tripId1, createTestPersonData({ name: 'Trip 1 - Person 2' }));
    await createPerson(tripId2, createTestPersonData({ name: 'Trip 2 - Person 1' }));

    const count1 = await getPersonCount(tripId1);
    const count2 = await getPersonCount(tripId2);

    expect(count1).toBe(2);
    expect(count2).toBe(1);
  });
});

// ============================================================================
// searchPersonsByName Tests
// ============================================================================

describe('searchPersonsByName', () => {
  it('finds persons with matching name', async () => {
    const tripId = await createTestTrip();

    await createPerson(tripId, createTestPersonData({ name: 'Alice' }));
    await createPerson(tripId, createTestPersonData({ name: 'Bob' }));
    await createPerson(tripId, createTestPersonData({ name: 'Charlie' }));

    const results = await searchPersonsByName(tripId, 'Alice');

    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe('Alice');
  });

  it('performs case-insensitive search', async () => {
    const tripId = await createTestTrip();

    await createPerson(tripId, createTestPersonData({ name: 'Alice' }));
    await createPerson(tripId, createTestPersonData({ name: 'ALICE' }));
    await createPerson(tripId, createTestPersonData({ name: 'alice' }));

    const results = await searchPersonsByName(tripId, 'aLiCe');

    expect(results).toHaveLength(3);
  });

  it('performs partial match search', async () => {
    const tripId = await createTestTrip();

    await createPerson(tripId, createTestPersonData({ name: 'Marie' }));
    await createPerson(tripId, createTestPersonData({ name: 'Marc' }));
    await createPerson(tripId, createTestPersonData({ name: 'Bob' }));

    const results = await searchPersonsByName(tripId, 'mar');

    expect(results).toHaveLength(2);
    const names = results.map((p) => p.name);
    expect(names).toContain('Marie');
    expect(names).toContain('Marc');
  });

  it('returns empty array for no matches', async () => {
    const tripId = await createTestTrip();

    await createPerson(tripId, createTestPersonData({ name: 'Alice' }));
    await createPerson(tripId, createTestPersonData({ name: 'Bob' }));

    const results = await searchPersonsByName(tripId, 'Charlie');

    expect(results).toEqual([]);
  });

  it('returns empty array for empty query', async () => {
    const tripId = await createTestTrip();

    await createPerson(tripId, createTestPersonData({ name: 'Alice' }));

    // Empty query matches everything (empty string is in every string)
    const results = await searchPersonsByName(tripId, '');

    expect(results).toHaveLength(1);
  });

  it('only searches within specified trip', async () => {
    const tripId1 = await createTestTrip('Trip 1');
    const tripId2 = await createTestTrip('Trip 2');

    await createPerson(tripId1, createTestPersonData({ name: 'Alice in Trip 1' }));
    await createPerson(tripId2, createTestPersonData({ name: 'Alice in Trip 2' }));

    const results1 = await searchPersonsByName(tripId1, 'Alice');
    const results2 = await searchPersonsByName(tripId2, 'Alice');

    expect(results1).toHaveLength(1);
    expect(results1[0]?.tripId).toBe(tripId1);
    expect(results2).toHaveLength(1);
    expect(results2[0]?.tripId).toBe(tripId2);
  });

  it('handles special characters in search', async () => {
    const tripId = await createTestTrip();

    await createPerson(tripId, createTestPersonData({ name: "O'Brien" }));
    await createPerson(tripId, createTestPersonData({ name: 'Jean-Pierre' }));

    const results1 = await searchPersonsByName(tripId, "O'B");
    const results2 = await searchPersonsByName(tripId, 'Jean-');

    expect(results1).toHaveLength(1);
    expect(results1[0]?.name).toBe("O'Brien");
    expect(results2).toHaveLength(1);
    expect(results2[0]?.name).toBe('Jean-Pierre');
  });

  it('handles Unicode characters in search', async () => {
    const tripId = await createTestTrip();

    await createPerson(tripId, createTestPersonData({ name: 'André' }));
    await createPerson(tripId, createTestPersonData({ name: 'Müller' }));

    const results1 = await searchPersonsByName(tripId, 'André');
    const results2 = await searchPersonsByName(tripId, 'müll');

    expect(results1).toHaveLength(1);
    expect(results2).toHaveLength(1);
  });
});
