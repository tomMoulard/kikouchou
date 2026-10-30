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
    rowsError?: { message: string } | null;
    snapshotError?: { message: string } | null;
    throwOnRead?: boolean;
    insertThrows?: unknown;
  } = {},
) {
  const {
    error = null,
    serverRows = [],
    serverSnapshot = null,
    rowsError = null,
    snapshotError = null,
    throwOnRead = false,
    insertThrows,
  } = options;
  const rows: { trip_id: string; update: string }[] = [];
  /** Every read, as `table.select(columns).eq(column, value)`. */
  const reads: string[] = [];

  const insert = vi.fn(async (values: { trip_id: string; update: string }) => {
    if (insertThrows !== undefined) {
      throw insertThrows;
    }
    if (!error) {
      rows.push(values);
    }
    return { error };
  });

  const client = {
    from: (table: string) => {
      if (throwOnRead) {
        throw new Error('network down');
      }
      if (table === 'trip_doc_snapshots') {
        return {
          select: (columns: string) => ({
            eq: (column: string, value: string) => {
              reads.push(`${table}.select(${columns}).eq(${column}, ${value})`);
              return {
                maybeSingle: async () => ({ data: serverSnapshot, error: snapshotError }),
              };
            },
          }),
        };
      }
      return {
        insert,
        select: (columns: string) => ({
          eq: (column: string, value: string) => {
            reads.push(`${table}.select(${columns}).eq(${column}, ${value})`);
            return {
              limit: async () => ({ data: serverRows, error: rowsError }),
            };
          },
        }),
      };
    },
  };

  return { client: client as never, rows, insert, reads };
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

  it('does not ask the server when this device never recorded an upload', async () => {
    const trip = await makeTrip('Brittany');

    // Rows on the server would make a check say "already there"; with no
    // recorded vector there is nothing to check, so the document goes up.
    const { client, rows, reads } = clientCapturing({ serverRows: [{ id: 1 }] });
    const result = await uploadTripDocument(client, trip.id, REMOTE_TRIP_ID);

    expect(result.status).toBe('uploaded');
    expect(rows).toHaveLength(1);
    expect(reads).toEqual([]);
  });

  it('asks the log for this trip, then the snapshot, before deciding', async () => {
    const trip = await makeTrip('Brittany');
    await recordServerState(trip.id, Y.encodeStateVector(new Y.Doc()));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { client, reads } = clientCapturing();
    await uploadTripDocument(client, trip.id, REMOTE_TRIP_ID);

    expect(reads).toEqual([
      `trip_doc_updates.select(id).eq(trip_id, ${REMOTE_TRIP_ID})`,
      `trip_doc_snapshots.select(through_id).eq(trip_id, ${REMOTE_TRIP_ID})`,
    ]);
    // A clear "the server has nothing" is an answer, not a failure to ask.
    expect(warn).not.toHaveBeenCalled();
  });

  it('leaves a fully compacted trip alone: a snapshot and an empty log', async () => {
    const trip = await makeTrip('Brittany');
    await recordServerState(trip.id, Y.encodeStateVector(new Y.Doc()));

    const { client, rows } = clientCapturing({
      serverRows: [],
      serverSnapshot: { through_id: 40 },
    });
    const result = await uploadTripDocument(client, trip.id, REMOTE_TRIP_ID);

    expect(result.status).toBe('already-current');
    expect(rows).toHaveLength(0);
  });

  it.each([
    ['the log read fails', { rowsError: { message: 'denied' } }],
    ['the snapshot read fails', { snapshotError: { message: 'denied' } }],
  ])('uploads, with a warning, when %s', async (_label, failure) => {
    const trip = await makeTrip('Brittany');
    await recordServerState(trip.id, Y.encodeStateVector(new Y.Doc()));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Rows and a snapshot exist, so a check that wrongly answered would skip
    // the upload.
    const { client, insert } = clientCapturing({
      serverRows: 'rowsError' in failure ? [{ id: 1 }] : [],
      serverSnapshot: { through_id: 40 },
      ...failure,
    });
    const result = await uploadTripDocument(client, trip.id, REMOTE_TRIP_ID);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not read'));
    expect(result.status).toBe('uploaded');
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('treats a check that throws as unanswered, not as an answer', async () => {
    const trip = await makeTrip('Brittany');
    await recordServerState(trip.id, Y.encodeStateVector(new Y.Doc()));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { client } = clientCapturing({ throwOnRead: true });
    const result = await uploadTripDocument(client, trip.id, REMOTE_TRIP_ID);

    // The check swallowed its throw and said "could not tell"; the insert's
    // own `from` then threw too, and that is reported rather than thrown.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not read'));
    expect(result).toEqual({ status: 'error', message: 'network down' });
  });

  it('reports a thrown error by its message and does not record server state', async () => {
    const trip = await makeTrip('Brittany');
    const { client } = clientCapturing({ insertThrows: new Error('socket closed') });

    const result = await uploadTripDocument(client, trip.id, REMOTE_TRIP_ID);

    expect(result).toEqual({ status: 'error', message: 'socket closed' });
    expect((await readCursor(trip.id)).serverStateVector).toBeUndefined();
  });

  it('reports a thrown non-Error as text', async () => {
    const trip = await makeTrip('Brittany');
    const { client } = clientCapturing({ insertThrows: 'plain failure' });

    const result = await uploadTripDocument(client, trip.id, REMOTE_TRIP_ID);

    expect(result).toEqual({ status: 'error', message: 'plain failure' });
  });

  it('destroys the document it built, whatever the outcome', async () => {
    const trip = await makeTrip('Brittany');
    const destroy = vi.spyOn(Y.Doc.prototype, 'destroy');

    await uploadTripDocument(clientCapturing().client, trip.id, REMOTE_TRIP_ID);
    expect(destroy).toHaveBeenCalledTimes(1);

    await uploadTripDocument(
      clientCapturing({ insertThrows: new Error('x') }).client,
      trip.id,
      REMOTE_TRIP_ID,
    );
    expect(destroy).toHaveBeenCalledTimes(2);
  });

  it('records an empty document as current without inserting anything', async () => {
    const { client, insert } = clientCapturing();

    const result = await uploadTripDocument(client, 'no-such-trip' as TripId, REMOTE_TRIP_ID);

    expect(result.status).toBe('already-current');
    expect(insert).not.toHaveBeenCalled();
    expect((await readCursor('no-such-trip' as TripId)).serverStateVector).toBeDefined();
  });
});
