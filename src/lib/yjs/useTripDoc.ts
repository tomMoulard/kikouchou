/**
 * @fileoverview The trip's Y.Doc and its local durability. No network.
 *
 * Replaces `useYjsSync`, which also owned a `y-webrtc` connection. That
 * transport is gone: the server is the peer now, and `SupabaseYjsProvider` owns
 * everything to do with the wire.
 *
 * What is left here is the part that was always local and always necessary — a
 * document per trip, rebuilt from IndexedDB on open so edits survive a reload
 * with no server and no account. Keeping it separate from the transport is what
 * makes the offline story independent of whether a trip is shared at all.
 *
 * Keyed on the trip id. It used to be keyed on the WebRTC room id, which meant
 * local persistence could not be read without first resolving a credential that
 * only existed because of the transport.
 *
 * @module lib/yjs/useTripDoc
 */

import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';

import { loadPersistedUpdates, subscribeToUpdates } from './dexie-bridge';
import type { TripId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

export interface TripDocState {
  readonly doc: Y.Doc;
  /**
   * Whether the persisted updates have been replayed.
   *
   * Load-bearing for the sync provider: starting before the replay finishes
   * would diff a half-built document against the server and push a deletion of
   * everything not yet replayed.
   */
  readonly loaded: boolean;
}

// ============================================================================
// Hook
// ============================================================================

export function useTripDoc(tripId: TripId | null | undefined): TripDocState {
  /**
   * The document, tagged with the trip it belongs to.
   *
   * The tag is what makes `loaded` safe. Switching trips runs the previous
   * effect's cleanup — which destroys that document — before the next one has
   * finished loading, so a `loaded` flag on its own stays true across the gap
   * and hands consumers a **destroyed** document. Comparing the tag closes that
   * window: `loaded` is false until the state actually describes the trip being
   * asked about.
   */
  const [state, setState] = useState<{
    tripId: TripId | null;
    doc: Y.Doc;
    loaded: boolean;
  }>(() => ({ tripId: null, doc: new Y.Doc(), loaded: false }));

  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!tripId) {
      return undefined;
    }

    let cancelled = false;
    let destroyed = false;
    const doc = new Y.Doc();

    const destroy = (): void => {
      // Guarded: cleanup and the cancelled branch of initialise can both reach
      // here for the same document.
      if (destroyed) {
        return;
      }
      destroyed = true;
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      doc.destroy();
    };

    const initialise = async (): Promise<void> => {
      await loadPersistedUpdates(doc, tripId);
      if (cancelled) {
        destroy();
        return;
      }

      // Subscribed after the replay so the replay itself is not written straight
      // back out row by row.
      unsubscribeRef.current = subscribeToUpdates(doc, tripId);
      setState({ tripId, doc, loaded: true });
    };

    void initialise().catch((error: unknown) => {
      console.error('[yjs] failed to open the trip document:', error);
      destroy();
    });

    return () => {
      cancelled = true;
      destroy();
    };
  }, [tripId]);

  const matches = state.tripId !== null && state.tripId === (tripId ?? null);

  return {
    doc: state.doc,
    // Never true for a document belonging to a different trip, or for the
    // placeholder created before the first load.
    loaded: matches && state.loaded,
  };
}
