/**
 * @fileoverview Tests for downloadTripDocument.
 *
 * This exists because signing in on a second device materialised a *placeholder*
 * trip row — the server's name and dates and nothing else — and left the trip's
 * real contents on the server until somebody opened the trip. The trip list
 * showed a card with no guests, no place and no map, and the only way to repair
 * it was to open every trip in turn.
 *
 * So the assertions are about the contents, not about the call: what matters is
 * that `db.persons` and `db.trips.location` hold the owner's data once this
 * returns, because those are what the card reads.
 *
 * @module lib/sync/__tests__/download-document.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { db } from '@/lib/db/database';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { readCursor } from '@/lib/sync/cursors';
import { downloadTripDocument } from '@/lib/sync/download-document';
import { populateDocFromDexie } from '@/lib/yjs/dexie-bridge';
import { isoDate } from '@/test/utils';
import type { Person, PersonId, Trip, TripId } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

const REMOTE_TRIP_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

/** Base64, the way the codec writes it into the log column. */
function encode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * The log and the snapshot table, filtered the way PostgREST filters them.
 *
 * Small enough to read, and it models the two things the pull actually depends
 * on: `gt('id', cursor)` and ascending order.
 */
class FakeServer {
  readonly rows: { id: unknown; trip_id: string; update: unknown }[] = [];
  snapshot: { state: unknown; through_id: unknown } | null = null;
  logError: unknown = null;
  snapshotError: unknown = null;
  /** Hands the log back in insertion order, as a server bug might. */
  unsorted = false;
  /** Every query, as the chain of calls it was built from. */
  readonly reads: string[] = [];

  addUpdate(tripId: string, bytes: Uint8Array): void {
    this.rows.push({ id: this.rows.length + 1, trip_id: tripId, update: encode(bytes) });
  }

  get client(): never {
    return {
      from: (table: string) => {
        if (table === 'trip_doc_snapshots') {
          return {
            select: (columns: string) => ({
              eq: (column: string, value: unknown) => ({
                maybeSingle: async () => {
                  this.reads.push(`${table}.select(${columns}).eq(${column}, ${String(value)})`);
                  return { data: this.snapshot, error: this.snapshotError };
                },
              }),
            }),
          };
        }

        // trip_doc_updates
        return {
          select: (columns: string) => ({
            eq: (column: string, tripId: unknown) => ({
              gt: (idColumn: string, afterId: number) => ({
                order: (orderColumn: string, orderOptions: unknown) => ({
                  limit: async (count: number) => {
                    this.reads.push(
                      `${table}.select(${columns}).eq(${column}, ${String(tripId)})` +
                        `.gt(${idColumn}, ${JSON.stringify(afterId)})` +
                        `.order(${orderColumn}, ${JSON.stringify(orderOptions)}).limit(${count})`,
                    );
                    if (this.logError) {
                      return { data: null, error: this.logError };
                    }
                    const matching = this.rows.filter(
                      (row) => row.trip_id === tripId && Number(row.id) > afterId,
                    );
                    const data = this.unsorted
                      ? matching
                      : [...matching].sort((left, right) => Number(left.id) - Number(right.id));
                    return { data: data.slice(0, count), error: null };
                  },
                }),
              }),
            }),
          }),
        };
      },
    } as never;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * The owner's document, built the way the owner's device builds it.
 *
 * Going through `populateDocFromDexie` rather than writing Yjs maps by hand
 * keeps the fixture honest: if the document shape changes, this changes with it
 * instead of testing a shape nothing writes any more.
 */
async function ownerDocument(): Promise<Uint8Array> {
  const owner = await createTrip({
    name: 'Corsica',
    startDate: isoDate('2026-08-01'),
    endDate: isoDate('2026-08-08'),
    location: 'Ajaccio',
  });
  await db.trips.update(owner.id, { coordinates: { lat: 41.92, lon: 8.73 } });
  await db.persons.add({
    id: 'person-1' as PersonId,
    tripId: owner.id,
    name: 'Alice',
    color: '#ff0000' as Person['color'],
  });

  const doc = new Y.Doc();
  try {
    await populateDocFromDexie(doc, owner.id);
    const state = Y.encodeStateAsUpdate(doc);
    // The owner's trip is the fixture, not a trip on this device: everything
    // below has to come off the wire.
    await db.persons.where('tripId').equals(owner.id).delete();
    await db.trips.delete(owner.id);
    return state;
  } finally {
    doc.destroy();
  }
}

/** The placeholder row `materialiseJoinedTrip` leaves behind. */
async function placeholderTrip(): Promise<Trip> {
  const trip = await createTrip({
    name: 'Corsica',
    startDate: isoDate('2026-08-01'),
    endDate: isoDate('2026-08-08'),
  });
  await db.trips.update(trip.id, { remoteTripId: REMOTE_TRIP_ID });
  return (await db.trips.get(trip.id)) as Trip;
}

beforeEach(async () => {
  await db.trips.clear();
  await db.persons.clear();
  await db.syncCursors.clear();
  await db.yjsUpdates.clear();
});

// ============================================================================
// Tests
// ============================================================================

describe('downloadTripDocument', () => {
  it('fills a placeholder trip with the guests, place and map the card needs', async () => {
    const server = new FakeServer();
    server.addUpdate(REMOTE_TRIP_ID, await ownerDocument());
    const trip = await placeholderTrip();

    const result = await downloadTripDocument(server.client, trip.id, REMOTE_TRIP_ID);

    expect(result.status).toBe('hydrated');

    const guests = await db.persons.where('tripId').equals(trip.id).toArray();
    expect(guests.map((guest) => guest.name)).toEqual(['Alice']);

    const stored = await db.trips.get(trip.id);
    expect(stored?.location).toBe('Ajaccio');
    expect(stored?.coordinates).toEqual({ lat: 41.92, lon: 8.73 });
  });

  it('reads the snapshot as well as the log', async () => {
    // A trip compacted before this device ever saw it has an empty log and all
    // of its state in the snapshot, so a download that only pages the log gets
    // nothing at all.
    const server = new FakeServer();
    server.snapshot = { state: encode(await ownerDocument()), through_id: 7 };
    const trip = await placeholderTrip();

    const result = await downloadTripDocument(server.client, trip.id, REMOTE_TRIP_ID);

    expect(result.status).toBe('hydrated');
    expect(await db.persons.where('tripId').equals(trip.id).count()).toBe(1);
    // The snapshot's own marker, so the provider resumes after it rather than
    // replaying rows the snapshot already folded in.
    expect((await readCursor(trip.id)).lastSeenUpdateId).toBe(7);
  });

  it('leaves a cursor the sync provider can resume from', async () => {
    const server = new FakeServer();
    server.addUpdate(REMOTE_TRIP_ID, await ownerDocument());
    const trip = await placeholderTrip();

    await downloadTripDocument(server.client, trip.id, REMOTE_TRIP_ID);

    const cursor = await readCursor(trip.id);
    expect(cursor.lastSeenUpdateId).toBe(1);
    // Recorded, so the provider does not re-send the whole document back to the
    // server as fresh CRDT items the first time the trip is opened.
    // Length rather than `toBeInstanceOf`: the round trip through IndexedDB
    // hands back a Uint8Array from the store's own realm.
    expect(cursor.serverStateVector?.length).toBeGreaterThan(0);
  });

  it('persists the document so the trip works offline before it is opened', async () => {
    const server = new FakeServer();
    server.addUpdate(REMOTE_TRIP_ID, await ownerDocument());
    const trip = await placeholderTrip();

    await downloadTripDocument(server.client, trip.id, REMOTE_TRIP_ID);

    expect(await db.yjsUpdates.where('tripId').equals(trip.id).count()).toBeGreaterThan(0);
  });

  it('ignores a trip whose document this device already has', async () => {
    // The guard that keeps this the mirror of `uploadTripDocument`: it only ever
    // runs for a trip with nothing local to lose, so it never has to decide
    // whose version of a value wins.
    const server = new FakeServer();
    server.addUpdate(REMOTE_TRIP_ID, await ownerDocument());
    const trip = await placeholderTrip();
    await db.yjsUpdates.add({ tripId: trip.id, update: new Uint8Array([0]) });

    const result = await downloadTripDocument(server.client, trip.id, REMOTE_TRIP_ID);

    expect(result.status).toBe('skipped');
    expect(await db.persons.where('tripId').equals(trip.id).count()).toBe(0);
  });

  it('reports an empty server document rather than blanking the trip', async () => {
    // The owner shared a row and never uploaded a document. The placeholder name
    // and dates are all there is, and they must survive.
    const server = new FakeServer();
    const trip = await placeholderTrip();

    const result = await downloadTripDocument(server.client, trip.id, REMOTE_TRIP_ID);

    expect(result.status).toBe('empty');
    expect((await db.trips.get(trip.id))?.name).toBe('Corsica');
  });

  it('reports a failed read instead of claiming the trip is empty', async () => {
    const server = new FakeServer();
    server.logError = { message: 'network' };
    const trip = await placeholderTrip();

    const result = await downloadTripDocument(server.client, trip.id, REMOTE_TRIP_ID);

    expect(result.status).toBe('error');
    // Nothing recorded, so the next sweep tries the whole log again.
    expect((await readCursor(trip.id)).lastSeenUpdateId).toBe(0);
  });

  it('does not create a trip that is not on this device', async () => {
    const server = new FakeServer();
    server.addUpdate(REMOTE_TRIP_ID, await ownerDocument());

    const result = await downloadTripDocument(
      server.client,
      'no-such-trip' as TripId,
      REMOTE_TRIP_ID,
    );

    expect(result.status).toBe('error');
    expect(await db.trips.count()).toBe(0);
  });

  it('names the missing trip when there is nothing to project into', async () => {
    const server = new FakeServer();
    server.addUpdate(REMOTE_TRIP_ID, await ownerDocument());

    const result = await downloadTripDocument(
      server.client,
      'no-such-trip' as TripId,
      REMOTE_TRIP_ID,
    );

    expect(result).toEqual({
      status: 'error',
      message: 'no local trip no-such-trip to project into',
    });
  });

  it('asks for the snapshot, then the log after it, for this trip only', async () => {
    const server = new FakeServer();
    server.snapshot = { state: encode(await ownerDocument()), through_id: 7 };
    const trip = await placeholderTrip();

    await downloadTripDocument(server.client, trip.id, REMOTE_TRIP_ID);

    expect(server.reads).toEqual([
      `trip_doc_snapshots.select(state, through_id).eq(trip_id, ${REMOTE_TRIP_ID})`,
      `trip_doc_updates.select(id, update).eq(trip_id, ${REMOTE_TRIP_ID})` +
        '.gt(id, 7).order(id, {"ascending":true}).limit(500)',
    ]);
  });

  it.each([
    ['a negative marker', -3],
    ['a marker that is not a number', '7'],
  ])('reads the whole log when the snapshot carries %s', async (_label, throughId) => {
    const server = new FakeServer();
    server.snapshot = { state: encode(await ownerDocument()), through_id: throughId };
    const trip = await placeholderTrip();

    const result = await downloadTripDocument(server.client, trip.id, REMOTE_TRIP_ID);

    expect(result.status).toBe('hydrated');
    expect(server.reads[1]).toContain('.gt(id, 0)');
  });

  it('reports a failed snapshot read by its message', async () => {
    const server = new FakeServer();
    server.snapshotError = { message: 'denied' };
    server.addUpdate(REMOTE_TRIP_ID, await ownerDocument());
    const trip = await placeholderTrip();

    const result = await downloadTripDocument(server.client, trip.id, REMOTE_TRIP_ID);

    expect(result).toEqual({ status: 'error', message: 'snapshot read failed: denied' });
    expect(await db.persons.where('tripId').equals(trip.id).count()).toBe(0);
  });

  it('reports a failed log read by its message', async () => {
    const server = new FakeServer();
    server.logError = { message: 'network' };
    const trip = await placeholderTrip();

    const result = await downloadTripDocument(server.client, trip.id, REMOTE_TRIP_ID);

    expect(result).toEqual({ status: 'error', message: 'log read failed: network' });
  });

  it('falls back to the log when the snapshot does not decode', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const server = new FakeServer();
    server.snapshot = { state: 'not base64!!', through_id: 40 };
    server.addUpdate(REMOTE_TRIP_ID, await ownerDocument());
    const trip = await placeholderTrip();

    const result = await downloadTripDocument(server.client, trip.id, REMOTE_TRIP_ID);

    expect(result.status).toBe('hydrated');
    // From the start of the log, not from the snapshot's marker.
    expect(server.reads[1]).toContain('.gt(id, 0)');
    expect(await db.persons.where('tripId').equals(trip.id).count()).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('did not decode'),
      REMOTE_TRIP_ID,
    );
  });

  it('drops an unreadable or broken log row and keeps the rest of the page', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const server = new FakeServer();
    server.rows.push({ id: 1, trip_id: REMOTE_TRIP_ID, update: 'not base64!!' });
    // Valid base64 that is not a Yjs update, so applying it throws.
    server.rows.push({ id: 2, trip_id: REMOTE_TRIP_ID, update: encode(new Uint8Array([255, 255, 255, 255])) });
    server.rows.push({ id: 3, trip_id: REMOTE_TRIP_ID, update: encode(await ownerDocument()) });
    const trip = await placeholderTrip();

    const result = await downloadTripDocument(server.client, trip.id, REMOTE_TRIP_ID);

    expect(result.status).toBe('hydrated');
    expect(await db.persons.where('tripId').equals(trip.id).count()).toBe(1);
    expect((await readCursor(trip.id)).lastSeenUpdateId).toBe(3);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('skipping undecodable'), 1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('did not apply'),
      2,
      expect.anything(),
    );
  });

  it('advances the cursor to the highest numeric row id, whatever order the rows came in', async () => {
    const server = new FakeServer();
    server.unsorted = true;
    const owner = await ownerDocument();
    server.rows.push({ id: 5, trip_id: REMOTE_TRIP_ID, update: encode(owner) });
    server.rows.push({ id: 3, trip_id: REMOTE_TRIP_ID, update: encode(owner) });
    // A row id that is not a number must never become the cursor.
    server.rows.push({ id: '9', trip_id: REMOTE_TRIP_ID, update: encode(owner) });
    const trip = await placeholderTrip();

    await downloadTripDocument(server.client, trip.id, REMOTE_TRIP_ID);

    expect((await readCursor(trip.id)).lastSeenUpdateId).toBe(5);
  });

  it('reads the page after a full one', async () => {
    const server = new FakeServer();
    const owner = await ownerDocument();
    // A full page of rows the document already holds, then one more.
    for (let index = 0; index < 501; index += 1) {
      server.addUpdate(REMOTE_TRIP_ID, owner);
    }
    const trip = await placeholderTrip();

    await downloadTripDocument(server.client, trip.id, REMOTE_TRIP_ID);

    expect(server.reads.filter((read) => read.startsWith('trip_doc_updates'))).toHaveLength(2);
    expect((await readCursor(trip.id)).lastSeenUpdateId).toBe(501);
  });

  it('destroys the document it built', async () => {
    const server = new FakeServer();
    server.addUpdate(REMOTE_TRIP_ID, await ownerDocument());
    const trip = await placeholderTrip();
    const destroy = vi.spyOn(Y.Doc.prototype, 'destroy');

    await downloadTripDocument(server.client, trip.id, REMOTE_TRIP_ID);

    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
