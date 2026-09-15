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
} {
  const { session } = useAuth();
  const { isOnline } = useOnlineStatus();
  const [remoteOnly, setRemoteOnly] = useState<readonly RemoteOnlyTrip[]>([]);
  const [isDownloading, setIsDownloading] = useState<string | null>(null);
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
      return;
    }

    let cancelled = false;

    void (async () => {
      const client = await getSupabaseClient();
      if (cancelled || !client || !isMountedRef.current) {
        return;
      }
      const missing = await listRemoteTripsMissingLocally(client);
      if (!cancelled && isMountedRef.current) {
        setRemoteOnly(missing);
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

  return { remoteOnly, download, isDownloading };
}
