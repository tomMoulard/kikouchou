/**
 * @fileoverview Pulls a trip's document onto this device, once, at join time.
 *
 * The mirror of `upload-document`, and it closes the same gap from the other
 * side. Sync is mounted for the **open** trip only, so a trip that arrives while
 * a different trip is open — every trip the account sweep pulls down when
 * somebody signs in on a new device — gets a local row and no document behind
 * it.
 *
 * `materialiseJoinedTrip` writes that row from the server's denormalised
 * preview: a name and two dates. Everything else a trip is made of — the guests,
 * the place, the coordinates the card draws its map from, the rooms, the
 * transport — lives in the CRDT document and in no column. So the trip list on
 * the new device showed a row of cards with a name, a date range, "no guests"
 * and no map, and the only repair was to open every trip in turn and wait for
 * the provider to hydrate it.
 *
 * This runs that hydration once, for a trip nobody has opened, over the same
 * snapshot-then-log path the provider uses.
 *
 * ## What it deliberately does not do
 *
 * **It never touches a trip that already has a document here.** The guard is the
 * presence of any persisted update for the trip, and it is what keeps this
 * function free of the hardest question in the file it mirrors: whose value wins
 * when two devices disagree. It only ever runs where there is nothing local to
 * disagree with, and the provider — which does know how to merge — owns every
 * later pull.
 *
 * **It never creates a trip.** `syncDocToDexie` projects into a row that already
 * exists and refuses otherwise, which is what stops a document arriving under an
 * id nothing on this device chose.
 *
 * @module lib/sync/download-document
 */

import type { TypedSupabaseClient } from '@/lib/supabase/client';
import * as Y from 'yjs';

import { db } from '@/lib/db/database';
import { compactUpdates, syncDocToDexie } from '@/lib/yjs/dexie-bridge';
import { decodeUpdate } from './codec';
import { advanceCursor, recordServerState } from './cursors';
import type { TripId } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/** The same page size the provider pulls with, for the same reason. */
const PULL_PAGE_SIZE = 500;

// ============================================================================
// Type Definitions
// ============================================================================

export type DownloadResult =
  /** The document arrived and Dexie now holds the trip's contents. */
  | { readonly status: 'hydrated' }
  /** The server has no document for this trip yet, so the placeholder stands. */
  | { readonly status: 'empty' }
  /** This device already has a document for the trip; the provider owns it. */
  | { readonly status: 'skipped' }
  | { readonly status: 'error'; readonly message: string };

interface LogRow {
  readonly id: number;
  readonly update: unknown;
}

// ============================================================================
// Internals
// ============================================================================

/**
 * Applies the server's snapshot, and reports how far it claims to cover.
 *
 * Zero when there is no snapshot, which is the ordinary case until compaction
 * has run for a trip. A snapshot that does not decode is not fatal here the way
 * it is for the provider: this runs with an empty cursor, so the log is still
 * asked for from the beginning and the only loss is whatever pruning removed.
 */
async function applySnapshot(
  client: TypedSupabaseClient,
  doc: Y.Doc,
  remoteTripId: string,
): Promise<number> {
  const { data, error } = await client
    .from('trip_doc_snapshots')
    .select('state, through_id')
    .eq('trip_id', remoteTripId)
    .maybeSingle();

  if (error) {
    throw new Error(`snapshot read failed: ${error.message}`);
  }
  if (!data) {
    return 0;
  }

  const bytes = decodeUpdate((data as { state?: unknown }).state);
  if (!bytes) {
    console.warn('[sync] snapshot for trip %s did not decode; using the log', remoteTripId);
    return 0;
  }

  Y.applyUpdate(doc, bytes);

  const throughId = (data as { through_id?: unknown }).through_id;
  return typeof throughId === 'number' && throughId > 0 ? throughId : 0;
}

/**
 * Applies the log from `afterId` onwards, and reports the highest row applied.
 *
 * Paged, because a trip that has been edited for a fortnight has more rows than
 * one request returns, and a partial log is a trip missing whatever the last
 * page held.
 */
async function applyLog(
  client: TypedSupabaseClient,
  doc: Y.Doc,
  remoteTripId: string,
  afterId: number,
): Promise<number> {
  let highest = afterId;

  for (;;) {
    const { data, error } = await client
      .from('trip_doc_updates')
      .select('id, update')
      .eq('trip_id', remoteTripId)
      .gt('id', highest)
      .order('id', { ascending: true })
      .limit(PULL_PAGE_SIZE);

    if (error) {
      throw new Error(`log read failed: ${error.message}`);
    }

    const rows = (data ?? []) as LogRow[];
    if (rows.length === 0) {
      return highest;
    }

    // One transaction for the page, so the projection below runs once rather
    // than once per row.
    Y.transact(doc, () => {
      for (const row of rows) {
        const bytes = decodeUpdate(row.update);
        if (!bytes) {
          // Drop the row, never the page: one undecodable update is a gap in
          // the trip, and refusing the rest would be the whole trip.
          console.warn('[sync] skipping undecodable log row %d', row.id);
          continue;
        }
        try {
          Y.applyUpdate(doc, bytes);
        } catch (applyError: unknown) {
          console.warn('[sync] log row %d did not apply:', row.id, applyError);
        }
      }
    });

    for (const row of rows) {
      if (typeof row.id === 'number' && row.id > highest) {
        highest = row.id;
      }
    }

    if (rows.length < PULL_PAGE_SIZE) {
      return highest;
    }
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Hydrates a freshly joined trip from the server's document.
 *
 * Safe to call again: a trip that already holds a document returns `skipped`
 * without reading anything.
 *
 * Never throws. Every failure it can have — offline, a pruned snapshot, a trip
 * deleted mid-sweep — leaves the placeholder row exactly as it was, and the
 * provider hydrates the trip the first time it is opened, which is what happened
 * before this function existed.
 *
 * @param client - An authenticated Supabase client
 * @param tripId - Local trip id, resolved on this device and never from the
 *   payload
 * @param remoteTripId - Server `trips.id`
 */
export async function downloadTripDocument(
  client: TypedSupabaseClient,
  tripId: TripId,
  remoteTripId: string,
): Promise<DownloadResult> {
  try {
    const held = await db.yjsUpdates.where('tripId').equals(tripId).count();
    if (held > 0) {
      return { status: 'skipped' };
    }

    // Its own document: this runs for a trip that is by definition not the open
    // one, so there is no live document to borrow.
    const doc = new Y.Doc();

    try {
      const throughId = await applySnapshot(client, doc, remoteTripId);
      const highest = await applyLog(client, doc, remoteTripId, throughId);

      const state = Y.encodeStateAsUpdate(doc);
      if (isEmpty(state)) {
        // The owner has a server row and never uploaded a document. Projecting
        // an empty document over the placeholder would take the name and the
        // dates with it, which is worse than the trip staying a placeholder.
        return { status: 'empty' };
      }

      // Persisted first, so a trip hydrated on a train is still a trip after a
      // reload rather than a placeholder again. `compactUpdates` writes the
      // whole state as the single row for this trip, which is the shape
      // `loadPersistedUpdates` wants when the provider finally mounts.
      await compactUpdates(doc, tripId);

      const projected = await syncDocToDexie(doc, tripId);
      if (projected === null) {
        // The trip row went away while this ran. The persisted updates above are
        // orphaned rather than harmful, and the next sweep re-materialises.
        return { status: 'error', message: `no local trip ${tripId} to project into` };
      }

      if (highest > 0) {
        await advanceCursor(tripId, highest);
      }
      // Everything in this document came off the server, so this vector is a
      // true statement about what the server holds — and recording it is what
      // stops the provider re-sending the owner's whole trip back as fresh CRDT
      // items the first time somebody opens it here.
      await recordServerState(tripId, Y.encodeStateVector(doc));

      return { status: 'hydrated' };
    } finally {
      doc.destroy();
    }
  } catch (error: unknown) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The encoding of an update carrying no changes, measured rather than assumed. */
const EMPTY_UPDATE = Y.encodeStateAsUpdate(new Y.Doc());

function isEmpty(update: Uint8Array): boolean {
  return (
    update.length === EMPTY_UPDATE.length &&
    update.every((byte, index) => byte === EMPTY_UPDATE[index])
  );
}
