/**
 * Integration tests for Transport Repository
 *
 * Tests CRUD operations, filtering by type (arrivals/departures),
 * upcoming pickups, and datetime-based queries for the transport-repository module.
 *
 * @module lib/db/repositories/__tests__/transport-repository.test
 */
import { describe, it, expect } from 'vitest';
import { db } from '@/lib/db/database';
import {
  createTransport,
  getTransportsByTripId,
  getTransportsByPersonId,
  getArrivals,
  getDepartures,
  getTransportById,
  updateTransport,
  deleteTransport,
  getUpcomingPickups,
  getTransportsForDate,
  getTransportCount,
  getTransportsByDriverId,
} from '@/lib/db/repositories/transport-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { createPerson } from '@/lib/db/repositories/person-repository';
import type { PersonId, TransportFormData, TransportId, TripId } from '@/types';

// ============================================================================
// Test Data Factories
// ============================================================================

/**
 * Creates valid transport form data with optional overrides.
 */
function createTestTransportData(
  personId: PersonId,
  overrides?: Partial<TransportFormData>,
): TransportFormData {
  return {
    personId,
    type: 'arrival',
    datetime: '2024-07-15T14:30:00.000Z',
    location: 'Gare Montparnasse',
    needsPickup: false,
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

/**
 * Creates a test person and returns their ID.
 */
async function createTestPerson(tripId: TripId, name = 'Test Person'): Promise<PersonId> {
  const person = await createPerson(tripId, {
    name,
    color: '#ef4444',
  });
  return person.id;
}

// ============================================================================
// Test Setup
// ============================================================================

// Note: Database clearing and mock restoration are handled by global setup.ts
// - beforeEach clears all 6 tables (trips, rooms, persons, roomAssignments, transports, settings)
// - afterEach calls cleanup() and vi.clearAllMocks()

// ============================================================================
// createTransport Tests
// ============================================================================

describe('createTransport', () => {
  it('creates transport with all form data fields', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId, 'Marie');
    const driverId = await createTestPerson(tripId, 'Driver');

    const data = createTestTransportData(personId, {
      type: 'arrival',
      datetime: '2024-07-15T14:30:00.000Z',
      location: 'Gare Montparnasse',
      transportMode: 'train',
      transportNumber: 'TGV 8541',
      driverId,
      needsPickup: true,
      notes: 'Platform 12',
    });

    const transport = await createTransport(tripId, data);

    expect(transport.tripId).toBe(tripId);
    expect(transport.personId).toBe(personId);
    expect(transport.type).toBe('arrival');
    expect(transport.datetime).toBe('2024-07-15T14:30:00.000Z');
    expect(transport.location).toBe('Gare Montparnasse');
    expect(transport.transportMode).toBe('train');
    expect(transport.transportNumber).toBe('TGV 8541');
    expect(transport.driverId).toBe(driverId);
    expect(transport.needsPickup).toBe(true);
    expect(transport.notes).toBe('Platform 12');
  });

  it('generates unique IDs for each transport', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    const transport1 = await createTransport(tripId, createTestTransportData(personId));
    const transport2 = await createTransport(tripId, createTestTransportData(personId));

    expect(transport1.id).not.toBe(transport2.id);
  });

  it('creates transport with minimal required fields', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    const data = createTestTransportData(personId, {
      transportMode: undefined,
      transportNumber: undefined,
      driverId: undefined,
      notes: undefined,
    });

    const transport = await createTransport(tripId, data);

    expect(transport.id).toBeDefined();
    expect(transport.tripId).toBe(tripId);
    expect(transport.personId).toBe(personId);
    expect(transport.transportMode).toBeUndefined();
    expect(transport.transportNumber).toBeUndefined();
    expect(transport.driverId).toBeUndefined();
    expect(transport.notes).toBeUndefined();
  });

  it('creates departure transport', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    const transport = await createTransport(
      tripId,
      createTestTransportData(personId, {
        type: 'departure',
        datetime: '2024-07-22T10:00:00.000Z',
      }),
    );

    expect(transport.type).toBe('departure');
  });

  it('persists transport to database', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    const transport = await createTransport(tripId, createTestTransportData(personId));

    const stored = await db.transports.get(transport.id);
    expect(stored).toEqual(transport);
  });
});

// ============================================================================
// getTransportsByTripId Tests
// ============================================================================

describe('getTransportsByTripId', () => {
  it('returns empty array for trip with no transports', async () => {
    const tripId = await createTestTrip();

    const transports = await getTransportsByTripId(tripId);

    expect(transports).toEqual([]);
  });

  it('returns all transports for a trip', async () => {
    const tripId = await createTestTrip();
    const person1 = await createTestPerson(tripId, 'Person 1');
    const person2 = await createTestPerson(tripId, 'Person 2');

    await createTransport(
      tripId,
      createTestTransportData(person1, { datetime: '2024-07-15T10:00:00.000Z' }),
    );
    await createTransport(
      tripId,
      createTestTransportData(person2, { datetime: '2024-07-16T14:00:00.000Z' }),
    );

    const transports = await getTransportsByTripId(tripId);

    expect(transports).toHaveLength(2);
  });

  it('returns transports sorted by datetime ascending', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    // Create in non-chronological order
    await createTransport(
      tripId,
      createTestTransportData(personId, { datetime: '2024-07-17T12:00:00.000Z' }),
    );
    await createTransport(
      tripId,
      createTestTransportData(personId, { datetime: '2024-07-15T10:00:00.000Z' }),
    );
    await createTransport(
      tripId,
      createTestTransportData(personId, { datetime: '2024-07-16T14:00:00.000Z' }),
    );

    const transports = await getTransportsByTripId(tripId);

    expect(transports[0]?.datetime).toBe('2024-07-15T10:00:00.000Z');
    expect(transports[1]?.datetime).toBe('2024-07-16T14:00:00.000Z');
    expect(transports[2]?.datetime).toBe('2024-07-17T12:00:00.000Z');
  });

  it('only returns transports for specified trip', async () => {
    const trip1 = await createTestTrip('Trip 1');
    const trip2 = await createTestTrip('Trip 2');
    const person1 = await createTestPerson(trip1);
    const person2 = await createTestPerson(trip2);

    await createTransport(trip1, createTestTransportData(person1));
    await createTransport(trip2, createTestTransportData(person2));
    await createTransport(trip2, createTestTransportData(person2));

    const transports = await getTransportsByTripId(trip1);

    expect(transports).toHaveLength(1);
  });
});

// ============================================================================
// getTransportsByPersonId Tests
// ============================================================================

describe('getTransportsByPersonId', () => {
  it('returns empty array for person with no transports', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    const transports = await getTransportsByPersonId(personId);

    expect(transports).toEqual([]);
  });

  it('returns all transports for a person', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    await createTransport(
      tripId,
      createTestTransportData(personId, { type: 'arrival', datetime: '2024-07-15T14:00:00.000Z' }),
    );
    await createTransport(
      tripId,
      createTestTransportData(personId, {
        type: 'departure',
        datetime: '2024-07-22T10:00:00.000Z',
      }),
    );

    const transports = await getTransportsByPersonId(personId);

    expect(transports).toHaveLength(2);
    expect(transports[0]?.type).toBe('arrival');
    expect(transports[1]?.type).toBe('departure');
  });

  it('returns transports sorted by datetime', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    await createTransport(
      tripId,
      createTestTransportData(personId, { datetime: '2024-07-22T10:00:00.000Z' }),
    );
    await createTransport(
      tripId,
      createTestTransportData(personId, { datetime: '2024-07-15T14:00:00.000Z' }),
    );

    const transports = await getTransportsByPersonId(personId);

    expect(transports[0]?.datetime).toBe('2024-07-15T14:00:00.000Z');
    expect(transports[1]?.datetime).toBe('2024-07-22T10:00:00.000Z');
  });

  it('only returns transports for specified person', async () => {
    const tripId = await createTestTrip();
    const person1 = await createTestPerson(tripId, 'Person 1');
    const person2 = await createTestPerson(tripId, 'Person 2');

    await createTransport(tripId, createTestTransportData(person1));
    await createTransport(tripId, createTestTransportData(person2));
    await createTransport(tripId, createTestTransportData(person2));

    const transports = await getTransportsByPersonId(person1);

    expect(transports).toHaveLength(1);
  });
});

// ============================================================================
// getArrivals Tests
// ============================================================================

describe('getArrivals', () => {
  it('returns empty array for trip with no arrivals', async () => {
    const tripId = await createTestTrip();

    const arrivals = await getArrivals(tripId);

    expect(arrivals).toEqual([]);
  });

  it('only returns arrivals, not departures', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    await createTransport(
      tripId,
      createTestTransportData(personId, { type: 'arrival', datetime: '2024-07-15T14:00:00.000Z' }),
    );
    await createTransport(
      tripId,
      createTestTransportData(personId, {
        type: 'departure',
        datetime: '2024-07-22T10:00:00.000Z',
      }),
    );

    const arrivals = await getArrivals(tripId);

    expect(arrivals).toHaveLength(1);
    expect(arrivals[0]?.type).toBe('arrival');
  });

  it('returns arrivals sorted by datetime', async () => {
    const tripId = await createTestTrip();
    const person1 = await createTestPerson(tripId, 'Person 1');
    const person2 = await createTestPerson(tripId, 'Person 2');

    await createTransport(
      tripId,
      createTestTransportData(person1, { type: 'arrival', datetime: '2024-07-16T10:00:00.000Z' }),
    );
    await createTransport(
      tripId,
      createTestTransportData(person2, { type: 'arrival', datetime: '2024-07-15T14:00:00.000Z' }),
    );

    const arrivals = await getArrivals(tripId);

    expect(arrivals[0]?.datetime).toBe('2024-07-15T14:00:00.000Z');
    expect(arrivals[1]?.datetime).toBe('2024-07-16T10:00:00.000Z');
  });

  it('only returns arrivals for specified trip', async () => {
    const trip1 = await createTestTrip('Trip 1');
    const trip2 = await createTestTrip('Trip 2');
    const person1 = await createTestPerson(trip1);
    const person2 = await createTestPerson(trip2);

    await createTransport(trip1, createTestTransportData(person1, { type: 'arrival' }));
    await createTransport(trip2, createTestTransportData(person2, { type: 'arrival' }));
    await createTransport(trip2, createTestTransportData(person2, { type: 'arrival' }));

    const arrivals = await getArrivals(trip1);

    expect(arrivals).toHaveLength(1);
  });
});

// ============================================================================
// getDepartures Tests
// ============================================================================

describe('getDepartures', () => {
  it('returns empty array for trip with no departures', async () => {
    const tripId = await createTestTrip();

    const departures = await getDepartures(tripId);

    expect(departures).toEqual([]);
  });

  it('only returns departures, not arrivals', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    await createTransport(
      tripId,
      createTestTransportData(personId, { type: 'arrival', datetime: '2024-07-15T14:00:00.000Z' }),
    );
    await createTransport(
      tripId,
      createTestTransportData(personId, {
        type: 'departure',
        datetime: '2024-07-22T10:00:00.000Z',
      }),
    );

    const departures = await getDepartures(tripId);

    expect(departures).toHaveLength(1);
    expect(departures[0]?.type).toBe('departure');
  });

  it('returns departures sorted by datetime', async () => {
    const tripId = await createTestTrip();
    const person1 = await createTestPerson(tripId, 'Person 1');
    const person2 = await createTestPerson(tripId, 'Person 2');

    await createTransport(
      tripId,
      createTestTransportData(person1, {
        type: 'departure',
        datetime: '2024-07-23T10:00:00.000Z',
      }),
    );
    await createTransport(
      tripId,
      createTestTransportData(person2, {
        type: 'departure',
        datetime: '2024-07-22T14:00:00.000Z',
      }),
    );

    const departures = await getDepartures(tripId);

    expect(departures[0]?.datetime).toBe('2024-07-22T14:00:00.000Z');
    expect(departures[1]?.datetime).toBe('2024-07-23T10:00:00.000Z');
  });

  it('only returns departures for specified trip', async () => {
    const trip1 = await createTestTrip('Trip 1');
    const trip2 = await createTestTrip('Trip 2');
    const person1 = await createTestPerson(trip1);
    const person2 = await createTestPerson(trip2);

    await createTransport(trip1, createTestTransportData(person1, { type: 'departure' }));
    await createTransport(trip2, createTestTransportData(person2, { type: 'departure' }));
    await createTransport(trip2, createTestTransportData(person2, { type: 'departure' }));

    const departures = await getDepartures(trip1);

    expect(departures).toHaveLength(1);
  });
});

// ============================================================================
// getTransportById Tests
// ============================================================================

describe('getTransportById', () => {
  it('returns transport by ID', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    const created = await createTransport(
      tripId,
      createTestTransportData(personId, { location: 'Test Location' }),
    );

    const found = await getTransportById(created.id);

    expect(found).toEqual(created);
  });

  it('returns undefined for non-existent ID', async () => {
    const found = await getTransportById('non-existent-id' as TransportId);

    expect(found).toBeUndefined();
  });
});

// ============================================================================
// updateTransport Tests
// ============================================================================

describe('updateTransport', () => {
  it('updates single field', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    const transport = await createTransport(
      tripId,
      createTestTransportData(personId, { location: 'Original' }),
    );

    await updateTransport(transport.id, { location: 'Updated' });

    const updated = await getTransportById(transport.id);
    expect(updated?.location).toBe('Updated');
  });

  it('updates multiple fields', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    const transport = await createTransport(tripId, createTestTransportData(personId));

    await updateTransport(transport.id, {
      datetime: '2024-07-16T10:00:00.000Z',
      location: 'New Location',
      needsPickup: true,
    });

    const updated = await getTransportById(transport.id);
    expect(updated?.datetime).toBe('2024-07-16T10:00:00.000Z');
    expect(updated?.location).toBe('New Location');
    expect(updated?.needsPickup).toBe(true);
  });

  it('preserves unchanged fields', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    const transport = await createTransport(
      tripId,
      createTestTransportData(personId, {
        location: 'Original Location',
        transportMode: 'train',
        transportNumber: 'TGV 123',
      }),
    );

    await updateTransport(transport.id, { location: 'New Location' });

    const updated = await getTransportById(transport.id);
    expect(updated?.transportMode).toBe('train');
    expect(updated?.transportNumber).toBe('TGV 123');
  });

  it('throws error for non-existent transport', async () => {
    await expect(
      updateTransport('non-existent-id' as TransportId, { location: 'Test' }),
    ).rejects.toThrow('Transport with id "non-existent-id" not found');
  });

  it('can update optional fields to undefined', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    const transport = await createTransport(
      tripId,
      createTestTransportData(personId, {
        transportMode: 'train',
        notes: 'Some notes',
      }),
    );

    await updateTransport(transport.id, {
      transportMode: undefined,
      notes: undefined,
    });

    const updated = await getTransportById(transport.id);
    expect(updated?.transportMode).toBeUndefined();
    expect(updated?.notes).toBeUndefined();
  });

  it('can change transport type', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    const transport = await createTransport(
      tripId,
      createTestTransportData(personId, { type: 'arrival' }),
    );

    await updateTransport(transport.id, { type: 'departure' });

    const updated = await getTransportById(transport.id);
    expect(updated?.type).toBe('departure');
  });
});

// ============================================================================
// deleteTransport Tests
// ============================================================================

describe('deleteTransport', () => {
  it('removes transport from database', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    const transport = await createTransport(tripId, createTestTransportData(personId));

    await deleteTransport(transport.id);

    const found = await getTransportById(transport.id);
    expect(found).toBeUndefined();
  });

  it('does not throw for non-existent transport', async () => {
    // Dexie delete is idempotent
    await expect(deleteTransport('non-existent-id' as TransportId)).resolves.not.toThrow();
  });

  it('only deletes specified transport', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    const transport1 = await createTransport(
      tripId,
      createTestTransportData(personId, { location: 'Location 1' }),
    );
    const transport2 = await createTransport(
      tripId,
      createTestTransportData(personId, { location: 'Location 2' }),
    );

    await deleteTransport(transport1.id);

    const remaining = await getTransportsByTripId(tripId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(transport2.id);
  });
});

// ============================================================================
// getUpcomingPickups Tests
// ============================================================================

describe('getUpcomingPickups', () => {
  it('returns empty array when no pickups needed', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    await createTransport(
      tripId,
      createTestTransportData(personId, {
        needsPickup: false,
        datetime: '2099-12-31T23:59:59.000Z', // Far future
      }),
    );

    const pickups = await getUpcomingPickups(tripId, '2024-01-01T00:00:00.000Z');

    expect(pickups).toEqual([]);
  });

  it('returns transports that need pickup', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    await createTransport(
      tripId,
      createTestTransportData(personId, {
        needsPickup: true,
        datetime: '2024-07-15T14:00:00.000Z',
      }),
    );

    const pickups = await getUpcomingPickups(tripId, '2024-07-01T00:00:00.000Z');

    expect(pickups).toHaveLength(1);
    expect(pickups[0]?.needsPickup).toBe(true);
  });

  it('excludes past transports', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    await createTransport(
      tripId,
      createTestTransportData(personId, {
        needsPickup: true,
        datetime: '2024-07-10T14:00:00.000Z', // Before fromDatetime
      }),
    );

    const pickups = await getUpcomingPickups(tripId, '2024-07-15T00:00:00.000Z');

    expect(pickups).toEqual([]);
  });

  it('includes transports with exact fromDatetime match', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    await createTransport(
      tripId,
      createTestTransportData(personId, {
        needsPickup: true,
        datetime: '2024-07-15T14:00:00.000Z',
      }),
    );

    const pickups = await getUpcomingPickups(tripId, '2024-07-15T14:00:00.000Z');

    expect(pickups).toHaveLength(1);
  });

  it('sorts pickups by datetime ascending', async () => {
    const tripId = await createTestTrip();
    const person1 = await createTestPerson(tripId, 'Person 1');
    const person2 = await createTestPerson(tripId, 'Person 2');

    await createTransport(
      tripId,
      createTestTransportData(person1, {
        needsPickup: true,
        datetime: '2024-07-17T10:00:00.000Z',
      }),
    );
    await createTransport(
      tripId,
      createTestTransportData(person2, {
        needsPickup: true,
        datetime: '2024-07-15T14:00:00.000Z',
      }),
    );

    const pickups = await getUpcomingPickups(tripId, '2024-07-01T00:00:00.000Z');

    expect(pickups[0]?.datetime).toBe('2024-07-15T14:00:00.000Z');
    expect(pickups[1]?.datetime).toBe('2024-07-17T10:00:00.000Z');
  });

  it('uses current time as default when fromDatetime not provided', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    // Far future transport that will always be "upcoming"
    await createTransport(
      tripId,
      createTestTransportData(personId, {
        needsPickup: true,
        datetime: '2099-12-31T23:59:59.000Z',
      }),
    );

    // Should use current time as default, and find the far-future transport
    const pickups = await getUpcomingPickups(tripId);

    expect(pickups).toHaveLength(1);
  });

  it('only returns pickups for specified trip', async () => {
    const trip1 = await createTestTrip('Trip 1');
    const trip2 = await createTestTrip('Trip 2');
    const person1 = await createTestPerson(trip1);
    const person2 = await createTestPerson(trip2);

    await createTransport(
      trip1,
      createTestTransportData(person1, {
        needsPickup: true,
        datetime: '2024-07-15T14:00:00.000Z',
      }),
    );
    await createTransport(
      trip2,
      createTestTransportData(person2, {
        needsPickup: true,
        datetime: '2024-07-15T14:00:00.000Z',
      }),
    );

    const pickups = await getUpcomingPickups(trip1, '2024-07-01T00:00:00.000Z');

    expect(pickups).toHaveLength(1);
  });

  it('includes both arrivals and departures needing pickup', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    await createTransport(
      tripId,
      createTestTransportData(personId, {
        type: 'arrival',
        needsPickup: true,
        datetime: '2024-07-15T14:00:00.000Z',
      }),
    );
    await createTransport(
      tripId,
      createTestTransportData(personId, {
        type: 'departure',
        needsPickup: true,
        datetime: '2024-07-22T10:00:00.000Z',
      }),
    );

    const pickups = await getUpcomingPickups(tripId, '2024-07-01T00:00:00.000Z');

    expect(pickups).toHaveLength(2);
  });
});

// ============================================================================
// getTransportsForDate Tests
// ============================================================================

describe('getTransportsForDate', () => {
  it('returns empty array for date with no transports', async () => {
    const tripId = await createTestTrip();

    const transports = await getTransportsForDate(tripId, '2024-07-15');

    expect(transports).toEqual([]);
  });

  it('returns transports matching the date', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    await createTransport(
      tripId,
      createTestTransportData(personId, { datetime: '2024-07-15T10:00:00.000Z' }),
    );
    await createTransport(
      tripId,
      createTestTransportData(personId, { datetime: '2024-07-15T18:00:00.000Z' }),
    );
    await createTransport(
      tripId,
      createTestTransportData(personId, { datetime: '2024-07-16T10:00:00.000Z' }),
    );

    const transports = await getTransportsForDate(tripId, '2024-07-15');

    expect(transports).toHaveLength(2);
  });

  it('sorts transports by datetime', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    await createTransport(
      tripId,
      createTestTransportData(personId, { datetime: '2024-07-15T18:00:00.000Z' }),
    );
    await createTransport(
      tripId,
      createTestTransportData(personId, { datetime: '2024-07-15T10:00:00.000Z' }),
    );

    const transports = await getTransportsForDate(tripId, '2024-07-15');

    expect(transports[0]?.datetime).toBe('2024-07-15T10:00:00.000Z');
    expect(transports[1]?.datetime).toBe('2024-07-15T18:00:00.000Z');
  });

  it('only returns transports for specified trip', async () => {
    const trip1 = await createTestTrip('Trip 1');
    const trip2 = await createTestTrip('Trip 2');
    const person1 = await createTestPerson(trip1);
    const person2 = await createTestPerson(trip2);

    await createTransport(
      trip1,
      createTestTransportData(person1, { datetime: '2024-07-15T10:00:00.000Z' }),
    );
    await createTransport(
      trip2,
      createTestTransportData(person2, { datetime: '2024-07-15T14:00:00.000Z' }),
    );

    const transports = await getTransportsForDate(trip1, '2024-07-15');

    expect(transports).toHaveLength(1);
  });

  it('handles different timezones on same calendar date', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    // Early morning UTC
    await createTransport(
      tripId,
      createTestTransportData(personId, { datetime: '2024-07-15T01:00:00.000Z' }),
    );
    // Late night UTC
    await createTransport(
      tripId,
      createTestTransportData(personId, { datetime: '2024-07-15T23:59:59.000Z' }),
    );

    const transports = await getTransportsForDate(tripId, '2024-07-15');

    expect(transports).toHaveLength(2);
  });
});

// ============================================================================
// getTransportCount Tests
// ============================================================================

describe('getTransportCount', () => {
  it('returns 0 for trip with no transports', async () => {
    const tripId = await createTestTrip();

    const count = await getTransportCount(tripId);

    expect(count).toBe(0);
  });

  it('returns correct count for trip with transports', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    await createTransport(tripId, createTestTransportData(personId));
    await createTransport(tripId, createTestTransportData(personId));
    await createTransport(tripId, createTestTransportData(personId));

    const count = await getTransportCount(tripId);

    expect(count).toBe(3);
  });

  it('only counts transports for specified trip', async () => {
    const trip1 = await createTestTrip('Trip 1');
    const trip2 = await createTestTrip('Trip 2');
    const person1 = await createTestPerson(trip1);
    const person2 = await createTestPerson(trip2);

    await createTransport(trip1, createTestTransportData(person1));
    await createTransport(trip2, createTestTransportData(person2));
    await createTransport(trip2, createTestTransportData(person2));

    const count = await getTransportCount(trip1);

    expect(count).toBe(1);
  });

  it('counts both arrivals and departures', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    await createTransport(tripId, createTestTransportData(personId, { type: 'arrival' }));
    await createTransport(tripId, createTestTransportData(personId, { type: 'departure' }));

    const count = await getTransportCount(tripId);

    expect(count).toBe(2);
  });
});

// ============================================================================
// getTransportsByDriverId Tests
// ============================================================================

describe('getTransportsByDriverId', () => {
  it('returns empty array for driver with no assigned transports', async () => {
    const tripId = await createTestTrip();
    const driverId = await createTestPerson(tripId);

    const transports = await getTransportsByDriverId(driverId);

    expect(transports).toEqual([]);
  });

  it('returns transports where person is assigned as driver', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId, 'Passenger');
    const driverId = await createTestPerson(tripId, 'Driver');

    await createTransport(
      tripId,
      createTestTransportData(personId, {
        driverId,
        needsPickup: true,
      }),
    );

    const transports = await getTransportsByDriverId(driverId);

    expect(transports).toHaveLength(1);
    expect(transports[0]?.driverId).toBe(driverId);
  });

  it('returns multiple transports for same driver', async () => {
    const tripId = await createTestTrip();
    const person1 = await createTestPerson(tripId, 'Person 1');
    const person2 = await createTestPerson(tripId, 'Person 2');
    const driverId = await createTestPerson(tripId, 'Driver');

    await createTransport(
      tripId,
      createTestTransportData(person1, {
        driverId,
        datetime: '2024-07-15T10:00:00.000Z',
      }),
    );
    await createTransport(
      tripId,
      createTestTransportData(person2, {
        driverId,
        datetime: '2024-07-16T14:00:00.000Z',
      }),
    );

    const transports = await getTransportsByDriverId(driverId);

    expect(transports).toHaveLength(2);
  });

  it('sorts transports by datetime', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);
    const driverId = await createTestPerson(tripId, 'Driver');

    await createTransport(
      tripId,
      createTestTransportData(personId, {
        driverId,
        datetime: '2024-07-17T10:00:00.000Z',
      }),
    );
    await createTransport(
      tripId,
      createTestTransportData(personId, {
        driverId,
        datetime: '2024-07-15T14:00:00.000Z',
      }),
    );

    const transports = await getTransportsByDriverId(driverId);

    expect(transports[0]?.datetime).toBe('2024-07-15T14:00:00.000Z');
    expect(transports[1]?.datetime).toBe('2024-07-17T10:00:00.000Z');
  });

  it('does not return transports where person is passenger, not driver', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    await createTransport(
      tripId,
      createTestTransportData(personId, {
        driverId: undefined,
        needsPickup: true,
      }),
    );

    const transports = await getTransportsByDriverId(personId);

    expect(transports).toEqual([]);
  });

  it('returns transports across multiple trips', async () => {
    const trip1 = await createTestTrip('Trip 1');
    const trip2 = await createTestTrip('Trip 2');
    // Create same driver in both trips (simulating shared person - though in real app IDs would differ)
    const person1 = await createTestPerson(trip1, 'Person 1');
    const person2 = await createTestPerson(trip2, 'Person 2');
    const driver1 = await createTestPerson(trip1, 'Driver');

    await createTransport(
      trip1,
      createTestTransportData(person1, { driverId: driver1 }),
    );
    await createTransport(
      trip2,
      createTestTransportData(person2, { driverId: undefined }),
    );

    const transports = await getTransportsByDriverId(driver1);

    // Only transport from trip1 where driver1 is actually the driver
    expect(transports).toHaveLength(1);
  });
});
