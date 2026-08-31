/**
 * dexie-bridge trust-boundary tests
 *
 * The bridge writes remote-peer content into IndexedDB, so it is the app's
 * main untrusted-input boundary. These tests pin the invariants that a peer
 * must not be able to break.
 *
 * @module lib/yjs/__tests__/dexie-bridge.test
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { db } from '@/lib/db/database';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { syncDocToDexie } from '@/lib/yjs/dexie-bridge';
import { DOC_SCHEMA_VERSION } from '@/lib/yjs/doc-model';
import { isoDate } from '@/test/utils';
import type { Person, TripId } from '@/types';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Builds a Y.Doc the way a remote peer would present one.
 *
 * The schema stamp is part of that: a peer running the current build always
 * declares it, and `syncDocToDexie` refuses a document that does not, so
 * omitting it here would exercise the version guard instead of the assertion
 * each test is actually about. Pass `schema` explicitly to test the guard.
 */
function makeDoc(meta: Record<string, unknown>): Y.Doc {
  const doc = new Y.Doc();
  const map = doc.getMap('meta');
  map.set('schema', DOC_SCHEMA_VERSION);
  for (const [key, value] of Object.entries(meta)) {
    map.set(key, value);
  }
  return doc;
}

// ============================================================================
// Tests
// ============================================================================

describe('syncDocToDexie — trust boundary', () => {
  it('refuses a doc whose meta.id names a different local trip', async () => {
    const victim = await createTrip({
      name: 'My private trip',
      startDate: isoDate('2024-07-15'),
      endDate: isoDate('2024-07-20'),
    });
    const shared = await createTrip({
      name: 'Shared trip',
      startDate: isoDate('2024-08-01'),
      endDate: isoDate('2024-08-05'),
    });
    await db.trips.update(shared.id, { p2pRoomId: 'room-shared' });

    // A peer in room-shared claims to be the victim's trip.
    const hostile = makeDoc({
      id: victim.id,
      name: 'Pwned',
      startDate: '2024-07-15',
      endDate: '2024-07-20',
    });

    const result = await syncDocToDexie(hostile, 'room-shared');

    expect(result).toBeNull();
    const stored = await db.trips.get(victim.id);
    expect(stored?.name).toBe('My private trip');
    expect(stored?.p2pRoomId).toBeUndefined();
  });

  it('accepts a doc for the trip the room actually belongs to', async () => {
    const trip = await createTrip({
      name: 'Shared trip',
      startDate: isoDate('2024-08-01'),
      endDate: isoDate('2024-08-05'),
    });
    await db.trips.update(trip.id, { p2pRoomId: 'room-ok' });

    const doc = makeDoc({
      id: trip.id,
      name: 'Renamed by peer',
      startDate: '2024-08-01',
      endDate: '2024-08-05',
    });

    const result = await syncDocToDexie(doc, 'room-ok');

    expect(result).toBe(trip.id);
    expect((await db.trips.get(trip.id))?.name).toBe('Renamed by peer');
  });

  it('never adopts a shareId supplied by a peer', async () => {
    const other = await createTrip({
      name: 'Other',
      startDate: isoDate('2024-07-01'),
      endDate: isoDate('2024-07-02'),
    });
    const trip = await createTrip({
      name: 'Shared trip',
      startDate: isoDate('2024-08-01'),
      endDate: isoDate('2024-08-05'),
    });
    await db.trips.update(trip.id, { p2pRoomId: 'room-share' });
    const originalShareId = (await db.trips.get(trip.id))?.shareId;

    // shareId is a UNIQUE index: adopting a colliding value would abort the
    // whole write transaction and permanently kill sync for this trip.
    const doc = makeDoc({
      id: trip.id,
      shareId: other.shareId,
      name: 'Shared trip',
      startDate: '2024-08-01',
      endDate: '2024-08-05',
    });

    await expect(syncDocToDexie(doc, 'room-share')).resolves.toBe(trip.id);
    expect((await db.trips.get(trip.id))?.shareId).toBe(originalShareId);
  });

  it('does not derive the encryption key from the page URL', async () => {
    const trip = await createTrip({
      name: 'Shared trip',
      startDate: isoDate('2024-08-01'),
      endDate: isoDate('2024-08-05'),
    });
    await db.trips.update(trip.id, {
      p2pRoomId: 'room-key',
      p2pEncryptionKey: 'the-real-key',
    });

    // The a11y skip link puts '#main-content' here in normal use.
    window.location.hash = '#main-content';

    const doc = makeDoc({
      id: trip.id,
      name: 'Shared trip',
      startDate: '2024-08-01',
      endDate: '2024-08-05',
    });
    await syncDocToDexie(doc, 'room-key');

    expect((await db.trips.get(trip.id))?.p2pEncryptionKey).toBe('the-real-key');
    window.location.hash = '';
  });

  it('stores an explicitly supplied key on first join', async () => {
    const doc = makeDoc({
      id: 'brand-new-trip' as TripId,
      name: 'Invited trip',
      startDate: '2024-08-01',
      endDate: '2024-08-05',
    });

    await syncDocToDexie(doc, 'room-new', 'key-from-share-link');

    const stored = await db.trips.get('brand-new-trip' as TripId);
    expect(stored?.p2pEncryptionKey).toBe('key-from-share-link');
  });

  it('refuses a doc from a peer on the older array-based schema', async () => {
    const trip = await createTrip({
      name: 'Shared trip',
      startDate: isoDate('2024-07-15'),
      endDate: isoDate('2024-07-20'),
    });
    await db.trips.update(trip.id, { p2pRoomId: 'room-legacy' });
    await db.persons.add({
      id: 'keep-me' as Person['id'],
      tripId: trip.id,
      name: 'Alice',
      color: '#ff0000' as Person['color'],
    });

    // A v1 peer keeps its collections in Y.Arrays, so every `…ById` map reads
    // as empty. Projecting that would wipe a trip whose data is intact.
    const legacy = makeDoc({
      schema: 1,
      id: trip.id,
      name: 'Shared trip',
      startDate: '2024-07-15',
      endDate: '2024-07-20',
    });

    await expect(syncDocToDexie(legacy, 'room-legacy')).resolves.toBeNull();
    expect(await db.persons.where('tripId').equals(trip.id).count()).toBe(1);
  });

  it('ignores a doc with a non-string meta.id instead of rejecting', async () => {
    const doc = makeDoc({ id: { nope: true }, name: 'x' });

    // The caller invokes this as a bare `void`, so a rejection here would be an
    // unhandled rejection on every remote update.
    await expect(syncDocToDexie(doc, 'room-bad')).resolves.toBeNull();
  });
});
