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

  it('drops one hostile record without taking the projection with it', async () => {
    // A non-string `notes` used to reach `sanitizeOptionalText`, throw inside
    // the transaction, and roll back the whole trip — every guest, room,
    // assignment and transport with it — while the catch swallowed the error.
    // The trip then silently stopped receiving remote changes.
    const doc = makeDoc();
    replaceDocCollection(
      doc,
      'rides',
      [
        {
          id: 'good',
          direction: 'pickup',
          meetDatetime: '2026-07-15T15:02:00.000Z',
          location: 'Lyon Part-Dieu',
        },
        {
          id: 'hostile',
          direction: 'pickup',
          meetDatetime: '2026-07-15T16:00:00.000Z',
          location: 'Gare de Vannes',
          notes: 42,
        },
      ],
      { allowDeletions: false },
    );
    replaceDocCollection(
      doc,
      'vehicles',
      [{ id: 'v-hostile', name: 'Clio', luggageNotes: { nope: true } }],
      { allowDeletions: false },
    );

    await syncDocToDexie(doc, tripId);

    expect(await db.rides.get('good')).toBeDefined();
    expect((await db.rides.get('hostile'))?.notes).toBeUndefined();
    expect((await db.vehicles.get('v-hostile'))?.luggageNotes).toBeUndefined();
  });

  it('drops a ride whose meeting time would be unreachable', async () => {
    // `meetDatetime` is the second half of `[tripId+meetDatetime]`. A numeric
    // one is filed outside the range every ride read scans — including the
    // delete-candidate query in this very projection — so the row would be
    // invisible and unremovable for the life of the trip.
    const doc = makeDoc();
    replaceDocCollection(
      doc,
      'rides',
      [
        {
          id: 'unreachable',
          direction: 'pickup',
          meetDatetime: 1_721_053_320_000,
          location: 'Lyon Part-Dieu',
        },
      ],
      { allowDeletions: false },
    );

    await syncDocToDexie(doc, tripId);

    expect(await db.rides.get('unreachable')).toBeUndefined();
  });

  it('drops a child seat kind it does not recognise', async () => {
    // A peer, or a newer build with a fourth restraint class, can put anything
    // here. It reaches `tallyRequiredChildSeats`, which indexes a tally by it.
    const doc = makeDoc();
    replaceDocCollection(
      doc,
      'guests',
      [
        { id: 'g1', name: 'Jeanne', color: '#ef4444', childSeat: 'rearFacing' },
        { id: 'g2', name: 'Alien', color: '#3b82f6', childSeat: 'hoverboard' },
      ],
      { allowDeletions: false },
    );

    await syncDocToDexie(doc, tripId);

    expect((await db.persons.get('g1'))?.childSeat).toBe('rearFacing');
    expect((await db.persons.get('g2'))?.childSeat).toBeUndefined();
  });

  it('drops a pin that is not somewhere on Earth', async () => {
    // Not merely a wrong marker: an out-of-range or non-finite pin poisons the
    // centroid the map centres on and the bounds it fits, so one bad row pushes
    // every real pin off the screen.
    const doc = makeDoc();
    replaceDocCollection(
      doc,
      'rides',
      [
        {
          id: 'good',
          direction: 'pickup',
          meetDatetime: '2026-07-15T15:02:00.000Z',
          location: 'Lyon Part-Dieu',
          coordinates: { lat: 45.7605, lon: 4.8598 },
        },
        {
          id: 'null-pin',
          direction: 'pickup',
          meetDatetime: '2026-07-15T15:02:00.000Z',
          location: 'Nowhere',
          coordinates: null,
        },
        {
          id: 'infinite',
          direction: 'pickup',
          meetDatetime: '2026-07-15T15:02:00.000Z',
          location: 'Everywhere',
          coordinates: { lat: Infinity, lon: 2.5 },
        },
        {
          id: 'off-planet',
          direction: 'pickup',
          meetDatetime: '2026-07-15T15:02:00.000Z',
          location: 'Orbit',
          coordinates: { lat: 500, lon: 2.5 },
        },
      ],
      { allowDeletions: false },
    );

    await syncDocToDexie(doc, tripId);

    expect((await db.rides.get('good'))?.coordinates).toEqual({
      lat: 45.7605,
      lon: 4.8598,
    });
    for (const id of ['null-pin', 'infinite', 'off-planet']) {
      expect((await db.rides.get(id))?.coordinates).toBeUndefined();
    }
  });

  it('bounds a leg the way it bounds a ride', async () => {
    // Transports were the last collection still cast straight out of the
    // document. `pickup-utils` records the resulting crash: a row with no
    // `location` threw inside a `.trim()` and took the whole transports page
    // into the error boundary rather than dropping the one bad row.
    const doc = makeDoc();
    replaceDocCollection(
      doc,
      'transport',
      [
        {
          id: 'ok',
          personId: 'p1',
          type: 'arrival',
          datetime: '2026-07-15T15:02:00.000Z',
          location: 'Lyon Part-Dieu',
          needsPickup: true,
          coordinates: { lat: 45.7605, lon: 4.8598 },
        },
        {
          id: 'no-location',
          personId: 'p2',
          type: 'arrival',
          datetime: '2026-07-15T16:00:00.000Z',
          needsPickup: true,
          coordinates: { lat: 999, lon: 4 },
        },
        {
          id: 'unreadable-datetime',
          personId: 'p3',
          type: 'arrival',
          datetime: 42,
          location: 'Nowhere',
          needsPickup: true,
        },
      ],
      { allowDeletions: false },
    );

    await syncDocToDexie(doc, tripId);

    expect((await db.transports.get('ok'))?.coordinates).toEqual({
      lat: 45.7605,
      lon: 4.8598,
    });
    // Kept, but readable: an empty station beats a page that will not render.
    expect((await db.transports.get('no-location'))?.location).toBe('');
    expect((await db.transports.get('no-location'))?.coordinates).toBeUndefined();
    // Dropped: filed outside the index every transport read scans, so it would
    // have been invisible and unremovable for the life of the trip.
    expect(await db.transports.get('unreadable-datetime')).toBeUndefined();
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
