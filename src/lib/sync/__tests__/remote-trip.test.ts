/**
 * @fileoverview Tests for the trip's server row and its denormalised preview.
 *
 * Two things are covered here, and they fail in the same shape.
 *
 * The local `remoteTripId` is a cached pointer at a row on somebody else's
 * server, and it can be stale for ordinary reasons — the row deleted directly in
 * the dashboard, a project reset, a restore from a backup taken before the trip
 * existed. The failure it produced was not a clean one: sharing reported
 * `new row violates row-level security policy for table "trip_doc_updates"`,
 * because deleting a trip cascades its `trip_members` row away and the insert
 * policy then correctly refuses a non-member.
 *
 * The preview row fails even more quietly. `owners update their trips` narrows
 * the UPDATE to rows this account owns, so on a guest's device it matches
 * nothing — and an UPDATE matching no row succeeds, with no error and no rows.
 * Awaited without looking, that is indistinguishable from having worked, which
 * is how another device came to show a name the trip no longer has.
 *
 * @module lib/sync/__tests__/remote-trip.test
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/lib/db/database';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { readCursor, recordServerState } from '@/lib/sync/cursors';
import {
  ensureRemoteTrip,
  listRemoteTripsMissingLocally,
  syncRemoteTripMetadata,
} from '@/lib/sync/remote-trip';
import { isoDate } from '@/test/utils';
import type { Trip } from '@/types';
import * as Y from 'yjs';

// ============================================================================
// Helpers
// ============================================================================

const REMOTE_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FRESH_ID = 'bbbbbbbb-0000-0000-0000-000000000002';

const TRIP_NAME = 'Brittany';
const TRIP_START = '2026-07-15';
const TRIP_END = '2026-07-22';

interface FakeTripRow {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
}

interface FakeClientOptions {
  /** Rows the caller may write, modelling `owners update their trips`. */
  readonly writable?: boolean;
}

/**
 * A client whose `trips` table holds exactly `rows`.
 *
 * Models the calls this module makes on that table — a lookup by id, a whole
 * table read, an insert returning the new id, and an update asked for its
 * affected rows — closely enough that a change in any of their shapes shows up
 * here rather than passing silently.
 */
function clientWithRows(rows: FakeTripRow[], options: FakeClientOptions = {}) {
  const writable = options.writable ?? true;
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];

  const client = {
    from: () => ({
      select: () => {
        const builder = {
          // `await client.from('trips').select('id, name')` — the whole table.
          then: (resolve: (value: unknown) => unknown) =>
            resolve({ data: rows.map((row) => ({ ...row })), error: null }),
          eq: (_column: string, value: string) => ({
            // The existence check, which also reads the preview back.
            limit: async () => ({
              data: rows.filter((row) => row.id === value).map((row) => ({ ...row })),
              error: null,
            }),
            // The owner_id/local_id recovery lookup chains a second eq().
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
        return builder;
      },
      insert: (values: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            inserts.push(values);
            return { data: { id: FRESH_ID }, error: null };
          },
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: (_column: string, value: string) => ({
          select: async () => {
            const row = rows.find((candidate) => candidate.id === value);
            if (!row || !writable) {
              // What PostgREST answers when RLS leaves no row to write: not an
              // error, and not an update either.
              return { data: [], error: null };
            }
            updates.push(values);
            Object.assign(row, values);
            return { data: [{ id: value }], error: null };
          },
        }),
      }),
    }),
  };

  return { client: client as never, inserts, updates, rows };
}

/** The server row as it looks when it agrees with the local trip. */
function matchingRow(id = REMOTE_ID): FakeTripRow {
  return { id, name: TRIP_NAME, start_date: TRIP_START, end_date: TRIP_END };
}

async function makeSharedTrip(): Promise<Trip> {
  const trip = await createTrip({
    name: TRIP_NAME,
    startDate: isoDate(TRIP_START),
    endDate: isoDate(TRIP_END),
  });
  await db.trips.update(trip.id, { remoteTripId: REMOTE_ID });
  // Sync bookkeeping describing the row that is about to vanish.
  await recordServerState(trip.id, Y.encodeStateVector(new Y.Doc()));
  const updated = await db.trips.get(trip.id);
  if (!updated) {
    throw new Error('unreachable: the trip was just created');
  }
  return updated;
}

beforeEach(async () => {
  await db.trips.clear();
  await db.syncCursors.clear();
});

// ============================================================================
// Tests
// ============================================================================

describe('ensureRemoteTrip', () => {
  it('reuses a server row that is still there', async () => {
    const trip = await makeSharedTrip();

    const { client, inserts } = clientWithRows([matchingRow()]);
    const result = await ensureRemoteTrip(client, 'user-1', trip.id);

    expect(result).toEqual({ status: 'ready', remoteTripId: REMOTE_ID });
    // No second row for a trip that already has one.
    expect(inserts).toHaveLength(0);
  });

  it('leaves a preview that already agrees with the trip alone', async () => {
    const trip = await makeSharedTrip();

    const { client, updates } = clientWithRows([matchingRow()]);
    await ensureRemoteTrip(client, 'user-1', trip.id);

    // The check that answers "is the row still there?" also answers "does it
    // still say the right thing?", so a matching preview costs no write at all.
    expect(updates).toHaveLength(0);
  });

  it('republishes a preview that has drifted from the trip', async () => {
    const trip = await makeSharedTrip();

    // The trip was renamed and its dates moved after it was first uploaded.
    const stale: FakeTripRow = {
      id: REMOTE_ID,
      name: 'Untitled',
      start_date: '2026-01-01',
      end_date: '2026-01-02',
    };
    const { client, updates, rows } = clientWithRows([stale]);

    await ensureRemoteTrip(client, 'user-1', trip.id);

    // Sharing is the moment the preview is about to be somebody's only source,
    // so it is put right first.
    expect(updates).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: TRIP_NAME,
      start_date: TRIP_START,
      end_date: TRIP_END,
    });
  });

  it('creates a new server row when the old one has been deleted', async () => {
    const trip = await makeSharedTrip();

    // The row is gone — deleted in the dashboard, or lost with a project reset.
    const { client, inserts } = clientWithRows([]);
    const result = await ensureRemoteTrip(client, 'user-1', trip.id);

    // Trusting the local pointer here is what produced the RLS refusal: the
    // upload went ahead against a trip whose `trip_members` row had cascaded
    // away, so the insert policy refused a non-member.
    expect(result).toEqual({ status: 'ready', remoteTripId: FRESH_ID });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ local_id: trip.id, owner_id: 'user-1' });
  });

  it('clips an over-long name to what the server will accept', async () => {
    const trip = await createTrip({
      name: TRIP_NAME,
      startDate: isoDate(TRIP_START),
      endDate: isoDate(TRIP_END),
    });
    // Straight into Dexie, because that is the one way an over-long name gets
    // there: the CRDT bridge adopts `meta.name` from a peer's document without
    // the repository's sanitiser, which would otherwise have clipped it.
    await db.trips.update(trip.id, { name: 'x'.repeat(260) });

    const { client, inserts } = clientWithRows([]);
    await ensureRemoteTrip(client, 'user-1', trip.id);

    // `check (length(name) between 1 and 200)`: sending the whole thing fails
    // the constraint, and sharing fails with it. The document still holds the
    // full name; this row is only a preview.
    expect(inserts[0]).toMatchObject({ name: 'x'.repeat(200) });
  });

  it('does not send an empty name for a trip named only in whitespace', async () => {
    const trip = await createTrip({
      name: TRIP_NAME,
      startDate: isoDate(TRIP_START),
      endDate: isoDate(TRIP_END),
    });
    await db.trips.update(trip.id, { name: '   ' });

    const { client, inserts } = clientWithRows([]);
    await ensureRemoteTrip(client, 'user-1', trip.id);

    // `length(name) between 1 and 200` rejects ''. Trimming this to nothing
    // would turn a share that used to work into a constraint error.
    expect(inserts[0]).toMatchObject({ name: '   ' });
  });

  it('relinks the local trip to the new row', async () => {
    const trip = await makeSharedTrip();

    const { client } = clientWithRows([]);
    await ensureRemoteTrip(client, 'user-1', trip.id);

    expect((await db.trips.get(trip.id))?.remoteTripId).toBe(FRESH_ID);
  });

  it('discards the sync bookkeeping that described the deleted row', async () => {
    const trip = await makeSharedTrip();
    expect((await readCursor(trip.id)).serverStateVector).toBeDefined();

    const { client } = clientWithRows([]);
    await ensureRemoteTrip(client, 'user-1', trip.id);

    // Keeping it would leave the provider computing a diff against a server
    // state the new row has never had, so it would push a fragment of the
    // document and call the rest already sent.
    const cursor = await readCursor(trip.id);
    expect(cursor.serverStateVector).toBeUndefined();
    expect(cursor.lastSeenUpdateId).toBe(0);
  });

  it('keeps the existing link when the server cannot be reached', async () => {
    const trip = await makeSharedTrip();

    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            limit: async () => ({ data: null, error: { message: 'offline' } }),
          }),
        }),
      }),
    } as never;

    const result = await ensureRemoteTrip(client, 'user-1', trip.id);

    // "Cannot tell" must not be read as "deleted". Creating a duplicate row on
    // every failed check would be worse than doing nothing.
    expect(result).toEqual({ status: 'ready', remoteTripId: REMOTE_ID });
    expect((await db.trips.get(trip.id))?.remoteTripId).toBe(REMOTE_ID);
  });
});

describe('syncRemoteTripMetadata', () => {
  it('reports an update that landed', async () => {
    const trip = await makeSharedTrip();
    const { client, rows } = clientWithRows([
      { id: REMOTE_ID, name: 'Old name', start_date: TRIP_START, end_date: TRIP_END },
    ]);

    const result = await syncRemoteTripMetadata(client, trip);

    expect(result).toEqual({ status: 'updated' });
    expect(rows[0]?.name).toBe(TRIP_NAME);
  });

  it('reports an update that matched no row instead of calling it a success', async () => {
    const trip = await makeSharedTrip();
    // A guest's device: `owners update their trips` leaves nothing to write.
    const { client } = clientWithRows([matchingRow()], { writable: false });

    const result = await syncRemoteTripMetadata(client, trip);

    // The whole point. Zero rows and no error used to be awaited and dropped,
    // which is how the trip list on another device kept an old name for good.
    expect(result).toEqual({ status: 'not-applied' });
  });

  it('does nothing for a trip that was never shared', async () => {
    const local = await createTrip({
      name: 'Local only',
      startDate: isoDate(TRIP_START),
      endDate: isoDate(TRIP_END),
    });
    const { client, updates } = clientWithRows([matchingRow()]);

    expect(await syncRemoteTripMetadata(client, local)).toEqual({ status: 'skipped' });
    expect(updates).toHaveLength(0);
  });

  it('reports the failure when the request rejects', async () => {
    const trip = await makeSharedTrip();
    const client = {
      from: () => ({
        update: () => ({
          eq: () => ({
            select: async () => {
              throw new Error('offline');
            },
          }),
        }),
      }),
    } as never;

    expect(await syncRemoteTripMetadata(client, trip)).toEqual({
      status: 'error',
      message: 'offline',
    });
  });
});

describe('listRemoteTripsMissingLocally', () => {
  it('returns only the trips this device does not have', async () => {
    await makeSharedTrip();
    const { client } = clientWithRows([
      matchingRow(),
      { id: FRESH_ID, name: 'Alps', start_date: TRIP_START, end_date: TRIP_END },
    ]);

    const missing = await listRemoteTripsMissingLocally(client);

    expect(missing).toEqual([{ id: FRESH_ID, name: 'Alps' }]);
  });

  it('drops a row with no usable id rather than rendering one', async () => {
    const { client } = clientWithRows([
      { id: '', name: 'Nowhere', start_date: TRIP_START, end_date: TRIP_END },
      { id: FRESH_ID, name: 'Alps', start_date: TRIP_START, end_date: TRIP_END },
    ]);

    // Every field here was written by whoever owns the trip, so one unusable
    // row is dropped on its own instead of taking the list down with it.
    expect(await listRemoteTripsMissingLocally(client)).toEqual([
      { id: FRESH_ID, name: 'Alps' },
    ]);
  });

  it('leaves a missing name empty for the UI to translate', async () => {
    const { client } = clientWithRows([
      { id: FRESH_ID, start_date: TRIP_START, end_date: TRIP_END } as FakeTripRow,
    ]);

    // Not 'Shared Trip': inventing an English name in the sync layer puts an
    // untranslated string on screen as if the trip were called that.
    expect(await listRemoteTripsMissingLocally(client)).toEqual([
      { id: FRESH_ID, name: '' },
    ]);
  });

  it('clips an over-long remote name', async () => {
    const { client } = clientWithRows([
      {
        id: FRESH_ID,
        name: 'y'.repeat(400),
        start_date: TRIP_START,
        end_date: TRIP_END,
      },
    ]);

    const missing = await listRemoteTripsMissingLocally(client);

    expect(missing[0]?.name).toHaveLength(200);
  });
});
