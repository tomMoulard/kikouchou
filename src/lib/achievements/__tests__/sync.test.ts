/**
 * @fileoverview Tests for the account sync of achievements and the stats read.
 *
 * The Supabase client is a small fake: each table answers one canned result,
 * and the fake records what was uploaded.
 *
 * @module lib/achievements/__tests__/sync.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db/database';
import type { TypedSupabaseClient } from '@/lib/supabase/client';

import { listUnlockedAchievements, onAchievementsUnlocked, readCounter } from '../store';
import { fetchAchievementStats, syncAchievements } from '../sync';

// ============================================================================
// Fake client
// ============================================================================

interface FakeError {
  readonly code?: string;
  readonly message: string;
}

interface FakeOptions {
  readonly remote?: readonly { key: string; unlocked_at: string }[];
  readonly pullError?: FakeError;
  readonly pushError?: FakeError;
  readonly ownedTrips?: number;
  readonly joined?: readonly unknown[];
  readonly stats?: readonly { key: string; percent: number }[];
  readonly statsError?: FakeError;
}

const USER = 'user-1';

function fakeClient(options: FakeOptions = {}) {
  const uploads: { rows: unknown[]; options: unknown }[] = [];
  const filters: string[] = [];

  function builder(table: string) {
    let upserting = false;
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        filters.push(`${table}.${column}=${String(value)}`);
        return chain;
      },
      neq: (column: string, value: unknown) => {
        filters.push(`${table}.${column}!=${String(value)}`);
        return chain;
      },
      limit: () => chain,
      upsert: (rows: unknown[], upsertOptions: unknown) => {
        upserting = true;
        uploads.push({ rows, options: upsertOptions });
        return chain;
      },
      then: (resolve: (value: unknown) => unknown) => {
        if (table === 'achievements') {
          return resolve(
            upserting
              ? { error: options.pushError ?? null }
              : { data: options.remote ?? [], error: options.pullError ?? null },
          );
        }
        if (table === 'trips') {
          return resolve({ count: options.ownedTrips ?? 0, error: null });
        }
        return resolve({ data: options.joined ?? [], error: null });
      },
    };
    return chain;
  }

  const client = {
    from: (table: string) => builder(table),
    rpc: async () => ({ data: options.stats ?? [], error: options.statsError ?? null }),
  } as unknown as TypedSupabaseClient;

  return { client, uploads, filters };
}

// ============================================================================
// Tests
// ============================================================================

describe('syncAchievements', () => {
  beforeEach(async () => {
    await db.achievements.clear();
    await db.achievementCounters.clear();
  });

  it('skips without a client or an account', async () => {
    expect(await syncAchievements(null, USER)).toEqual({ status: 'skipped' });
    expect(await syncAchievements(fakeClient().client, null)).toEqual({ status: 'skipped' });
  });

  it('pulls the account\'s unlocks silently, and drops keys it does not know', async () => {
    const listener = vi.fn();
    const off = onAchievementsUnlocked(listener);
    const { client, uploads } = fakeClient({
      remote: [
        { key: 'polyglot', unlocked_at: '2026-03-01T10:00:00Z' },
        { key: 'from_the_future', unlocked_at: '2026-03-01T10:00:00Z' },
        { key: 'leap_day', unlocked_at: 'not a date' },
      ],
    });

    const result = await syncAchievements(client, USER);
    off();

    expect(result).toEqual({ status: 'synced', pulled: 1, pushed: 0 });
    expect(listener).not.toHaveBeenCalled();
    const held = await listUnlockedAchievements();
    expect([...held.keys()]).toEqual(['polyglot']);
    expect(held.get('polyglot')).toBe(Date.parse('2026-03-01T10:00:00Z'));
    // Pulled rows are on the server already: nothing to upload.
    expect(uploads).toEqual([]);
    expect((await db.achievements.get('polyglot'))?.uploadedBy).toBe(USER);
  });

  it('carries a stage pulled from another device into its counter', async () => {
    const { client } = fakeClient({
      remote: [{ key: 'guests_10', unlocked_at: '2026-03-01T10:00:00Z' }],
    });

    await syncAchievements(client, USER);

    expect(await readCounter('guestsAdded')).toBe(10);
    expect((await listUnlockedAchievements()).has('first_guest')).toBe(true);
  });

  it('uploads what the account lacks once, as an insert that ignores a held row', async () => {
    await db.achievements.bulkAdd([
      { key: 'first_guest', unlockedAt: Date.parse('2026-05-01T00:00:00Z') },
      // Before 2026: the server would refuse it, so it goes up bounded.
      { key: 'polyglot', unlockedAt: Date.parse('2020-01-01T00:00:00Z') },
      { key: 'unknown_key', unlockedAt: Date.parse('2026-05-01T00:00:00Z') },
    ]);
    const first = fakeClient();

    expect(await syncAchievements(first.client, USER)).toEqual({
      status: 'synced',
      pulled: 0,
      pushed: 2,
    });
    expect(first.uploads).toEqual([
      {
        rows: [
          { owner_id: USER, key: 'first_guest', unlocked_at: '2026-05-01T00:00:00.000Z' },
          { owner_id: USER, key: 'polyglot', unlocked_at: '2026-01-01T00:00:00.000Z' },
        ],
        options: { onConflict: 'owner_id,key', ignoreDuplicates: true },
      },
    ]);

    const second = fakeClient();
    await syncAchievements(second.client, USER);
    expect(second.uploads).toEqual([]);

    // Another account on the same device gets its own upload.
    const other = fakeClient();
    await syncAchievements(other.client, 'user-2');
    expect(other.uploads).toHaveLength(1);
  });

  it('raises the trip counter to the trips the account owns', async () => {
    const { client, filters } = fakeClient({ ownedTrips: 11 });

    await syncAchievements(client, USER);

    expect(filters).toContain(`trips.owner_id=${USER}`);
    expect(await readCounter('tripsCreated')).toBe(11);
    expect([...(await listUnlockedAchievements()).keys()].sort()).toEqual([
      'trips_1',
      'trips_10',
      'trips_3',
    ]);
  });

  it('unlocks trip_shared when another account is on a trip this one owns', async () => {
    const { client, filters } = fakeClient({ joined: [{ trip_id: 't1' }] });

    await syncAchievements(client, USER);

    expect(filters).toEqual(
      expect.arrayContaining([`trip_members.trips.owner_id=${USER}`, `trip_members.user_id!=${USER}`]),
    );
    expect((await listUnlockedAchievements()).has('trip_shared')).toBe(true);
  });

  it('reports a server with no achievements table as unavailable', async () => {
    const { client } = fakeClient({
      pullError: { code: 'PGRST205', message: "Could not find the table 'public.achievements' in the schema cache" },
    });

    expect(await syncAchievements(client, USER)).toEqual({
      status: 'error',
      message: "Could not find the table 'public.achievements' in the schema cache",
      reason: 'unavailable',
    });
  });

  it('reports a failed upload, and leaves the rows waiting', async () => {
    await db.achievements.add({ key: 'first_guest', unlockedAt: Date.now() });
    const { client } = fakeClient({ pushError: { message: 'permission denied' } });

    expect(await syncAchievements(client, USER)).toEqual({
      status: 'error',
      message: 'permission denied',
      reason: 'other',
    });
    expect((await db.achievements.get('first_guest'))?.uploadedBy).toBeUndefined();
  });

  it('turns a thrown error into a result', async () => {
    const client = {
      from: () => {
        throw new Error('offline');
      },
    } as unknown as TypedSupabaseClient;

    expect(await syncAchievements(client, USER)).toEqual({
      status: 'error',
      message: 'offline',
      reason: 'other',
    });
  });
});

describe('fetchAchievementStats', () => {
  it('keeps known keys with a percent between 0 and 100', async () => {
    const { client } = fakeClient({
      stats: [
        { key: 'trips_1', percent: 14 },
        { key: 'polyglot', percent: 140 },
        { key: 'midnight_pet', percent: 2.5 },
        { key: 'from_the_future', percent: 3 },
      ],
    });

    expect(await fetchAchievementStats(client)).toEqual(new Map([['trips_1', 14]]));
  });

  it('answers null when the server cannot say', async () => {
    const { client } = fakeClient({ statsError: { message: 'nope' } });
    expect(await fetchAchievementStats(client)).toBeNull();

    const throwing = {
      rpc: () => {
        throw new Error('offline');
      },
    } as unknown as TypedSupabaseClient;
    expect(await fetchAchievementStats(throwing)).toBeNull();
  });
});
