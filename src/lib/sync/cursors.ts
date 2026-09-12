/**
 * @fileoverview Per-trip position in the server's log.
 *
 * Two values, and the distinction between them is the whole design:
 *
 * - `lastSeenUpdateId` — how far this device has *read*. A pull asks for
 *   `id > this`. Advanced only by a completed pull, never by a Realtime
 *   payload: Realtime can in principle deliver out of order, and a cursor
 *   jumped forward on row 5 would silently skip row 4 forever.
 *
 * - `serverStateVector` — what the server is known to *hold*. Recorded only
 *   after a push succeeds with nothing left queued, so on the next start
 *   `Y.encodeStateAsUpdate(doc, thisVector)` is exactly what the server lacks.
 *   With no vector stored, that call returns the whole document — which is why
 *   the very first upload and catching up after a crash are the same code path,
 *   and why a lost outbox row degrades to a delayed send rather than lost data.
 *
 * @module lib/sync/cursors
 */

import { db } from '@/lib/db/database';
import type { SyncCursorRow } from '@/lib/db/database';
import type { TripId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** A trip's sync position, with defaults applied. */
export interface SyncCursor {
  readonly lastSeenUpdateId: number;
  readonly serverStateVector?: Uint8Array;
  readonly syncedAt?: number;
}

// ============================================================================
// Reads
// ============================================================================

/**
 * Reads a trip's cursor, defaulting to "nothing read, nothing pushed".
 *
 * A missing row is the normal first-run state, not an error: it means pull
 * everything and upload the whole document.
 */
export async function readCursor(tripId: TripId): Promise<SyncCursor> {
  const row = await db.syncCursors.get(tripId);
  if (!row) {
    return { lastSeenUpdateId: 0 };
  }

  return {
    // Guard the stored value: a corrupted or hand-edited row must not make the
    // client skip the entire log.
    lastSeenUpdateId:
      typeof row.lastSeenUpdateId === 'number' && row.lastSeenUpdateId > 0
        ? row.lastSeenUpdateId
        : 0,
    ...(row.serverStateVector ? { serverStateVector: row.serverStateVector } : {}),
    ...(row.syncedAt ? { syncedAt: row.syncedAt } : {}),
  };
}

// ============================================================================
// Writes
// ============================================================================

/**
 * Advances how far the log has been read.
 *
 * Monotonic: a lower id is ignored rather than written. Two concurrent pulls, or
 * a pull racing a reconnect, must not walk the cursor backwards and re-apply —
 * harmless for Yjs, but it would mask a genuine gap.
 */
export async function advanceCursor(
  tripId: TripId,
  lastSeenUpdateId: number,
): Promise<void> {
  await db.transaction('rw', db.syncCursors, async () => {
    const current = await db.syncCursors.get(tripId);
    if (current && current.lastSeenUpdateId >= lastSeenUpdateId) {
      return;
    }
    await db.syncCursors.put({
      tripId,
      lastSeenUpdateId,
      ...(current?.serverStateVector
        ? { serverStateVector: current.serverStateVector }
        : {}),
      syncedAt: Date.now(),
    });
  });
}

/**
 * Records that the server now holds everything in `stateVector`.
 *
 * Call this **only** after a push has been accepted and the outbox is empty.
 * Recording it optimistically would make the next start compute a diff against
 * state the server never received, and those edits would never be sent again.
 */
export async function recordServerState(
  tripId: TripId,
  stateVector: Uint8Array,
): Promise<void> {
  await db.transaction('rw', db.syncCursors, async () => {
    const current = await db.syncCursors.get(tripId);
    const next: SyncCursorRow = {
      tripId,
      lastSeenUpdateId: current?.lastSeenUpdateId ?? 0,
      serverStateVector: stateVector,
      syncedAt: Date.now(),
    };
    await db.syncCursors.put(next);
  });
}
