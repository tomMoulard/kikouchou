/**
 * @fileoverview Keeps a published template in step with the trip behind it.
 *
 * A template link hands strangers a copy of five fields, taken from the owner's
 * trip (see `lib/sync/templates`). Without this hook the copy froze at the last
 * press of Publish, so an owner who fixed the description after handing out the
 * link kept sending every new customer the old one.
 *
 * The hook watches the trip and its rooms in Dexie and rewrites the copy after
 * each change. Four rules shape it:
 *
 * - **It never writes what it found on mount before the trip has synced.** A
 *   device that has not hydrated yet holds an empty mirror, and an owner
 *   signing in on a new phone would otherwise publish a template with no
 *   rooms. The first value it sees is the baseline, and a change from it is
 *   worth sending. That change may come from the owner's own edit or from a
 *   member's edit arriving over sync.
 * - **Once the trip has synced, it sends what it holds once, edit or not.**
 *   Without that a template only caught up on the next edit, so a template
 *   published before photos existed never got its cover or its room photos,
 *   an edit made just before the app was closed never reached the link, and a
 *   photo whose copy failed waited for an edit that might never come. Opening
 *   the trip on the owner's device now brings the link and its photos up to
 *   date.
 * - **It only updates a row that exists.** `refreshTemplatePayload` never
 *   inserts, so a trip that was never published stays unpublished, and the
 *   owner-only policy makes a member's device a no-op.
 * - **A failed write is sent again when the connection comes back**, because
 *   the edit is the only trigger and it will not happen twice. A photo that
 *   could not be copied is tried again the same way.
 *
 * @module lib/sync/useTemplateRefresh
 */

import { useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { db } from '@/lib/db/database';
import { getSupabaseClient } from '@/lib/supabase/client';
import {
  buildTemplatePayload,
  refreshTemplatePayload,
  type TripTemplatePayload,
  uploadTemplatePhotos,
} from '@/lib/sync/templates';
import type { TripId } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * How long the trip must stay still before the copy is rewritten.
 *
 * Typing a description saves on every keystroke in some forms, and dragging a
 * room reorders several rows in a row. One write for the burst is enough.
 */
const DEFAULT_DEBOUNCE_MS = 1_500;

// ============================================================================
// Type Definitions
// ============================================================================

interface UseTemplateRefreshOptions {
  readonly tripId: TripId;
  /** Server `trips.id`. Null for a trip that is not on the server. */
  readonly remoteTripId: string | null;
  /** The signed-in account. Null keeps the hook idle: the write needs RLS. */
  readonly userId: string | null;
  /** False while offline. Going back to true retries a write that failed. */
  readonly online: boolean;
  /**
   * True once the trip has synced with the server, so the local mirror holds
   * what the server holds and is safe to publish unedited. Turning true sends
   * the current payload once, which is how a template catches up on what an
   * edit alone never sent.
   */
  readonly ready?: boolean;
  /** Overridden by tests. */
  readonly debounceMs?: number;
}

/** What the server holds, as far as this device knows. */
interface Settled {
  readonly tripId: TripId;
  readonly key: string;
  /**
   * False for the baseline found on mount, which the server may not hold: a
   * template published before photos existed, or an edit that never left.
   */
  readonly confirmed: boolean;
}

interface Snapshot {
  readonly tripId: TripId;
  /** The payload as JSON: compared to tell an edit apart, and parsed to send. */
  readonly key: string;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Rewrites the published copy of the current trip after each edit.
 *
 * @param options - Which trip, and whether a write can be attempted
 */
export function useTemplateRefresh({
  tripId,
  remoteTripId,
  userId,
  online,
  ready = false,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: UseTemplateRefreshOptions): void {
  const enabled = remoteTripId !== null && userId !== null;

  // Tagged with the trip id: `useLiveQuery` keeps the previous trip's result
  // under the new deps until the new query emits (see `YjsTripSync`), and that
  // stale value must neither become the baseline nor be sent.
  const snapshot = useLiveQuery(async (): Promise<Snapshot | null> => {
    if (!enabled) {
      return null;
    }
    const trip = await db.trips.get(tripId);
    if (!trip) {
      return null;
    }
    return { tripId, key: JSON.stringify(await buildTemplatePayload(trip)) };
  }, [enabled, tripId]);

  /** The last payload the server holds, as far as this device knows. */
  const settledRef = useRef<Settled | null>(null);

  // The effect is keyed on the text, not the object: the live query hands back
  // a new object on every emission, and an unrelated write to the trip row
  // would otherwise send the same payload a second time. The text is the
  // payload's own JSON, so it is also what gets sent.
  const currentKey = snapshot && snapshot.tripId === tripId ? snapshot.key : null;

  useEffect(() => {
    if (!enabled || remoteTripId === null || currentKey === null) {
      return;
    }
    let settled = settledRef.current;
    if (settled === null || settled.tripId !== tripId) {
      settled = { tripId, key: currentKey, confirmed: false };
      settledRef.current = settled;
    }
    const edited = settled.key !== currentKey;
    const catchUp = !settled.confirmed && ready;
    if ((!edited && !catchUp) || !online) {
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const client = await getSupabaseClient();
        if (cancelled || client === null) {
          return;
        }
        const payload = JSON.parse(currentKey) as TripTemplatePayload;
        const result = await refreshTemplatePayload(client, remoteTripId, payload);
        if (result.status === 'error') {
          // Left unsettled, so the next edit or the next reconnect sends it again.
          console.error('Failed to refresh the trip template:', result.message);
          return;
        }
        let photosFailed = 0;
        if (result.status === 'refreshed') {
          // A new or replaced photo goes to the template's prefix too, and so
          // does one an older template never got. Photos already there are
          // not sent again.
          photosFailed = await uploadTemplatePhotos(
            client,
            { id: tripId, remoteTripId },
            payload,
          );
        }
        // `not-published` settles too: there is nothing to refresh, and asking
        // again with the same payload would get the same answer. A photo that
        // could not be copied leaves it unconfirmed, so the next sync tries
        // again; the link works without it in the meantime.
        if (settledRef.current?.tripId === tripId) {
          settledRef.current = { tripId, key: currentKey, confirmed: photosFailed === 0 };
        }
      })();
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [currentKey, debounceMs, enabled, online, ready, remoteTripId, tripId]);
}
