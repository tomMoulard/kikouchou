/**
 * @fileoverview Trips this account belongs to that are not on this device.
 *
 * Without this, joining a trip on a phone and then opening the app on a laptop
 * shows nothing — the membership exists server-side but the laptop has no local
 * `Trip` row, so there is nothing to render and no way in.
 *
 * Deliberately additive: it never touches or removes local trips. A trip absent
 * from the server is a local-only trip, which is the ordinary case and not a
 * deletion to reconcile.
 *
 * @module features/trips/hooks/useRemoteTrips
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/features/auth/AuthContext';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { getSupabaseClient } from '@/lib/supabase/client';
import { downloadTripDocument } from '@/lib/sync/download-document';
import { materialiseJoinedTrip } from '@/lib/sync/join-trip';
import { listRemoteTripsMissingLocally } from '@/lib/sync/remote-trip';
import type { TripId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

export interface RemoteOnlyTrip {
  readonly id: string;
  readonly name: string;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * @param localTripCount - Recomputes when the local list changes, so a trip
 *   just downloaded disappears from the "elsewhere" list without a reload.
 */
export function useRemoteTrips(localTripCount: number): {
  readonly remoteOnly: readonly RemoteOnlyTrip[];
  /** Downloads one, returning its new local id. */
  readonly download: (remoteTripId: string) => Promise<TripId | null>;
  readonly isDownloading: string | null;
  /**
   * True while the answer is still unknown.
   *
   * The section below a trip list does not need this — an empty list renders
   * as nothing, and rows appearing a moment later is the whole point. What
   * needs it is a caller that must act on "there is nothing anywhere", such as
   * the root redirect in `pages/TripsEntryRedirect`: for that one, an empty
   * array before the lookup has answered and an empty array after it are two
   * different facts.
   *
   * Signed out or offline it is false from the first effect: there is nothing
   * to look up, and that is an answer rather than a wait.
   */
  readonly isChecking: boolean;
} {
  const { session } = useAuth();
  const { isOnline } = useOnlineStatus();
  const [remoteOnly, setRemoteOnly] = useState<readonly RemoteOnlyTrip[]>([]);
  const [isDownloading, setIsDownloading] = useState<string | null>(null);
  /** True until the first effect below settles — see the return type. */
  const [isChecking, setIsChecking] = useState(true);
  const isMountedRef = useRef(true);

  useEffect(() => {
    // Set on setup, not only in cleanup: StrictMode's dev-time
    // mount -> cleanup -> mount cycle would otherwise latch this false forever.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!session || !isOnline) {
      // Signed out or offline: there is nothing to add, and the local list is
      // still perfectly renderable.
      setRemoteOnly([]);
      setIsChecking(false);
      return;
    }

    let cancelled = false;

    setIsChecking(true);
    void (async () => {
      try {
        const client = await getSupabaseClient();
        if (cancelled || !client || !isMountedRef.current) {
          return;
        }
        const missing = await listRemoteTripsMissingLocally(client);
        if (!cancelled && isMountedRef.current) {
          setRemoteOnly(missing);
        }
      } catch (err) {
        // Logged rather than thrown: an unreachable server is the ordinary
        // reason this fails, the local list renders without it, and an
        // unhandled rejection here would be the only thing anybody saw.
        console.error('[trips] failed to list the trips this account has elsewhere:', err);
      } finally {
        // In a `finally` so a failed lookup ends the wait too: a caller that
        // blocks on `isChecking` must not block forever because the client
        // could not be built or the query threw.
        if (!cancelled && isMountedRef.current) {
          setIsChecking(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOnline, localTripCount, session]);

  const download = useCallback(
    async (remoteTripId: string): Promise<TripId | null> => {
      setIsDownloading(remoteTripId);
      try {
        const client = await getSupabaseClient();
        if (!client) {
          return null;
        }
        const result = await materialiseJoinedTrip(client, remoteTripId);
        if (result.status === 'error') {
          console.error('[trips] failed to download a joined trip:', result.message);
          return null;
        }

        // The row is a name and two dates; the guests, the place and the map are
        // in the document. Without this the button puts a card on the list that
        // stays half-empty until the trip is opened, which is not what *Download*
        // says it does. A failure here is not a failed download: the trip is on
        // the device and opening it still hydrates it the old way.
        const hydrated = await downloadTripDocument(client, result.tripId, remoteTripId);
        if (hydrated.status === 'error') {
          console.warn('[trips] downloaded a trip without its document:', hydrated.message);
        }
        // Drop it from the "elsewhere" list straight away rather than waiting
        // for the effect to re-run.
        if (isMountedRef.current) {
          setRemoteOnly((current) => current.filter((trip) => trip.id !== remoteTripId));
        }
        return result.tripId;
      } finally {
        if (isMountedRef.current) {
          setIsDownloading(null);
        }
      }
    },
    [],
  );

  return { remoteOnly, download, isDownloading, isChecking };
}
