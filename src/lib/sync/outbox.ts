/**
 * @fileoverview The durable queue of local updates awaiting the server.
 *
 * Its job is *latency and ordering*, not durability. Durability already belongs
 * to `yjsUpdates`, and correctness belongs to the provider's start-up
 * reconciliation, which diffs the document against the server's known state
 * vector. That layering matters: if a queue row is lost — the tab dies between
 * persisting an edit and queueing it, storage is evicted — the edit is still in
 * the document and the next start still sends it. A lost row costs a delay, not
 * data.
 *
 * What the queue buys, then: an edit made offline is sent the moment the network
 * returns, in the order it was made, without waiting for a reload.
 *
 * @module lib/sync/outbox
 */

import { db } from '@/lib/db/database';
import type { YjsOutboxRow } from '@/lib/db/database';
import type { TripId } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * Most rows kept for one trip.
 *
 * A long offline session with the server unreachable would otherwise grow this
 * without bound. On overflow the *oldest* rows are dropped rather than the
 * newest, because reconciliation reconstructs whatever the queue forgets, and
 * dropping the newest would delay the edits the user just made.
 */
const MAX_ROWS_PER_TRIP = 2000;

// ============================================================================
// Writes
// ============================================================================

/**
 * Queues one local update for delivery.
 *
 * @param tripId - Local trip the update belongs to
 * @param update - Raw Yjs binary update
 */
export async function enqueue(tripId: TripId, update: Uint8Array): Promise<void> {
  await db.transaction('rw', db.yjsOutbox, async () => {
    await db.yjsOutbox.add({ tripId, update, queuedAt: Date.now() });

    const count = await db.yjsOutbox.where('tripId').equals(tripId).count();
    if (count <= MAX_ROWS_PER_TRIP) {
      return;
    }

    // Trim from the front: ids are ascending, so the oldest sort first.
    const excess = count - MAX_ROWS_PER_TRIP;
    const oldest = await db.yjsOutbox
      .where('tripId')
      .equals(tripId)
      .limit(excess)
      .primaryKeys();
    await db.yjsOutbox.bulkDelete(oldest);
    console.warn(
      '[sync] outbox for trip %s exceeded %d rows; dropped %d oldest. Start-up reconciliation will resend them.',
      tripId,
      MAX_ROWS_PER_TRIP,
      excess,
    );
  });
}

/**
 * Removes rows the server has accepted.
 *
 * Takes explicit ids rather than clearing the queue, so an update enqueued while
 * a flush was in flight is not silently discarded along with the ones that were
 * actually sent.
 */
export async function acknowledge(ids: readonly number[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await db.yjsOutbox.bulkDelete([...ids]);
}

// ============================================================================
// Reads
// ============================================================================

/**
 * Everything queued for a trip, oldest first.
 *
 * Order matters only as a courtesy: Yjs updates commute, so applying them out of
 * order converges to the same state. Sending them in the order they were made
 * keeps the server log readable when debugging.
 */
export async function pending(tripId: TripId): Promise<YjsOutboxRow[]> {
  const rows = await db.yjsOutbox.where('tripId').equals(tripId).toArray();
  return rows.sort((left, right) => (left.id ?? 0) - (right.id ?? 0));
}

/** How many updates are waiting, for the sync badge. */
export async function pendingCount(tripId: TripId): Promise<number> {
  return db.yjsOutbox.where('tripId').equals(tripId).count();
}

/**
 * Discards a trip's queue.
 *
 * Used when a trip stops syncing — left behind, its rows would be retried
 * forever against a trip the device no longer has.
 */
export async function clear(tripId: TripId): Promise<void> {
  await db.yjsOutbox.where('tripId').equals(tripId).delete();
}
