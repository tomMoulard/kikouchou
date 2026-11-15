/**
 * @fileoverview Per-account sync for the archived flag of a trip.
 *
 * Archiving is personal: one person puts a finished trip away and expects all
 * of their devices to agree, while a friend who is still planning keeps it in
 * the active list. So the flag does not travel in the trip document, which
 * every member shares, and which syncs only for the trip that is open. It
 * travels in `public.trip_archives`, one row per (account, trip), private to
 * the account.
 *
 * The reconciliation is last-write-wins on a client-authored timestamp, as
 * `guest-groups.ts` does for another small personal record:
 *
 * - **Strictly newer wins.** A server row newer than the device's
 *   `archivedUpdatedAt` is written locally. A local stamp newer than the row,
 *   or a local archive the server has never heard of, is uploaded. Equal
 *   stamps are the same write coming back, and nothing moves.
 * - **One row at a time on the way up.** A trip this account no longer
 *   belongs to is refused by RLS. That refusal costs that one trip, never the
 *   rest of the pass.
 * - **Every server row is remote input.** Another device wrote it, so a row
 *   whose fields do not have the expected shape is dropped on its own.
 * - **A local write that lands mid-pass wins.** Each write re-reads the trip
 *   inside a transaction and gives up when the stamp moved since the pass
 *   read it, so a tap on "Archive" during a sync is never overwritten.
 *
 * Only a trip with a server row and a membership can sync: a local-only trip,
 * the sample trip and a viewer trip keep their flag on the device until the
 * account sweep links them.
 *
 * Known and deliberate: the device-local stamp does not say which account set
 * it. Two accounts that share one browser and one trip push the device's
 * state to each other's row. Same trade-off as the guest groups.
 *
 * @module lib/sync/trip-archives
 */

import { db } from '@/lib/db/database';
import { now } from '@/lib/db/utils';
import type { TypedSupabaseClient } from '@/lib/supabase/client';
import { isClockSkewMessage, isNetworkFailureMessage } from './guest-groups';
import type { Trip, TripId, UnixTimestamp } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** What a sync attempt did, so a caller can report it rather than guess. */
export type TripArchiveSyncResult =
  /** No backend, or nobody signed in. The ordinary local-only mode. */
  | { readonly status: 'skipped' }
  | {
      readonly status: 'synced';
      /** Trips whose flag was written locally from the account's copy. */
      readonly pulled: number;
      /** Trips whose flag was uploaded. */
      readonly pushed: number;
      /** Trips the server refused, for example after leaving the trip. */
      readonly failed: number;
    }
  | {
      readonly status: 'error';
      readonly message: string;
      /** Same meaning as `GuestGroupSyncResult`'s `reason`. */
      readonly reason: 'network' | 'clock' | 'server';
    };

/** One server row, after validation. */
interface RemoteArchive {
  readonly archived: boolean;
  readonly updatedAt: UnixTimestamp;
}

// ============================================================================
// Constants
// ============================================================================

/** The table name, in one place so a typo is one edit rather than two. */
const TABLE = 'trip_archives';

/** Longer than any ISO timestamp Postgres prints. Anything longer is not one. */
const MAX_TIMESTAMP_LENGTH = 40;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Whether a trip can sync its flag with the account.
 *
 * @param trip - A local trip
 * @returns True for a member trip that has a server row
 */
export function canSyncTripArchive(trip: Trip): boolean {
  return trip.remoteTripId !== undefined && trip.viewerToken === undefined;
}

/**
 * Reads one server row, or `undefined` when it cannot be trusted.
 *
 * @param row - A row as PostgREST returned it
 * @returns The trip id and the validated flag, or undefined to drop the row
 */
function toRemoteArchive(
  row: Record<string, unknown>,
): readonly [string, RemoteArchive] | undefined {
  const tripId = row.trip_id,
    archived = row.archived,
    updatedAt = row.updated_at;

  if (
    typeof tripId !== 'string' ||
    tripId.length === 0 ||
    typeof archived !== 'boolean' ||
    typeof updatedAt !== 'string' ||
    updatedAt.length > MAX_TIMESTAMP_LENGTH
  ) {
    return undefined;
  }

  const stamp = Date.parse(updatedAt);
  if (!Number.isFinite(stamp) || stamp < 0) {
    return undefined;
  }

  return [tripId, { archived, updatedAt: stamp as UnixTimestamp }];
}

/**
 * Writes the account's flag onto a local trip, unless the trip moved since the
 * pass read it.
 *
 * @param tripId - The local trip id
 * @param seenStamp - The `archivedUpdatedAt` the pass read
 * @param remote - The account's flag
 * @returns True when the row was written
 */
async function applyRemoteArchive(
  tripId: TripId,
  seenStamp: UnixTimestamp | undefined,
  remote: RemoteArchive,
): Promise<boolean> {
  return db.transaction('rw', db.trips, async () => {
    const current = await db.trips.get(tripId);
    if (!current || current.archivedUpdatedAt !== seenStamp) {
      return false;
    }
    await db.trips.update(tripId, {
      archived: remote.archived,
      archivedUpdatedAt: remote.updatedAt,
    });
    return true;
  });
}

/**
 * Uploads one trip's flag.
 *
 * @param client - An authenticated Supabase client
 * @param userId - The signed-in account
 * @param trip - The local trip, with a `remoteTripId`
 * @returns `true` when the server took it, or the server's error message
 * @throws {Error} When the request never reached the server, which ends the pass
 */
async function pushTripArchive(
  client: TypedSupabaseClient,
  userId: string,
  trip: Trip,
): Promise<true | string> {
  // A trip archived before the flag synced per account has no stamp. It gets
  // one now, and keeps it once the server has taken it.
  const stamp = trip.archivedUpdatedAt ?? now();

  const { error } = await client.from(TABLE).upsert(
    {
      user_id: userId,
      trip_id: trip.remoteTripId as string,
      archived: trip.archived === true,
      updated_at: new Date(stamp).toISOString(),
    },
    { onConflict: 'user_id,trip_id' },
  );

  if (error) {
    if (isNetworkFailureMessage(error.message)) {
      throw new Error(error.message);
    }
    return error.message;
  }

  if (trip.archivedUpdatedAt === undefined) {
    await db.transaction('rw', db.trips, async () => {
      const current = await db.trips.get(trip.id);
      if (current && current.archivedUpdatedAt === undefined) {
        await db.trips.update(trip.id, { archivedUpdatedAt: stamp });
      }
    });
  }

  return true;
}

// ============================================================================
// Sync
// ============================================================================

/**
 * Reconciles the archived flag of every member trip on this device with the
 * signed-in account.
 *
 * @param client - An authenticated Supabase client, or null without a backend
 * @param userId - The signed-in account, or null when signed out
 * @returns What moved, or why nothing could
 *
 * @example
 * ```typescript
 * const result = await syncTripArchives(client, user?.id);
 * if (result.status === 'error') {
 *   console.warn('[trip-archives] sync failed:', result.message);
 * }
 * ```
 */
export async function syncTripArchives(
  client: TypedSupabaseClient | null,
  userId: string | null | undefined,
): Promise<TripArchiveSyncResult> {
  if (!client || !userId) {
    return { status: 'skipped' };
  }

  try {
    const local = (await db.trips.toArray()).filter(canSyncTripArchive);
    if (local.length === 0) {
      return { status: 'synced', pulled: 0, pushed: 0, failed: 0 };
    }

    const { data, error } = await client
      .from(TABLE)
      .select('trip_id, archived, updated_at')
      .eq('user_id', userId);

    if (error) {
      throw new Error(error.message);
    }

    const remote = new Map<string, RemoteArchive>();
    for (const row of (data ?? []) as readonly Record<string, unknown>[]) {
      const parsed = toRemoteArchive(row);
      if (parsed) {
        remote.set(parsed[0], parsed[1]);
      }
    }

    let pulled = 0,
      pushed = 0,
      failed = 0;

    for (const trip of local) {
      const row = remote.get(trip.remoteTripId as string),
        localStamp = trip.archivedUpdatedAt;

      if (row && (localStamp === undefined || row.updatedAt > localStamp)) {
        const differs =
          (trip.archived === true) !== row.archived || localStamp !== row.updatedAt;
        if (differs && (await applyRemoteArchive(trip.id, localStamp, row))) {
          pulled += 1;
        }
        continue;
      }

      const needsPush = row
        ? localStamp !== undefined && localStamp > row.updatedAt
        : localStamp !== undefined || trip.archived === true;

      if (!needsPush) {
        continue;
      }

      const outcome = await pushTripArchive(client, userId, trip);
      if (outcome === true) {
        pushed += 1;
      } else {
        failed += 1;
        console.warn(
          '[trip-archives] the server refused the flag of %s: %s',
          trip.remoteTripId,
          outcome,
        );
      }
    }

    return { status: 'synced', pulled, pushed, failed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'error',
      message,
      reason: isNetworkFailureMessage(message)
        ? 'network'
        : isClockSkewMessage(message)
          ? 'clock'
          : 'server',
    };
  }
}
