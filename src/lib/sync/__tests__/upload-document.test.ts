/**
 * @fileoverview Tests for uploadTripDocument.
 *
 * This exists because sync is mounted for the open trip only, so a trip shared
 * from the list while a different trip is open had a server row and an invite
 * with no document behind them. The invitee saw the name and dates — those come
 * from the preview row — and then waited on "Getting the trip…" forever.
 *
 * @module lib/sync/__tests__/upload-document.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { db } from '@/lib/db/database';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { readCursor, recordServerState } from '@/lib/sync/cursors';
import { uploadTripDocument } from '@/lib/sync/upload-document';
import { isoDate } from '@/test/utils';
import type { Person, PersonId, Trip, TripId } from '@/types';

// ============================================================================
// Helpers
// ============================================================================

const REMOTE_TRIP_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

/**
 * A client that records inserts and reports what the server already holds.
 *
 * `serverRows` and `serverSnapshot` describe the state *before* this upload, so a
 * test can express "the server has nothing" independently of what the local
 * cursor claims — which is the whole point of the check they drive.
 */
function clientCapturing(
  options: {
    error?: unknown;
    serverRows?: { id: number }[];
    serverSnapshot?: { through_id: number } | null;
  } = {},
) {
  const { error = null, serverRows = [], serverSnapshot = null } = options;
  const rows: { trip_id: string; update: string }[] = [];

  const insert = vi.fn(async (values: { trip_id: string; update: string }) => {
    if (!error) {
      rows.push(values);
    }
    return { error };
  });

  const client = {
    from: (table: string) => {
      if (table === 'trip_doc_snapshots') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: serverSnapshot, error: null }),
            }),
          }),
        };
      }
      return {
        insert,
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: async () => ({ data: serverRows, error: null }),
            }),
            limit: async () => ({ data: serverRows, error: null }),
          }),
        }),
      };
    },
  };

  return { client: client as never, rows, insert };
}

/** Decodes a captured row back to bytes. */
function bytesOf(row: { update: string }): Uint8Array {
  return Uint8Array.from(atob(row.update), (char) => char.charCodeAt(0));
}

async function makeTrip(name: string): Promise<Trip> {
  return await createTrip({
    name,
    startDate: isoDate('2026-07-15'),
    endDate: isoDate('2026-07-22'),
  });
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

describe('uploadTripDocument', () => {
  it('uploads a trip whose contents live only in Dexie', async () => {
    const trip = await makeTrip('Brittany');
    // Written the ordinary way, through the repositories, before this trip ever
    // had a document — which is every trip created before it was first opened
    // with sync on.
    await db.persons.add({
      id: 'person-1' as PersonId,
      tripId: trip.id,
      name: 'Alice',
      color: '#ff0000' as Person['color'],
    });

    const { client, rows } = clientCapturing();
    const result = await uploadTripDocument(client, trip.id, REMOTE_TRIP_ID);

    expect(result.status).toBe('uploaded');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.trip_id).toBe(REMOTE_TRIP_ID);

    // The guest has to be reconstructible from what was sent, or the invitee
    // gets an empty trip.
    const rebuilt = new Y.Doc();
    Y.applyUpdate(rebuilt, bytesOf(rows[0]!));
    const guests = rebuilt.getMap('guestsById');
    expect(guests.size).toBe(1);
    expect((guests.get('person-1') as Y.Map<unknown>).get('name')).toBe('Alice');
  });

  it('records the server state so a provider starting later sends nothing', async () => {
    const trip = await makeTrip('Brittany');
    await db.persons.add({
      id: 'person-1' as PersonId,
      tripId: trip.id,
      name: 'Alice',
      color: '#ff0000' as Person['color'],
    });

    const { client } = clientCapturing();
    await uploadTripDocument(client, trip.id, REMOTE_TRIP_ID);

    // Without this the provider would re-send the whole document on mount.
    expect((await readCursor(trip.id)).serverStateVector).toBeDefined();
  });

  it('does nothing on a second pass, rather than re-uploading the whole document', async () => {
    const trip = await makeTrip('Brittany');
    await db.persons.add({
      id: 'person-1' as PersonId,
      tripId: trip.id,
      name: 'Alice',
      color: '#ff0000' as Person['color'],
    });

    const first = clientCapturing();
    await uploadTripDocument(first.client, trip.id, REMOTE_TRIP_ID);
    expect(first.rows).toHaveLength(1);

    // Sharing twice, or a provider already running for the same trip. The
    // rebuilt document would carry a new Yjs client id, so every value would be
    // written again as new items — a bigger log, and a chance of resurrecting
    // something another device deleted that this one has not heard about yet.
    const second = clientCapturing({ serverRows: [{ id: 1 }] });
    const result = await uploadTripDocument(second.client, trip.id, REMOTE_TRIP_ID);

    expect(result.status).toBe('already-current');
    expect(second.rows).toHaveLength(0);
  });

  it('uploads a trip with no guests, because its name and dates still matter', async () => {
    const trip = await makeTrip('Empty');

    const { client, rows } = clientCapturing();
    const result = await uploadTripDocument(client, trip.id, REMOTE_TRIP_ID);

    // `populateDocFromDexie` writes the trip's own metadata, and the invitee
    // reads name and dates from the document as well as from the preview row.
    expect(result.status).toBe('uploaded');
    expect(rows).toHaveLength(1);

    const rebuilt = new Y.Doc();
    Y.applyUpdate(rebuilt, bytesOf(rows[0]!));
    expect(rebuilt.getMap('meta').get('name')).toBe('Empty');
  });

  it('does not record server state when the insert failed', async () => {
    const trip = await makeTrip('Brittany');
    await db.persons.add({
      id: 'person-1' as PersonId,
      tripId: trip.id,
      name: 'Alice',
      color: '#ff0000' as Person['color'],
    });

    const { client } = clientCapturing({ error: { message: 'log write failed' } });
    const result = await uploadTripDocument(client, trip.id, REMOTE_TRIP_ID);

    expect(result).toEqual({ status: 'error', message: 'log write failed' });
    // Recording it would mean this document is never offered again, which is the
    // exact shape of the bug this module exists to fix.
    expect((await readCursor(trip.id)).serverStateVector).toBeUndefined();
  });

  it('leaves a trip alone once a provider has recorded server state for it', async () => {
    const trip = await makeTrip('Brittany');
    await db.persons.add({
      id: 'person-2' as PersonId,
      tripId: trip.id,
      name: 'Bob',
      color: '#00ff00' as Person['color'],
    });

    // A provider has been running for this trip and pushed at some point, and
    // the server can show for it.
    await recordServerState(trip.id, Y.encodeStateVector(new Y.Doc()));

    const { client, rows } = clientCapturing({ serverRows: [{ id: 1 }] });
    const result = await uploadTripDocument(client, trip.id, REMOTE_TRIP_ID);

    // From here the ordinary path owns it: an edit can only be made from inside
    // a trip, which makes it the open one, so the provider is mounted for every
    // change after the first upload.
    expect(result.status).toBe('already-current');
    expect(rows).toHaveLength(0);
  });

  it('uploads anyway when the server is empty but the cursor claims otherwise', async () => {
    const trip = await makeTrip('Brittany');
    await db.persons.add({
      id: 'person-1' as PersonId,
      tripId: trip.id,
      name: 'Alice',
      color: '#ff0000' as Person['color'],
    });

    // The state that strands a trip: this device believes it has already
    // uploaded — a provider recorded a vector at some point, quite possibly for
    // an empty document before the trip's contents were populated into it — while
    // the server holds nothing at all.
    await recordServerState(trip.id, Y.encodeStateVector(new Y.Doc()));

    // Nothing on the server: no log rows, no snapshot.
    const { client, rows } = clientCapturing({ serverRows: [], serverSnapshot: null });
    const result = await uploadTripDocument(client, trip.id, REMOTE_TRIP_ID);

    // Trusting the local record here is what makes the trip permanently broken:
    // the invitee waits on "Getting the trip…" and re-sharing cannot repair it,
    // because every later attempt short-circuits on the same stale claim.
    expect(result.status).toBe('uploaded');
    expect(rows).toHaveLength(1);

    const rebuilt = new Y.Doc();
    Y.applyUpdate(rebuilt, bytesOf(rows[0]!));
    expect((rebuilt.getMap('guestsById').get('person-1') as Y.Map<unknown>).get('name')).toBe(
      'Alice',
    );
  });

  it('reports an error rather than throwing when the trip is gone', async () => {
    const result = await uploadTripDocument(
      clientCapturing().client,
      'no-such-trip' as TripId,
      REMOTE_TRIP_ID,
    );

    // Nothing to upload is not a crash; the share dialog has to render something.
    expect(['already-current', 'error']).toContain(result.status);
  });
});
