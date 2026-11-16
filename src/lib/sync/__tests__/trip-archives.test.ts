/**
 * @fileoverview Tests for the per-account archive sync.
 *
 * @module lib/sync/__tests__/trip-archives.test
 */

import { describe, expect, it } from 'vitest';

import { db } from '@/lib/db/database';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { canSyncTripArchive, syncTripArchives } from '@/lib/sync/trip-archives';
import type { Trip, TripId, UnixTimestamp } from '@/types';

// ============================================================================
// Fakes
// ============================================================================

const USER_ID = 'user-1';

const T1 = Date.parse('2026-11-01T10:00:00.000Z') as UnixTimestamp;
const T2 = Date.parse('2026-11-02T10:00:00.000Z') as UnixTimestamp;

interface FakeRow {
  user_id?: string;
  trip_id: unknown;
  archived: unknown;
  updated_at: unknown;
}

interface FakeClient {
  readonly client: never;
  readonly rows: FakeRow[];
  readonly upserted: Record<string, unknown>[];
  readonly selects: number;
}

/**
 * A client that answers the two calls the sync makes: one select filtered on
 * the account, and one upsert per trip.
 */
function fakeClient(
  initialRows: FakeRow[] = [],
  options: {
    readonly selectError?: string;
    /** The PostgREST code that goes with `selectError`. */
    readonly selectErrorCode?: string;
    /** Refuses the upsert of these remote trip ids. */
    readonly refuse?: Readonly<Record<string, string>>;
    /** Runs between the select and the answer, to model a tap mid-pass. */
    readonly beforeSelectAnswer?: () => Promise<void>;
  } = {},
): FakeClient {
  const rows = [...initialRows],
    upserted: Record<string, unknown>[] = [];
  let selects = 0;

  const client = {
    from: (table: string) => {
      expect(table).toBe('trip_archives');
      return {
        select: (columns: string) => ({
          eq: async (column: string, value: string) => {
            expect(columns).toBe('trip_id, archived, updated_at');
            expect(column).toBe('user_id');
            expect(value).toBe(USER_ID);
            selects += 1;
            await options.beforeSelectAnswer?.();
            if (options.selectError) {
              return {
                data: null,
                error: { message: options.selectError, code: options.selectErrorCode },
              };
            }
            return { data: rows, error: null };
          },
        }),
        upsert: async (payload: Record<string, unknown>, opts: { onConflict: string }) => {
          expect(opts.onConflict).toBe('user_id,trip_id');
          const refusal = options.refuse?.[payload.trip_id as string];
          if (refusal) {
            return { data: null, error: { message: refusal } };
          }
          upserted.push(payload);
          return { data: null, error: null };
        },
      };
    },
  };

  return {
    client: client as never,
    rows,
    upserted,
    get selects() {
      return selects;
    },
  };
}

/** A local trip that has a server row, with the given archive state. */
async function memberTrip(
  remoteTripId: string,
  patch: Partial<Pick<Trip, 'archived' | 'archivedUpdatedAt' | 'viewerToken'>> = {},
): Promise<TripId> {
  const trip = await createTrip({ name: `Trip ${remoteTripId}` });
  await db.trips.update(trip.id, { remoteTripId, ...patch });
  return trip.id;
}

// ============================================================================
// Tests
// ============================================================================

describe('canSyncTripArchive', () => {
  it('accepts a member trip and refuses a local or a viewer trip', async () => {
    const member = await db.trips.get(await memberTrip('r1'));
    const viewer = await db.trips.get(await memberTrip('r2', { viewerToken: 'tok' }));
    const local = await createTrip({ name: 'Local' });

    expect(canSyncTripArchive(member as Trip)).toBe(true);
    expect(canSyncTripArchive(viewer as Trip)).toBe(false);
    expect(canSyncTripArchive(local)).toBe(false);
  });
});

describe('syncTripArchives', () => {
  it('skips without a backend or an account', async () => {
    expect(await syncTripArchives(null, USER_ID)).toEqual({ status: 'skipped' });
    expect(await syncTripArchives(fakeClient().client, null)).toEqual({ status: 'skipped' });
  });

  it('asks the server nothing when no trip can sync', async () => {
    await createTrip({ name: 'Local only' });
    const fake = fakeClient();

    const result = await syncTripArchives(fake.client, USER_ID);

    expect(result).toEqual({ status: 'synced', pulled: 0, pushed: 0, failed: 0 });
    expect(fake.selects).toBe(0);
  });

  it('archives a trip that this account archived on another device', async () => {
    const tripId = await memberTrip('r1');
    const fake = fakeClient([
      { trip_id: 'r1', archived: true, updated_at: new Date(T1).toISOString() },
    ]);

    const result = await syncTripArchives(fake.client, USER_ID);

    expect(result).toEqual({ status: 'synced', pulled: 1, pushed: 0, failed: 0 });
    const stored = await db.trips.get(tripId);
    expect(stored?.archived).toBe(true);
    expect(stored?.archivedUpdatedAt).toBe(T1);
    expect(fake.upserted).toEqual([]);
  });

  it('takes a trip back out when another device unarchived it later', async () => {
    const tripId = await memberTrip('r1', { archived: true, archivedUpdatedAt: T1 });
    const fake = fakeClient([
      { trip_id: 'r1', archived: false, updated_at: new Date(T2).toISOString() },
    ]);

    await syncTripArchives(fake.client, USER_ID);

    const stored = await db.trips.get(tripId);
    expect(stored?.archived).toBe(false);
    expect(stored?.archivedUpdatedAt).toBe(T2);
  });

  it('uploads a local change newer than the account copy', async () => {
    await memberTrip('r1', { archived: false, archivedUpdatedAt: T2 });
    const fake = fakeClient([
      { trip_id: 'r1', archived: true, updated_at: new Date(T1).toISOString() },
    ]);

    const result = await syncTripArchives(fake.client, USER_ID);

    expect(result).toEqual({ status: 'synced', pulled: 0, pushed: 1, failed: 0 });
    expect(fake.upserted).toEqual([
      {
        user_id: USER_ID,
        trip_id: 'r1',
        archived: false,
        updated_at: new Date(T2).toISOString(),
      },
    ]);
  });

  it('uploads a trip archived before the flag synced, and stamps it', async () => {
    const tripId = await memberTrip('r1', { archived: true });
    const fake = fakeClient();

    const result = await syncTripArchives(fake.client, USER_ID);

    expect(result).toEqual({ status: 'synced', pulled: 0, pushed: 1, failed: 0 });
    expect(fake.upserted[0]?.archived).toBe(true);
    const stamp = (await db.trips.get(tripId))?.archivedUpdatedAt;
    expect(stamp).toBeTypeOf('number');
    expect(fake.upserted[0]?.updated_at).toBe(new Date(stamp as number).toISOString());
  });

  it('moves nothing when both sides carry the same stamp', async () => {
    await memberTrip('r1', { archived: true, archivedUpdatedAt: T1 });
    const fake = fakeClient([
      { trip_id: 'r1', archived: true, updated_at: new Date(T1).toISOString() },
    ]);

    const result = await syncTripArchives(fake.client, USER_ID);

    expect(result).toEqual({ status: 'synced', pulled: 0, pushed: 0, failed: 0 });
  });

  it('leaves a trip nobody archived alone when the account has no row', async () => {
    await memberTrip('r1');
    const fake = fakeClient();

    const result = await syncTripArchives(fake.client, USER_ID);

    expect(result).toEqual({ status: 'synced', pulled: 0, pushed: 0, failed: 0 });
  });

  it('never touches a viewer trip or a local-only trip', async () => {
    const viewer = await memberTrip('r1', { viewerToken: 'tok' });
    const local = await createTrip({ name: 'Local' });
    await db.trips.update(local.id, { archived: true });
    const fake = fakeClient([
      { trip_id: 'r1', archived: true, updated_at: new Date(T1).toISOString() },
    ]);

    await syncTripArchives(fake.client, USER_ID);

    expect((await db.trips.get(viewer))?.archived).toBeUndefined();
    expect(fake.upserted).toEqual([]);
  });

  it('drops a malformed row on its own', async () => {
    const good = await memberTrip('r1');
    const bad = await memberTrip('r2');
    const fake = fakeClient([
      { trip_id: 'r1', archived: true, updated_at: new Date(T1).toISOString() },
      { trip_id: 'r2', archived: 'yes', updated_at: new Date(T1).toISOString() },
      { trip_id: 'r2', archived: true, updated_at: 'not a date' },
      { trip_id: 42, archived: true, updated_at: new Date(T1).toISOString() },
    ]);

    const result = await syncTripArchives(fake.client, USER_ID);

    expect(result).toEqual({ status: 'synced', pulled: 1, pushed: 0, failed: 0 });
    expect((await db.trips.get(good))?.archived).toBe(true);
    expect((await db.trips.get(bad))?.archived).toBeUndefined();
  });

  it('counts a refused trip and still uploads the others', async () => {
    await memberTrip('r1', { archived: true, archivedUpdatedAt: T1 });
    await memberTrip('r2', { archived: true, archivedUpdatedAt: T1 });
    const fake = fakeClient([], {
      refuse: { r1: 'new row violates row-level security policy' },
    });

    const result = await syncTripArchives(fake.client, USER_ID);

    expect(result).toEqual({ status: 'synced', pulled: 0, pushed: 1, failed: 1 });
    expect(fake.upserted.map((row) => row.trip_id)).toEqual(['r2']);
  });

  it('keeps a local tap that lands while the pass is running', async () => {
    const tripId = await memberTrip('r1', { archived: false, archivedUpdatedAt: T1 });
    const fake = fakeClient(
      [{ trip_id: 'r1', archived: true, updated_at: new Date(T2).toISOString() }],
      {
        beforeSelectAnswer: async () => {
          await db.trips.update(tripId, {
            archived: false,
            archivedUpdatedAt: (T2 + 1) as UnixTimestamp,
          });
        },
      },
    );

    const result = await syncTripArchives(fake.client, USER_ID);

    expect(result).toEqual({ status: 'synced', pulled: 0, pushed: 0, failed: 0 });
    const stored = await db.trips.get(tripId);
    expect(stored?.archived).toBe(false);
    expect(stored?.archivedUpdatedAt).toBe(T2 + 1);
  });

  it('reports a dropped connection as a network failure', async () => {
    await memberTrip('r1');
    const fake = fakeClient([], { selectError: 'TypeError: Failed to fetch' });

    const result = await syncTripArchives(fake.client, USER_ID);

    expect(result).toEqual({
      status: 'error',
      message: 'TypeError: Failed to fetch',
      reason: 'network',
    });
  });

  it('reports any other refusal as a server failure', async () => {
    await memberTrip('r1');
    const fake = fakeClient([], { selectError: 'relation "trip_archives" does not exist' });

    const result = await syncTripArchives(fake.client, USER_ID);

    expect(result).toMatchObject({ status: 'error', reason: 'server' });
  });

  // PostHog issue 01a1e38b: a build that shipped before its migration reached
  // the hosted project. PostgREST answers PGRST205 for a table it does not
  // know, and every pass reported it to error tracking as a server failure.
  it('reports a table the server does not have as unavailable', async () => {
    await memberTrip('r1', { archived: true, archivedUpdatedAt: T1 });
    const fake = fakeClient([], {
      selectError: "Could not find the table 'public.trip_archives' in the schema cache",
      selectErrorCode: 'PGRST205',
    });

    const result = await syncTripArchives(fake.client, USER_ID);

    expect(result).toEqual({
      status: 'error',
      message: "Could not find the table 'public.trip_archives' in the schema cache",
      reason: 'unavailable',
    });
    expect(fake.upserted).toEqual([]);
  });

  it('reads the missing table from the message when the code is lost', async () => {
    await memberTrip('r1');
    const fake = fakeClient([], {
      selectError: "Could not find the table 'public.trip_archives' in the schema cache",
    });

    const result = await syncTripArchives(fake.client, USER_ID);

    expect(result).toMatchObject({ status: 'error', reason: 'unavailable' });
  });

  it('ends the pass when an upload loses the connection', async () => {
    await memberTrip('r1', { archived: true, archivedUpdatedAt: T1 });
    const fake = fakeClient([], { refuse: { r1: 'Load failed' } });

    const result = await syncTripArchives(fake.client, USER_ID);

    expect(result).toMatchObject({ status: 'error', reason: 'network' });
  });
});
