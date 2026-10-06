/**
 * Tests for ownership-check operations in transport-repository.
 *
 * @module lib/db/repositories/__tests__/transport-ownership.test
 */
import { describe, it, expect } from 'vitest';
import {
  createTransport,
  getTransportById,
  updateTransportWithOwnershipCheck,
  deleteTransportWithOwnershipCheck,
} from '@/lib/db/repositories/transport-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { createPerson } from '@/lib/db/repositories/person-repository';
import type { PersonId, TransportId, TripId } from '@/types';
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

async function createTestPerson(tripId: TripId, name = 'Alice'): Promise<PersonId> {
  const person = await createPerson(tripId, { name, color: hexColor('#ef4444') });
  return person.id;
}

// ============================================================================
// updateTransportWithOwnershipCheck
// ============================================================================

describe('updateTransportWithOwnershipCheck', () => {
  it('updates transport when ownership is valid', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);
    const transport = await createTransport(tripId, {
      type: 'arrival',
      personId,
      datetime: '2024-07-15T10:00:00.000Z',
      location: 'Airport',
      needsPickup: false,
    });

    await updateTransportWithOwnershipCheck(transport.id, tripId, {
      location: 'Train Station',
    });

    const updated = await getTransportById(transport.id);
    expect(updated?.location).toBe('Train Station');
  });

  it('throws when transport does not exist', async () => {
    const tripId = await createTestTrip();

    await expect(
      updateTransportWithOwnershipCheck('nonexistent' as TransportId, tripId, { location: 'x' })
    ).rejects.toThrow('not found');
  });

  it('throws when transport belongs to different trip', async () => {
    const tripId1 = await createTestTrip('Trip 1');
    const tripId2 = await createTestTrip('Trip 2');
    const personId = await createTestPerson(tripId1);
    const transport = await createTransport(tripId1, {
      type: 'arrival',
      personId,
      datetime: '2024-07-15T10:00:00.000Z',
      location: '',
      needsPickup: false,
    });

    await expect(
      updateTransportWithOwnershipCheck(transport.id, tripId2, { location: 'x' })
    ).rejects.toThrow('does not belong to current trip');
  });
});

// ============================================================================
// deleteTransportWithOwnershipCheck
// ============================================================================

describe('deleteTransportWithOwnershipCheck', () => {
  it('deletes transport when ownership is valid', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);
    const transport = await createTransport(tripId, {
      type: 'departure',
      personId,
      datetime: '2024-07-20T14:00:00.000Z',
      location: '',
      needsPickup: false,
    });

    await deleteTransportWithOwnershipCheck(transport.id, tripId);

    const deleted = await getTransportById(transport.id);
    expect(deleted).toBeUndefined();
  });

  it('throws when transport does not exist', async () => {
    const tripId = await createTestTrip();

    await expect(
      deleteTransportWithOwnershipCheck('nonexistent' as TransportId, tripId)
    ).rejects.toThrow('not found');
  });

  it('throws when transport belongs to different trip', async () => {
    const tripId1 = await createTestTrip('Trip 1');
    const tripId2 = await createTestTrip('Trip 2');
    const personId = await createTestPerson(tripId1);
    const transport = await createTransport(tripId1, {
      type: 'arrival',
      personId,
      datetime: '2024-07-15T10:00:00.000Z',
      location: '',
      needsPickup: false,
    });

    await expect(
      deleteTransportWithOwnershipCheck(transport.id, tripId2)
    ).rejects.toThrow('does not belong to current trip');
  });
});
