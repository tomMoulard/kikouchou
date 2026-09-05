/**
 * @fileoverview Rides and vehicles across the CRDT boundary.
 *
 * Two claims are asserted here, and both are the reason the model is shaped the
 * way it is:
 *
 * 1. **Two guests joining the same car while offline both survive the merge.**
 *    That only holds because membership is a scalar on each guest's own leg. A
 *    passenger array on the ride merges atomically, and this file is what fails
 *    if anybody ever moves it there.
 * 2. **A ride arriving from a peer is bounded before it reaches Dexie.** The
 *    document carries other members' writes, so it is exactly as untrusted as
 *    the network.
 *
 * @module lib/yjs/__tests__/ride-doc-projection.test
 */

import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { db } from '@/lib/db/database';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { toISODateStringFromString } from '@/lib/db/utils';
import { syncDocToDexie } from '../dexie-bridge';
import {
  readDocCollection,
  replaceDocCollection,
  stampDocSchemaVersion,
} from '../doc-model';
import type { TripId } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

let tripId: TripId;

beforeEach(async () => {
  const trip = await createTrip({
    name: 'Summer',
    startDate: toISODateStringFromString('2026-07-15'),
    endDate: toISODateStringFromString('2026-07-22'),
  });
  tripId = trip.id;
});

/** A document already carrying this trip's metadata and schema stamp. */
function makeDoc(): Y.Doc {
  const doc = new Y.Doc(),
    meta = doc.getMap('meta');

  stampDocSchemaVersion(doc);
  meta.set('name', 'Summer');
  meta.set('startDate', '2026-07-15');
  meta.set('endDate', '2026-07-22');
  meta.set('shareId', 'share-1');
  meta.set('createdAt', Date.now());
  meta.set('updatedAt', Date.now());

  return doc;
}

// ============================================================================
// Tests
// ============================================================================

describe('membership under a concurrent offline merge', () => {
  it('keeps both joins when two guests pick the same car offline', async () => {
    // The bug this shape exists to avoid: `Y.Map` merges an array field
    // atomically, so a `passengerIds` array on the ride would keep one of these
    // two joins and silently drop the other — exactly what activity
    // participants do today, as `doc-model` documents.
    const base = makeDoc();
    replaceDocCollection(
      base,
      'rides',
      [
        {
          id: 'r1',
          direction: 'pickup',
          meetDatetime: '2026-07-15T15:02:00.000Z',
          location: 'Lyon Part-Dieu',
        },
      ],
      { allowDeletions: false },
    );
    replaceDocCollection(
      base,
      'transport',
      [
        {
          id: 't-alice',
          personId: 'alice',
          type: 'arrival',
          datetime: '2026-07-15T15:02:00.000Z',
          location: 'Lyon Part-Dieu',
          needsPickup: true,
        },
        {
          id: 't-tom',
          personId: 'tom',
          type: 'arrival',
          datetime: '2026-07-15T15:02:00.000Z',
          location: 'Lyon Part-Dieu',
          needsPickup: true,
        },
      ],
      { allowDeletions: false },
    );

    // Two devices fork from the same state and never see each other's edit.
    const alicesPhone = new Y.Doc(),
      tomsPhone = new Y.Doc();
    Y.applyUpdate(alicesPhone, Y.encodeStateAsUpdate(base));
    Y.applyUpdate(tomsPhone, Y.encodeStateAsUpdate(base));

    (alicesPhone.getMap('transportById').get('t-alice') as Y.Map<unknown>).set(
      'rideId',
      'r1',
    );
    (tomsPhone.getMap('transportById').get('t-tom') as Y.Map<unknown>).set(
      'rideId',
      'r1',
    );

    // They come back online and exchange updates.
    Y.applyUpdate(alicesPhone, Y.encodeStateAsUpdate(tomsPhone));
    Y.applyUpdate(tomsPhone, Y.encodeStateAsUpdate(alicesPhone));

    for (const doc of [alicesPhone, tomsPhone]) {
      const legs = readDocCollection(doc, 'transport');
      expect(legs.map((leg) => leg.rideId)).toEqual(['r1', 'r1']);
    }
  });
});

describe('projecting rides and vehicles into Dexie', () => {
  it('carries a ride and its car across', async () => {
    const doc = makeDoc();
    replaceDocCollection(
      doc,
      'vehicles',
      [
        {
          id: 'v1',
          name: 'Espace',
          seatCount: 7,
          childSeats: ['booster', 'booster'],
          isRental: true,
        },
      ],
      { allowDeletions: false },
    );
    replaceDocCollection(
      doc,
      'rides',
      [
        {
          id: 'r1',
          direction: 'dropoff',
          meetDatetime: '2026-07-20T09:00:00.000Z',
          location: 'CDG',
          leadTimeMinutes: 45,
          vehicleId: 'v1',
        },
      ],
      { allowDeletions: false },
    );

    await syncDocToDexie(doc, tripId);

    const ride = await db.rides.get('r1'),
      vehicle = await db.vehicles.get('v1');

    expect(ride).toMatchObject({
      tripId,
      direction: 'dropoff',
      location: 'CDG',
      leadTimeMinutes: 45,
      vehicleId: 'v1',
    });
    expect(vehicle).toMatchObject({
      tripId,
      name: 'Espace',
      seatCount: 7,
      childSeats: ['booster', 'booster'],
      isRental: true,
    });
  });

  it('bounds a hostile lead time rather than trusting it', async () => {
    // Unbounded, this puts a "leave now" alert nineteen centuries in the past,
    // where it is permanently due and permanently on screen.
    const doc = makeDoc();
    replaceDocCollection(
      doc,
      'rides',
      [
        {
          id: 'r1',
          direction: 'pickup',
          meetDatetime: '2026-07-15T15:02:00.000Z',
          location: 'Lyon Part-Dieu',
          leadTimeMinutes: 1_000_000_000,
        },
      ],
      { allowDeletions: false },
    );

    await syncDocToDexie(doc, tripId);

    expect((await db.rides.get('r1'))?.leadTimeMinutes).toBe(24 * 60);
  });

  it('bounds a hostile seat count and drops unknown child seats', async () => {
    const doc = makeDoc();
    replaceDocCollection(
      doc,
      'vehicles',
      [
        {
          id: 'v1',
          name: 'x'.repeat(5000),
          seatCount: 1e9,
          childSeats: ['booster', 'ejector-seat', 'rearFacing'],
        },
      ],
      { allowDeletions: false },
    );

    await syncDocToDexie(doc, tripId);

    const vehicle = await db.vehicles.get('v1');
    expect(vehicle?.name).toHaveLength(100);
    expect(vehicle?.seatCount).toBe(99);
    expect(vehicle?.childSeats).toEqual(['booster', 'rearFacing']);
  });

  it('falls back to a pickup for a direction it does not recognise', async () => {
    const doc = makeDoc();
    replaceDocCollection(
      doc,
      'rides',
      [
        {
          id: 'r1',
          direction: 'teleport',
          meetDatetime: '2026-07-15T15:02:00.000Z',
          location: 'Lyon Part-Dieu',
        },
      ],
      { allowDeletions: false },
    );

    await syncDocToDexie(doc, tripId);

    expect((await db.rides.get('r1'))?.direction).toBe('pickup');
  });

  it('never lets a remote row claim another trip', async () => {
    const doc = makeDoc();
    replaceDocCollection(
      doc,
      'rides',
      [
        {
          id: 'r1',
          tripId: 'some-other-trip',
          direction: 'pickup',
          meetDatetime: '2026-07-15T15:02:00.000Z',
          location: 'Lyon Part-Dieu',
        },
      ],
      { allowDeletions: false },
    );

    await syncDocToDexie(doc, tripId);

    expect((await db.rides.get('r1'))?.tripId).toBe(tripId);
  });
});
