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
import { MAX_LENGTHS } from '@/lib/db/sanitize';
import { syncDocToDexie } from '@/lib/yjs/dexie-bridge';
import { DOC_SCHEMA_VERSION, upsertDocEntity } from '@/lib/yjs/doc-model';
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

  it('projects a joined trip, whose document was created on another device', async () => {
    // The heart of it: local trip ids are per-device nanoids. When an invitee
    // joins, `materialiseJoinedTrip` mints a *new* local id, so the document —
    // authored by the owner — carries the owner's id and can never equal it.
    const joined = await createTrip({
      name: 'Placeholder from the invite',
      startDate: isoDate('2026-07-15'),
      endDate: isoDate('2026-07-22'),
    });

    const fromOwner = makeDoc({
      // The owner's local id. Not this device's, and there is no way for it to
      // be: the two devices never agreed on one.
      id: 'owners-local-trip-id',
      name: 'Brittany',
      startDate: '2026-07-15',
      endDate: '2026-07-22',
    });

    const result = await syncDocToDexie(fromOwner, joined.id);

    // Refusing here is what left an invitee looking at an empty trip. Worse, it
    // was a race: this device also writes `meta.id` when it populates the
    // document from Dexie, so the two ids fight over one key by last-writer-wins
    // and whichever device loses silently stops projecting anything.
    expect(result).toBe(joined.id);
    expect((await db.trips.get(joined.id))?.name).toBe('Brittany');
  });

  it('writes only to the trip the caller named, whatever the document claims', async () => {
    const victim = await createTrip({
      name: 'My private trip',
      startDate: isoDate('2024-07-15'),
      endDate: isoDate('2024-07-20'),
    });
    const bound = await createTrip({
      name: 'Shared trip',
      startDate: isoDate('2024-08-01'),
      endDate: isoDate('2024-08-05'),
    });

    const hostile = makeDoc({
      id: victim.id,
      name: 'Pwned',
      startDate: '2024-07-15',
      endDate: '2024-07-20',
    });

    await syncDocToDexie(hostile, bound.id);

    // The property that matters, and the one the old comparison was really
    // protecting: `meta.id` is never an address. The write key is the trip the
    // caller resolved locally, so a claim about another trip reaches nothing.
    expect((await db.trips.get(victim.id))?.name).toBe('My private trip');
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

// ============================================================================
// Field-level trust boundary
// ============================================================================

/**
 * `meta` is peer-controlled and typed `unknown`, so every field read out of it
 * is remote input. These pin the ways the trip record used to take a peer at
 * its word.
 */
describe('buildTripRecord — remote field validation', () => {
  const makeTrip = () =>
    createTrip({
      name: 'Brittany',
      startDate: isoDate('2024-08-01'),
      endDate: isoDate('2024-08-05'),
    });

  it('ignores a name that is not a string', async () => {
    const trip = await makeTrip();

    // `db.trips.name` is typed `string` everywhere downstream. A number stored
    // here reached `previewName()`, which called `.trim()` on it and took the
    // share dialog down with a TypeError.
    await syncDocToDexie(makeDoc({ name: 42 }), trip.id);

    const stored = await db.trips.get(trip.id);
    expect(typeof stored?.name).toBe('string');
    expect(stored?.name).toBe('Brittany');
  });

  it('ignores an empty name rather than blanking the trip', async () => {
    const trip = await makeTrip();

    // `??` only catches null and undefined, so '' was stored verbatim and every
    // screen rendered the trip as a nameless card.
    await syncDocToDexie(makeDoc({ name: '   ' }), trip.id);

    expect((await db.trips.get(trip.id))?.name).toBe('Brittany');
  });

  it('keeps a name the server allows but the local form does not', async () => {
    const trip = await makeTrip();
    const serverLengthName = 'n'.repeat(150);

    // Between the client's 100 and the server's 200: legitimate, not hostile.
    // Clipping it here would push the shortened name back into the document and
    // rename the trip for the owner who chose it.
    await syncDocToDexie(makeDoc({ name: serverLengthName }), trip.id);

    expect((await db.trips.get(trip.id))?.name).toBe(serverLengthName);
  });

  it('bounds a description a peer never bounded', async () => {
    const trip = await makeTrip();

    // Every local writer caps this at MAX_LENGTHS.tripDescription, so a longer
    // one came from a peer that did not — and `populateDocFromDexie` would push
    // it straight back out for every other device to download.
    await syncDocToDexie(makeDoc({ description: 'D'.repeat(50_000) }), trip.id);

    expect((await db.trips.get(trip.id))?.description).toHaveLength(
      MAX_LENGTHS.tripDescription,
    );
  });

  it('bounds a location a peer never bounded', async () => {
    const trip = await makeTrip();

    await syncDocToDexie(makeDoc({ location: 'L'.repeat(50_000) }), trip.id);

    expect((await db.trips.get(trip.id))?.location).toHaveLength(
      MAX_LENGTHS.tripLocation,
    );
  });

  it('bounds a guest phone a peer never bounded', async () => {
    const trip = await makeTrip();
    const doc = makeDoc({});
    upsertDocEntity(doc, 'guests', {
      id: 'guest-1',
      name: 'Mary',
      color: '#3b82f6',
      phone: '9'.repeat(50_000),
    });

    await syncDocToDexie(doc, trip.id);

    // Every local writer caps this at MAX_LENGTHS.personPhone, so a longer one
    // came from a member whose client did not — and the guest card renders it.
    const stored = await db.persons.get('guest-1' as Person['id']);
    expect(stored?.phone).toHaveLength(MAX_LENGTHS.personPhone);
  });

  it('drops a whitespace-only guest phone rather than storing a blank', async () => {
    const trip = await makeTrip();
    const doc = makeDoc({});
    upsertDocEntity(doc, 'guests', {
      id: 'guest-2',
      name: 'Mary',
      color: '#3b82f6',
      phone: '   ',
    });

    await syncDocToDexie(doc, trip.id);

    // A blank string would render an empty `tel:` link on the guest card.
    const stored = await db.persons.get('guest-2' as Person['id']);
    expect(stored?.phone).toBeUndefined();
  });

  it('keeps an ordinary guest phone untouched', async () => {
    const trip = await makeTrip();
    const doc = makeDoc({});
    upsertDocEntity(doc, 'guests', {
      id: 'guest-3',
      name: 'Mary',
      color: '#3b82f6',
      phone: '+33 6 12 34 56 78',
    });

    await syncDocToDexie(doc, trip.id);

    const stored = await db.persons.get('guest-3' as Person['id']);
    expect(stored?.phone).toBe('+33 6 12 34 56 78');
  });

  it('ignores a description that is not a string', async () => {
    const trip = await makeTrip();

    await syncDocToDexie(makeDoc({ description: { nope: true } }), trip.id);

    expect((await db.trips.get(trip.id))?.description).toBeUndefined();
  });
});
