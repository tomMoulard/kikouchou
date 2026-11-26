/**
 * @fileoverview Keeps the device's achievements in step with the account, and
 * reads how rare each one is.
 *
 * The shape is the guest groups' (`lib/sync/guest-groups`), made simpler by a
 * fact about achievements: an unlock is permanent. Nothing is ever deleted or
 * edited, so there is no conflict to resolve. The pull adds what the account
 * holds and the device lacks; the push uploads what the device holds and the
 * account lacks, as an insert that ignores a row already there.
 *
 * Two achievements are only knowable with the account, so the sync also asks:
 *
 * - **How many trips the account owns.** The tier counter rises to it, which
 *   counts the trips a person made on another device or before this build.
 * - **Whether anyone joined one of them** (`trip_shared`). The owner's device
 *   gets no event when an invite is redeemed, so it asks the roster.
 *
 * A row from the server is remote input: only a key this build knows, with a
 * date it can read, is written.
 *
 * @module lib/achievements/sync
 */

import { db } from '@/lib/db/database';
import type { TypedSupabaseClient } from '@/lib/supabase/client';

import { isAchievementKey, type AchievementKey } from './definitions';
import {
  raiseCounter,
  raiseCountersToHeldStages,
  recordTripShared,
  unlockAchievements,
} from './store';

// ============================================================================
// Type Definitions
// ============================================================================

/** What one sync did. */
export type AchievementSyncResult =
  | { readonly status: 'skipped' }
  | { readonly status: 'synced'; readonly pulled: number; readonly pushed: number }
  | {
      readonly status: 'error';
      readonly message: string;
      /** `unavailable`: the server has no achievements table yet. */
      readonly reason: 'unavailable' | 'other';
    };

/** The share of accounts holding each achievement, as whole percents. */
export type AchievementStats = ReadonlyMap<AchievementKey, number>;

// ============================================================================
// Constants
// ============================================================================

const TABLE = 'achievements';

/** Unlock dates the server accepts: from 2026 on. */
const EARLIEST_UNLOCK = Date.parse('2026-01-01T00:00:00Z');

// ============================================================================
// Helpers
// ============================================================================

function isMissingTableError(error: { readonly code?: string | null; readonly message: string }): boolean {
  return (
    error.code === 'PGRST205' ||
    error.code === 'PGRST202' ||
    /\bCould not find the (table|function) '[^']+' in the schema cache\b/i.test(error.message)
  );
}

function failure(error: { readonly code?: string | null; readonly message: string }): AchievementSyncResult {
  return {
    status: 'error',
    message: error.message,
    reason: isMissingTableError(error) ? 'unavailable' : 'other',
  };
}

/** A date for the server: never before 2026, never in the future. */
function toServerDate(unlockedAt: number): string {
  const bounded = Math.min(Math.max(unlockedAt, EARLIEST_UNLOCK), Date.now());
  return new Date(bounded).toISOString();
}

// ============================================================================
// Sync
// ============================================================================

/**
 * Pulls, asks, then pushes, for one account.
 *
 * @param client - The Supabase client, or null in a build without a project.
 * @param userId - The signed-in account, or null.
 * @returns What happened. Never throws.
 */
export async function syncAchievements(
  client: TypedSupabaseClient | null,
  userId: string | null,
): Promise<AchievementSyncResult> {
  if (!client || !userId) {
    return { status: 'skipped' };
  }

  try {
    // Pull: the account's unlocks this device lacks.
    const { data: remote, error: pullError } = await client
      .from(TABLE)
      .select('key, unlocked_at')
      .eq('owner_id', userId);
    if (pullError) {
      return failure(pullError);
    }

    let pulled = 0;
    const onServer = new Set<string>();
    for (const row of remote ?? []) {
      onServer.add(row.key);
      const unlockedAt = Date.parse(row.unlocked_at);
      if (!isAchievementKey(row.key) || Number.isNaN(unlockedAt)) {
        continue;
      }
      pulled += (await unlockAchievements([row.key], { silent: true, unlockedAt })).length;
    }
    if (onServer.size > 0) {
      // A row the server already holds needs no upload from this account.
      await db.achievements
        .where('key')
        .anyOf([...onServer])
        .modify({ uploadedBy: userId });
    }
    if (pulled > 0) {
      // A stage reached on another device: the next one counts on from it.
      await raiseCountersToHeldStages();
    }

    // Ask: trips the account owns, and whether anybody joined one.
    const { count: ownedTrips, error: tripsError } = await client
      .from('trips')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', userId);
    if (!tripsError && typeof ownedTrips === 'number') {
      await raiseCounter('tripsCreated', ownedTrips);
    }

    const { data: joined, error: joinedError } = await client
      .from('trip_members')
      .select('trip_id, trips!inner(owner_id)')
      .eq('trips.owner_id', userId)
      .neq('user_id', userId)
      .limit(1);
    if (!joinedError && (joined ?? []).length > 0) {
      await recordTripShared();
    }

    // Push: what this device holds and this account has not received.
    const pending = (await db.achievements.toArray()).filter(
      (row) => isAchievementKey(row.key) && row.uploadedBy !== userId,
    );
    if (pending.length > 0) {
      const { error: pushError } = await client.from(TABLE).upsert(
        pending.map((row) => ({
          owner_id: userId,
          key: row.key,
          unlocked_at: toServerDate(row.unlockedAt),
        })),
        { onConflict: 'owner_id,key', ignoreDuplicates: true },
      );
      if (pushError) {
        return failure(pushError);
      }
      await db.achievements
        .where('key')
        .anyOf(pending.map((row) => row.key))
        .modify({ uploadedBy: userId });
    }

    return { status: 'synced', pulled, pushed: pending.length };
  } catch (error: unknown) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
      reason: 'other',
    };
  }
}

/**
 * Reads the share of accounts that hold each achievement.
 *
 * @param client - A signed-in Supabase client.
 * @returns Known keys only, or null when the server cannot say.
 */
export async function fetchAchievementStats(
  client: TypedSupabaseClient,
): Promise<AchievementStats | null> {
  try {
    const { data, error } = await client.rpc('achievement_stats');
    if (error) {
      return null;
    }
    const stats = new Map<AchievementKey, number>();
    for (const row of data ?? []) {
      if (
        isAchievementKey(row.key) &&
        Number.isInteger(row.percent) &&
        row.percent >= 0 &&
        row.percent <= 100
      ) {
        stats.set(row.key, row.percent);
      }
    }
    return stats;
  } catch {
    return null;
  }
}
