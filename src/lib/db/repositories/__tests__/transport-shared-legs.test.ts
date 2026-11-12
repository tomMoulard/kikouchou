/**
 * Tests for several guests on one train: creating the legs, keeping the train
 * the same for all of them, joining, leaving and deleting it.
 *
 * @module lib/db/repositories/__tests__/transport-shared-legs.test
 */
import { describe, expect, it } from 'vitest';

import {
  createSharedTransports,
  createTransport,
  deleteSharedLegWithOwnershipCheck,
  getTransportById,
  getTransportsByTripId,
  setTransportSharedLeg,
  updateTransportWithOwnershipCheck,
} from '@/lib/db/repositories/transport-repository';
import { createPerson } from '@/lib/db/repositories/person-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { getSharedLegKey } from '@/lib/db/shared-legs';
import { toSharedLegId } from '@/lib/db/utils';
import { hexColor, isoDate } from '@/test/utils';
import type { PersonId, SharedLegId, TransportFormData, TripId } from '@/types';

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

async function createTestPerson(tripId: TripId, name: string): Promise<PersonId> {
  const person = await createPerson(tripId, { name, color: hexColor('#ef4444') });
  return person.id;
}

const TGV: Omit<TransportFormData, 'personId'> = {
  type: 'arrival',
  datetime: '2024-07-15T14:30:00.000Z',
  location: 'Gare de Lyon',
  transportMode: 'train',
  transportNumber: 'TGV 6105',
  needsPickup: true,
};

// ============================================================================
// createSharedTransports
// ============================================================================

describe('createSharedTransports', () => {
  it('creates one leg per guest, the first one founding the train', async () => {
    const tripId = await createTestTrip();
    const alice = await createTestPerson(tripId, 'Alice');
    const bob = await createTestPerson(tripId, 'Bob');
    const carol = await createTestPerson(tripId, 'Carol');

    const legs = await createSharedTransports(tripId, TGV, [alice, bob, carol]);

    expect(legs.map((leg) => leg.personId)).toEqual([alice, bob, carol]);
    const [founder, ...others] = legs;
    // The founder's key is its own id, so it stores nothing extra.
    expect(founder?.sharedLegId).toBeUndefined();
    for (const other of others) {
      expect(other.sharedLegId).toBe(founder?.id);
      expect(other.transportNumber).toBe('TGV 6105');
    }
    const stored = await getTransportsByTripId(tripId);
    expect(new Set(stored.map(getSharedLegKey)).size).toBe(1);
  });

  it('writes a lone guest as an ordinary leg', async () => {
    const tripId = await createTestTrip();
    const alice = await createTestPerson(tripId, 'Alice');

    const [leg] = await createSharedTransports(tripId, TGV, [alice]);

    expect(leg?.sharedLegId).toBeUndefined();
  });

  it('joins guests to a train already entered', async () => {
    const tripId = await createTestTrip();
    const alice = await createTestPerson(tripId, 'Alice');
    const bob = await createTestPerson(tripId, 'Bob');
    const founder = await createTransport(tripId, { ...TGV, personId: alice });

    const [joined] = await createSharedTransports(
      tripId,
      { ...TGV, sharedLegId: toSharedLegId(founder.id) },
      [bob],
    );

    expect(joined?.sharedLegId).toBe(founder.id);
    // Joining writes the guest's own row and leaves the founder's alone.
    expect((await getTransportById(founder.id))?.sharedLegId).toBeUndefined();
  });

  it('refuses to join a train this trip does not have', async () => {
    const tripId = await createTestTrip();
    const alice = await createTestPerson(tripId, 'Alice');

    await expect(
      createSharedTransports(
        tripId,
        { ...TGV, sharedLegId: 'not-a-leg' as SharedLegId },
        [alice],
      ),
    ).rejects.toThrow();
    expect(await getTransportsByTripId(tripId)).toHaveLength(0);
  });

  it('refuses a train with nobody on it', async () => {
    const tripId = await createTestTrip();

    await expect(createSharedTransports(tripId, TGV, [])).rejects.toThrow(
      'at least one guest',
    );
  });
});

// ============================================================================
// updateTransportWithOwnershipCheck on a shared train
// ============================================================================

describe('updateTransportWithOwnershipCheck on a shared train', () => {
  it("writes the train's fields to every guest on it", async () => {
    const tripId = await createTestTrip();
    const alice = await createTestPerson(tripId, 'Alice');
    const bob = await createTestPerson(tripId, 'Bob');
    const [aliceLeg, bobLeg] = await createSharedTransports(tripId, TGV, [alice, bob]);

    // Edited from Bob's leg, which is not the founder: the founder follows too.
    await updateTransportWithOwnershipCheck(bobLeg!.id, tripId, {
      datetime: '2024-07-15T15:10:00.000Z',
      location: 'Gare Montparnasse',
      notes: 'Coach 12',
    });

    const aliceAfter = await getTransportById(aliceLeg!.id);
    expect(aliceAfter?.datetime).toBe('2024-07-15T15:10:00.000Z');
    expect(aliceAfter?.location).toBe('Gare Montparnasse');
    expect(aliceAfter?.notes).toBe('Coach 12');
  });

  it("keeps each guest's own pickup", async () => {
    const tripId = await createTestTrip();
    const alice = await createTestPerson(tripId, 'Alice');
    const bob = await createTestPerson(tripId, 'Bob');
    const [aliceLeg, bobLeg] = await createSharedTransports(tripId, TGV, [alice, bob]);

    await updateTransportWithOwnershipCheck(bobLeg!.id, tripId, { needsPickup: false });

    expect((await getTransportById(aliceLeg!.id))?.needsPickup).toBe(true);
    expect((await getTransportById(bobLeg!.id))?.needsPickup).toBe(false);
  });

  it('leaves a train it is not on alone', async () => {
    const tripId = await createTestTrip();
    const alice = await createTestPerson(tripId, 'Alice');
    const bob = await createTestPerson(tripId, 'Bob');
    const aliceLeg = await createTransport(tripId, { ...TGV, personId: alice });
    const bobLeg = await createTransport(tripId, { ...TGV, personId: bob });

    await updateTransportWithOwnershipCheck(aliceLeg.id, tripId, { location: 'Elsewhere' });

    expect((await getTransportById(bobLeg.id))?.location).toBe('Gare de Lyon');
  });
});

// ============================================================================
// setTransportSharedLeg
// ============================================================================

describe('setTransportSharedLeg', () => {
  it("joins a guest's leg to a train and copies the train onto it", async () => {
    const tripId = await createTestTrip();
    const alice = await createTestPerson(tripId, 'Alice');
    const bob = await createTestPerson(tripId, 'Bob');
    const train = await createTransport(tripId, {
      ...TGV,
      personId: alice,
      startLocation: 'Paris',
    });
    const bobLeg = await createTransport(tripId, {
      type: 'departure',
      personId: bob,
      datetime: '2024-07-15T09:00:00.000Z',
      location: 'Somewhere',
      notes: 'Typed by hand',
      needsPickup: false,
    });

    const key = await setTransportSharedLeg(bobLeg.id, tripId, toSharedLegId(train.id));

    const joined = await getTransportById(bobLeg.id);
    expect(key).toBe(train.id);
    expect(joined?.sharedLegId).toBe(train.id);
    expect(joined).toMatchObject({
      type: 'arrival',
      datetime: TGV.datetime,
      location: 'Gare de Lyon',
      startLocation: 'Paris',
      transportNumber: 'TGV 6105',
    });
    // A field the train does not have is cleared on the joiner too.
    expect(joined?.notes).toBeUndefined();
    // Bob keeps his own pickup.
    expect(joined?.needsPickup).toBe(false);
  });

  it('takes a guest who joined off the train', async () => {
    const tripId = await createTestTrip();
    const alice = await createTestPerson(tripId, 'Alice');
    const bob = await createTestPerson(tripId, 'Bob');
    const [, bobLeg] = await createSharedTransports(tripId, TGV, [alice, bob]);

    const key = await setTransportSharedLeg(bobLeg!.id, tripId, null);

    expect((await getTransportById(bobLeg!.id))?.sharedLegId).toBeUndefined();
    expect(key).toBe(bobLeg!.id);
  });

  it('gives the founder a key of its own, and keeps the others together', async () => {
    const tripId = await createTestTrip();
    const alice = await createTestPerson(tripId, 'Alice');
    const bob = await createTestPerson(tripId, 'Bob');
    const carol = await createTestPerson(tripId, 'Carol');
    const [aliceLeg, bobLeg, carolLeg] = await createSharedTransports(tripId, TGV, [
      alice,
      bob,
      carol,
    ]);

    const key = await setTransportSharedLeg(aliceLeg!.id, tripId, null);

    const aliceAfter = await getTransportById(aliceLeg!.id);
    const bobAfter = await getTransportById(bobLeg!.id);
    const carolAfter = await getTransportById(carolLeg!.id);
    expect(getSharedLegKey(aliceAfter!)).toBe(key);
    expect(key).not.toBe(aliceLeg!.id);
    expect(getSharedLegKey(bobAfter!)).toBe(getSharedLegKey(carolAfter!));
    expect(getSharedLegKey(bobAfter!)).not.toBe(key);
  });

  it('refuses a train this trip does not have', async () => {
    const tripId = await createTestTrip();
    const alice = await createTestPerson(tripId, 'Alice');
    const leg = await createTransport(tripId, { ...TGV, personId: alice });

    await expect(
      setTransportSharedLeg(leg.id, tripId, 'not-a-leg' as SharedLegId),
    ).rejects.toThrow();
  });

  it("refuses another trip's leg", async () => {
    const tripId = await createTestTrip();
    const otherTripId = await createTestTrip('Other');
    const alice = await createTestPerson(tripId, 'Alice');
    const leg = await createTransport(tripId, { ...TGV, personId: alice });

    await expect(setTransportSharedLeg(leg.id, otherTripId, null)).rejects.toThrow(
      'does not belong',
    );
  });
});

// ============================================================================
// deleteSharedLegWithOwnershipCheck
// ============================================================================

describe('deleteSharedLegWithOwnershipCheck', () => {
  it('deletes every guest on the train and nothing else', async () => {
    const tripId = await createTestTrip();
    const alice = await createTestPerson(tripId, 'Alice');
    const bob = await createTestPerson(tripId, 'Bob');
    const [, bobLeg] = await createSharedTransports(tripId, TGV, [alice, bob]);
    const other = await createTransport(tripId, { ...TGV, personId: alice });

    const deleted = await deleteSharedLegWithOwnershipCheck(bobLeg!.id, tripId);

    expect(deleted).toBe(2);
    const left = await getTransportsByTripId(tripId);
    expect(left.map((leg) => leg.id)).toEqual([other.id]);
  });

  it("refuses another trip's leg", async () => {
    const tripId = await createTestTrip();
    const otherTripId = await createTestTrip('Other');
    const alice = await createTestPerson(tripId, 'Alice');
    const leg = await createTransport(tripId, { ...TGV, personId: alice });

    await expect(deleteSharedLegWithOwnershipCheck(leg.id, otherTripId)).rejects.toThrow(
      'does not belong',
    );
    expect(await getTransportById(leg.id)).toBeDefined();
  });
});
