/**
 * @fileoverview Puts a trip's document on the server, once, at share time.
 *
 * Sync is mounted for the **open** trip only — one document, one channel, one
 * set of listeners, rather than one of each for every trip on the device. That
 * is the right trade for a list of trips, and it leaves exactly one gap: a trip
 * shared while a different trip is open has a server row and an invite, and no
 * document behind them.
 *
 * The gap is invisible to the person sharing, because their own copy is
 * complete. The invitee gets the consequence: `materialiseJoinedTrip` fetches
 * name and dates from the server's preview row, so the trip *appears* — and then
 * sits on "Getting the trip…" forever, because the document it is waiting for
 * was never uploaded. No guests, no rooms, no transport, no activities.
 *
 * So sharing uploads the document itself rather than hoping the provider is
 * mounted. Nothing else needs this: an edit can only be made from inside a trip,
 * which makes it the open one, so every later change goes through the provider
 * in the ordinary way. This closes the first upload, which is the only one that
 * can happen while the trip is not open.
 *
 * @module lib/sync/upload-document
 */

import type { TypedSupabaseClient } from '@/lib/supabase/client';
import * as Y from 'yjs';

import { loadPersistedUpdates, populateDocFromDexie } from '@/lib/yjs/dexie-bridge';
import { encodeUpdate } from './codec';
import { readCursor, recordServerState } from './cursors';
import type { TripId } from '@/types';

// ============================================================================
// Public API
// ============================================================================

export type UploadResult =
  | { readonly status: 'uploaded' }
  /** The server already had everything this device holds. */
  | { readonly status: 'already-current' }
  | { readonly status: 'error'; readonly message: string };

/**
 * Uploads this trip's document, if it has never been uploaded.
 *
 * Safe to call repeatedly and safe to call while a provider is running for the
 * same trip: both cases return `already-current` without touching the document.
 *
 * @param client - An authenticated Supabase client
 * @param tripId - Local trip id
 * @param remoteTripId - Server `trips.id`
 */
export async function uploadTripDocument(
  client: TypedSupabaseClient,
  tripId: TripId,
  remoteTripId: string,
): Promise<UploadResult> {
  // Skipped only when the server can actually show for it.
  //
  // A recorded server state vector *usually* means this trip has been uploaded,
  // and re-uploading is worth avoiding: the document below is rebuilt from Dexie
  // into a fresh `Y.Doc` with a new client id, so re-populating writes every
  // value again as new CRDT items — a larger log, and a risk of resurrecting
  // something another device deleted that this device has not heard about yet.
  //
  // But a recorded vector is a claim by this device about the server, and it can
  // be wrong. A provider that started before the trip's contents were populated
  // into its document reconciles an empty document, finds nothing to send, and
  // records the vector anyway — a true statement about an empty document that
  // reads afterwards as "already uploaded". Trusting it then makes the trip
  // *permanently* broken rather than briefly: the invitee waits on "Getting the
  // trip…" and re-sharing cannot repair it, because every later attempt
  // short-circuits on the same stale claim.
  //
  // So the server is asked. One cheap query, and it turns an unrecoverable state
  // into a self-healing one — re-opening the share dialog repairs the trip.
  const existing = await readCursor(tripId);
  if (existing.serverStateVector !== undefined) {
    const serverHolds = await serverHasDocument(client, remoteTripId);
    if (serverHolds === true) {
      return { status: 'already-current' };
    }
    if (serverHolds === null) {
      // Could not tell. Skipping risks leaving a broken trip broken; uploading
      // risks a duplicate row that every peer treats as a no-op. Upload.
      console.warn('[sync] could not read the server document state; uploading anyway');
    }
  }

  // Its own document rather than the one React holds: this runs for a trip that
  // is very likely not the open one, so there is no live document to borrow.
  const doc = new Y.Doc();

  try {
    // Both, in this order. The persisted updates carry the document's own
    // history; `populateDocFromDexie` covers a trip whose rows were written
    // before it ever had a document — which is every trip created before the
    // first time it was opened with sync on.
    await loadPersistedUpdates(doc, tripId);
    await populateDocFromDexie(doc, tripId);

    const localVector = Y.encodeStateVector(doc);
    // Deliberately the whole document, not a diff against the recorded vector:
    // reaching here means either nothing was recorded or the recording was shown
    // to be wrong, and diffing against a vector the server does not have would
    // send an empty update and re-record the same false claim.
    const missing = Y.encodeStateAsUpdate(doc);

    // Reached only for a document with genuinely nothing in it, which in practice
    // means a trip row that has since been deleted: `populateDocFromDexie` writes
    // the trip's own name and dates, so even a trip with no guests has something
    // to send — and should, since the invitee reads those from the document too.
    if (isEmpty(missing)) {
      await recordServerState(tripId, localVector);
      return { status: 'already-current' };
    }

    const { error } = await client.from('trip_doc_updates').insert({
      trip_id: remoteTripId,
      update: encodeUpdate(missing),
    });
    if (error) {
      return { status: 'error', message: error.message };
    }

    // Only after the insert has landed, so a failure leaves the diff to be
    // recomputed rather than silently marked as sent.
    await recordServerState(tripId, localVector);
    return { status: 'uploaded' };
  } catch (error: unknown) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    doc.destroy();
  }
}

// ============================================================================
// Internals
// ============================================================================

/**
 * Whether the server holds anything for this trip.
 *
 * True if a log row or a snapshot exists, false if neither does, and null when
 * the question could not be answered — which the caller treats as a reason to
 * upload rather than to skip.
 */
async function serverHasDocument(
  client: TypedSupabaseClient,
  remoteTripId: string,
): Promise<boolean | null> {
  try {
    const { data: rows, error: rowsError } = await client
      .from('trip_doc_updates')
      .select('id')
      .eq('trip_id', remoteTripId)
      .limit(1);
    if (rowsError) {
      return null;
    }
    if (Array.isArray(rows) && rows.length > 0) {
      return true;
    }

    // No rows is not the same as nothing: compaction folds the log into a
    // snapshot and prunes what it covered, so a fully compacted trip has a
    // document and an empty log.
    const { data: snapshot, error: snapshotError } = await client
      .from('trip_doc_snapshots')
      .select('through_id')
      .eq('trip_id', remoteTripId)
      .maybeSingle();
    if (snapshotError) {
      return null;
    }
    return snapshot !== null;
  } catch {
    return null;
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
