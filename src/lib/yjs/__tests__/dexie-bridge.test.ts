/**
 * dexie-bridge trust-boundary tests
 *
 * The bridge writes remote content into IndexedDB, so it is the app's main
 * untrusted-input boundary. These pin the invariants a peer must not be able to
 * break.
 *
 * The boundary moved with the WebRTC retirement but did not weaken. It used to
 * resolve which trip a document belonged to by looking up its `p2pRoomId`; now
 * the caller passes the trip id it already holds from local state, and `meta.id`
 * remains a claim to verify rather than an address to write to. Same rule, one
 * less indirection: never use a remote-supplied id as a write key.
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

    // A document bound to `shared` claims to be the victim's trip. Trusting
    // meta.id as the write key let a peer overwrite — and wipe — an unrelated
    // local trip.
    const hostile = makeDoc({
      id: victim.id,
      name: 'Pwned',
      startDate: '2024-07-15',
      endDate: '2024-07-20',
    });

    const result = await syncDocToDexie(hostile, shared.id);

    expect(result).toBeNull();
    const stored = await db.trips.get(victim.id);
    expect(stored?.name).toBe('My private trip');
  });

  it('accepts a doc for the trip it is bound to', async () => {
    const trip = await createTrip({
      name: 'Shared trip',
      startDate: isoDate('2024-08-01'),
      endDate: isoDate('2024-08-05'),
    });

    const doc = makeDoc({
      id: trip.id,
      name: 'Renamed by peer',
      startDate: '2024-08-01',
      endDate: '2024-08-05',
    });

    const result = await syncDocToDexie(doc, trip.id);

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

    await expect(syncDocToDexie(doc, trip.id)).resolves.toBe(trip.id);
    expect((await db.trips.get(trip.id))?.shareId).toBe(originalShareId);
  });

  it('never adopts a remoteTripId supplied by a peer', async () => {
    const trip = await createTrip({
      name: 'Shared trip',
      startDate: isoDate('2024-08-01'),
      endDate: isoDate('2024-08-05'),
    });
    await db.trips.update(trip.id, { remoteTripId: 'the-real-server-row' });

    // remoteTripId decides which server row this device reads and writes. A peer
    // that could set it would redirect this trip's whole sync elsewhere.
    const doc = makeDoc({
      id: trip.id,
      remoteTripId: 'attacker-controlled-row',
      name: 'Shared trip',
      startDate: '2024-08-01',
      endDate: '2024-08-05',
    });

    await syncDocToDexie(doc, trip.id);

    expect((await db.trips.get(trip.id))?.remoteTripId).toBe('the-real-server-row');
  });

  it('does not read anything from the page URL', async () => {
    const trip = await createTrip({
      name: 'Shared trip',
      startDate: isoDate('2024-08-01'),
      endDate: isoDate('2024-08-05'),
    });

    // The a11y skip link puts '#main-content' here in normal use. Reading the
    // fragment inside lib/ once let that overwrite a trip's credential.
    window.location.hash = '#main-content';

    const doc = makeDoc({
      id: trip.id,
      name: 'Renamed',
      startDate: '2024-08-01',
      endDate: '2024-08-05',
    });
    await syncDocToDexie(doc, trip.id);

    expect((await db.trips.get(trip.id))?.name).toBe('Renamed');
    window.location.hash = '';
  });

  it('refuses a doc from a peer on the older array-based schema', async () => {
    const trip = await createTrip({
      name: 'Shared trip',
      startDate: isoDate('2024-07-15'),
      endDate: isoDate('2024-07-20'),
    });
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

    await expect(syncDocToDexie(legacy, trip.id)).resolves.toBeNull();
    expect(await db.persons.where('tripId').equals(trip.id).count()).toBe(1);
  });

  it('ignores a doc with a non-string meta.id instead of rejecting', async () => {
    const doc = makeDoc({ id: { nope: true }, name: 'x' });

    // The caller invokes this as a bare `void`, so a rejection here would be an
    // unhandled rejection on every remote update.
    await expect(
      syncDocToDexie(doc, 'some-trip' as TripId),
    ).resolves.toBeNull();
  });

  it('ignores a doc with no meta.id at all', async () => {
    const doc = makeDoc({ name: 'no id' });

    await expect(
      syncDocToDexie(doc, 'some-trip' as TripId),
    ).resolves.toBeNull();
  });
});
