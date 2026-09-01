/**
 * @fileoverview Tests for ensureRemoteTrip.
 *
 * The local `remoteTripId` is a cached pointer at a row on somebody else's
 * server, and the cases here are all about it being wrong. It can be stale for
 * ordinary reasons — the row deleted directly in the dashboard, a project reset,
 * a restore from a backup taken before the trip existed — and the failure it
 * produced was not a clean one: sharing reported
 * `new row violates row-level security policy for table "trip_doc_updates"`,
 * because deleting a trip cascades its `trip_members` row away and the insert
 * policy then correctly refuses a non-member.
 *
 * @module lib/sync/__tests__/remote-trip.test
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/lib/db/database';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { readCursor, recordServerState } from '@/lib/sync/cursors';
import { ensureRemoteTrip } from '@/lib/sync/remote-trip';
import { isoDate } from '@/test/utils';
import type { Trip } from '@/types';
import * as Y from 'yjs';

// ============================================================================
// Helpers
// ============================================================================

const REMOTE_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FRESH_ID = 'bbbbbbbb-0000-0000-0000-000000000002';

/**
 * A client whose `trips` table holds exactly `existing`.
 *
 * Models the two calls `ensureRemoteTrip` makes on that table — a lookup by id,
 * and an insert returning the new id — closely enough that a change in either
 * shape shows up here rather than passing silently.
 */
function clientWithTrips(existing: string[]) {
  const inserts: Record<string, unknown>[] = [];

  const client = {
    from: () => ({
      select: () => ({
        eq: (_column: string, value: string) => ({
          // The existence check.
          limit: async () => ({
            data: existing.includes(value) ? [{ id: value }] : [],
            error: null,
          }),
          // The owner_id/local_id recovery lookup chains a second eq().
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
          maybeSingle: async () => ({
            data: existing.includes(value) ? { id: value } : null,
            error: null,
          }),
        }),
      }),
      insert: (values: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            inserts.push(values);
            return { data: { id: FRESH_ID }, error: null };
          },
        }),
      }),
    }),
  };

  return { client: client as never, inserts };
}

async function makeSharedTrip(): Promise<Trip> {
  const trip = await createTrip({
    name: 'Brittany',
    startDate: isoDate('2026-07-15'),
    endDate: isoDate('2026-07-22'),
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

    const { client, inserts } = clientWithTrips([REMOTE_ID]);
    const result = await ensureRemoteTrip(client, 'user-1', trip.id);

    expect(result).toEqual({ status: 'ready', remoteTripId: REMOTE_ID });
    // No second row for a trip that already has one.
    expect(inserts).toHaveLength(0);
  });

  it('creates a new server row when the old one has been deleted', async () => {
    const trip = await makeSharedTrip();

    // The row is gone — deleted in the dashboard, or lost with a project reset.
    const { client, inserts } = clientWithTrips([]);
    const result = await ensureRemoteTrip(client, 'user-1', trip.id);

    // Trusting the local pointer here is what produced the RLS refusal: the
    // upload went ahead against a trip whose `trip_members` row had cascaded
    // away, so the insert policy refused a non-member.
    expect(result).toEqual({ status: 'ready', remoteTripId: FRESH_ID });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ local_id: trip.id, owner_id: 'user-1' });
  });

  it('relinks the local trip to the new row', async () => {
    const trip = await makeSharedTrip();

    const { client } = clientWithTrips([]);
    await ensureRemoteTrip(client, 'user-1', trip.id);

    expect((await db.trips.get(trip.id))?.remoteTripId).toBe(FRESH_ID);
  });

  it('discards the sync bookkeeping that described the deleted row', async () => {
    const trip = await makeSharedTrip();
    expect((await readCursor(trip.id)).serverStateVector).toBeDefined();

    const { client } = clientWithTrips([]);
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
