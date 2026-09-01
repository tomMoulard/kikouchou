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

import type { SupabaseClient } from '@supabase/supabase-js';
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
  client: SupabaseClient,
  tripId: TripId,
  remoteTripId: string,
): Promise<UploadResult> {
  // Only ever the *first* upload, which is the only one that can happen while
  // the trip is not open.
  //
  // A recorded server state vector means this trip has already been uploaded, so
  // there is nothing here to do and a second pass would be actively worse than
  // useless: the document below is rebuilt from Dexie with a fresh `Y.Doc`, which
  // carries a new client id, so re-populating it would write every value again as
  // new CRDT items. Same converged result for a map keyed by entity id, but a
  // larger log — and a real risk of resurrecting something another device deleted
  // if that deletion has not reached this device's Dexie yet.
  const existing = await readCursor(tripId);
  if (existing.serverStateVector !== undefined) {
    return { status: 'already-current' };
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
    const missing = Y.encodeStateAsUpdate(doc, existing.serverStateVector);

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

/** The encoding of an update carrying no changes, measured rather than assumed. */
const EMPTY_UPDATE = Y.encodeStateAsUpdate(new Y.Doc());

function isEmpty(update: Uint8Array): boolean {
  return (
    update.length === EMPTY_UPDATE.length &&
    update.every((byte, index) => byte === EMPTY_UPDATE[index])
  );
}
