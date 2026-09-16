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

import { beforeEach, describe, expect, it } from 'vitest';
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

interface LogRow {
  readonly id: number;
  readonly trip_id: string;
  readonly update: string;
}

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
  readonly rows: LogRow[] = [];
  snapshot: { state: string; through_id: number } | null = null;
  logError: unknown = null;

  addUpdate(tripId: string, bytes: Uint8Array): void {
    this.rows.push({ id: this.rows.length + 1, trip_id: tripId, update: encode(bytes) });
  }

  get client(): never {
    return {
      from: (table: string) => {
        if (table === 'trip_doc_snapshots') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: this.snapshot, error: null }),
              }),
            }),
          };
        }

        // trip_doc_updates
        return {
          select: () => ({
            eq: (_column: string, tripId: unknown) => ({
              gt: (_idColumn: string, afterId: number) => ({
                order: () => ({
                  limit: async (count: number) => {
                    if (this.logError) {
                      return { data: null, error: this.logError };
                    }
                    const data = this.rows
                      .filter((row) => row.trip_id === tripId && row.id > afterId)
                      .sort((left, right) => left.id - right.id)
                      .slice(0, count);
                    return { data, error: null };
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
});
