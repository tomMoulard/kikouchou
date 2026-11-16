/**
 * @fileoverview Keeps the archived flag of every trip in step with the account.
 *
 * Mounted once, beside `AccountTripSync`, and renders nothing. The trip
 * document syncs only for the open trip, so the archive cannot ride in it: a
 * trip archived from the list, or archived on another device, would never
 * move. This runs `syncTripArchives` for every member trip instead, at the
 * moments the flag can have changed:
 *
 * - **A session appears, or the network comes back.** The account's copy can
 *   have moved without this device knowing.
 * - **The tab comes back into view.** The phone archived a trip while the
 *   laptop sat in the background, and the laptop should agree when somebody
 *   looks at it. One small query, so it is cheap to ask.
 * - **A trip's archive state changes here.** A tap on "Archive", or a trip
 *   that just got its server row from the account sweep. The watched value is
 *   a string of ids, flags and stamps, so editing a trip's name does not
 *   restart anything.
 *
 * A pull writes the stamps it watches, so it triggers one more pass. That pass
 * finds equal stamps and moves nothing, which is what stops the loop.
 *
 * @module lib/sync/TripArchiveSync
 */

import { useCallback, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { useAuth } from '@/features/auth/AuthContext';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { db } from '@/lib/db/database';
import { reportError } from '@/lib/posthog';
import { getSupabaseClient } from '@/lib/supabase/client';
import { canSyncTripArchive, syncTripArchives } from './trip-archives';

// ============================================================================
// Component
// ============================================================================

/**
 * Runs the per-account archive sync for the whole app.
 *
 * @returns Nothing. This is a behaviour, not a surface.
 */
export function TripArchiveSync(): null {
  const { session } = useAuth();
  const { isOnline } = useOnlineStatus();

  // The id, not the session object: the object is replaced on every token
  // refresh, and keying on it would sync on each one.
  const userId = session?.user.id ?? null;

  /**
   * The archive state of every member trip, as one stable string.
   *
   * `undefined` while the first read is in flight, which the effect waits for.
   */
  const archiveKey = useLiveQuery(async () => {
    const trips = await db.trips.toArray();
    return trips
      .filter(canSyncTripArchive)
      .map(
        (trip) =>
          `${trip.id}:${trip.remoteTripId ?? ''}:${trip.archived === true ? 1 : 0}:${trip.archivedUpdatedAt ?? ''}`,
      )
      .sort()
      .join(',');
  }, []);

  // One pass at a time. A request that arrives during a pass sets `rerunRef`,
  // and the pass runs once more when it ends, so no request is dropped and
  // none runs twice side by side.
  const inFlightRef = useRef(false);
  const rerunRef = useRef(false);
  // Set when the server has no archive table: the build is ahead of the
  // project's migrations, and asking again before a reload answers the same.
  const unavailableRef = useRef(false);

  const run = useCallback(async (): Promise<void> => {
    if (!userId || unavailableRef.current) {
      return;
    }
    if (inFlightRef.current) {
      rerunRef.current = true;
      return;
    }

    inFlightRef.current = true;
    try {
      do {
        rerunRef.current = false;
        const client = await getSupabaseClient(),
          result = await syncTripArchives(client, userId);

        if (result.status === 'error') {
          // Loud in the console, silent in the UI: the list works regardless.
          // A lost connection and a fast device clock are not reported, for
          // the reasons `GuestGroupSync` gives.
          console.warn('[trip-archives] sync failed:', result.message);
          if (result.reason === 'unavailable') {
            // Not reported: it is a deploy to finish, not a fault on this
            // device (PostHog issue 01a1e38b).
            unavailableRef.current = true;
          } else if (result.reason === 'server') {
            reportError(new Error(result.message), { source: 'TripArchiveSync.sync' });
          }
          break;
        }
      } while (rerunRef.current);
    } catch (error: unknown) {
      // Loading the client is the one thing above that can throw.
      console.warn(
        '[trip-archives] could not run the sync:',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      inFlightRef.current = false;
    }
  }, [userId]);

  useEffect(() => {
    if (!userId || !isOnline || archiveKey === undefined) {
      return;
    }
    void run();
  }, [archiveKey, isOnline, run, userId]);

  useEffect(() => {
    if (!userId || !isOnline) {
      return;
    }

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        void run();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isOnline, run, userId]);

  return null;
}
