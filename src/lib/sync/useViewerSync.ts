/**
 * @fileoverview Keeps an open viewer trip current, pull only.
 *
 * The member counterpart is `useTripSync`, which mounts `SupabaseYjsProvider`:
 * Realtime, an outbox, reconciliation in both directions. None of that applies
 * to a trip read through an invite link. There is nothing to send, Realtime is
 * closed to `anon`, and a read-only page does not need sub-second delivery —
 * so this pulls on the three moments a viewer notices staleness: when the trip
 * opens, when the tab comes back, and when the network does.
 *
 * It publishes the same `SyncState` shape the badge already reads, with
 * `readOnly` set, so the header says "read-only copy" rather than promising a
 * two-way sync that is not happening.
 *
 * @module lib/sync/useViewerSync
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';

import { getSupabaseClient } from '@/lib/supabase/client';
import type { SyncState } from './SupabaseYjsProvider';
import { refreshViewerTrip } from './viewer';
import type { TripId } from '@/types';

// ============================================================================
// Constants
// ============================================================================

const LOCAL_STATE: SyncState = { status: 'local', pendingCount: 0, onlineCount: null };

/** Reported between mounting and the first refresh settling. */
const STARTING_STATE: SyncState = {
  status: 'syncing',
  pendingCount: 0,
  onlineCount: null,
  readOnly: true,
};

// ============================================================================
// Hook
// ============================================================================

export interface UseViewerSyncOptions {
  readonly doc: Y.Doc | null | undefined;
  readonly tripId: TripId | null | undefined;
  /** The invite token the trip is read through. */
  readonly viewerToken: string | null | undefined;
  /** Off for a member trip, so nothing here runs or is reported. */
  readonly enabled: boolean;
}

/**
 * @returns The viewer trip's sync state, and a `syncNow` for a manual retry.
 */
export function useViewerSync({
  doc,
  tripId,
  viewerToken,
  enabled,
}: UseViewerSyncOptions): {
  readonly state: SyncState;
  readonly syncNow: () => void;
} {
  const active = enabled && Boolean(doc && tripId && viewerToken);

  /**
   * Tagged with the trip it was reported for, like `useTripSync`: switching
   * trips must not briefly show the previous trip's state under the new one.
   */
  const [reported, setReported] = useState<{ key: string; state: SyncState } | null>(null);
  const key = active ? `${String(tripId)}:${String(viewerToken)}` : null;

  const refreshingRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    // Set on setup, not only in cleanup: StrictMode's dev-time
    // mount -> cleanup -> mount cycle would otherwise latch this false forever.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (!doc || !tripId || !viewerToken || key === null) {
      return;
    }
    // Overlapping refreshes would apply the same pages twice — harmless for
    // Yjs, wasteful for the network, and confusing for the status.
    if (refreshingRef.current) {
      return;
    }
    refreshingRef.current = true;

    const publish = (state: SyncState): void => {
      if (isMountedRef.current) {
        setReported({ key, state });
      }
    };

    try {
      const client = await getSupabaseClient();
      if (!client) {
        publish({ ...STARTING_STATE, status: 'offline', lastError: 'no backend' });
        return;
      }

      const result = await refreshViewerTrip(client, doc, tripId, viewerToken);
      if (result.status === 'updated' || result.status === 'current') {
        publish({ ...STARTING_STATE, status: 'synced', lastSyncedAt: Date.now() });
        return;
      }
      // A dead token or no network: the local copy stays readable, and the
      // badge says the copy is not being refreshed rather than lying about it.
      publish({
        ...STARTING_STATE,
        status: 'offline',
        lastError: result.status === 'error' ? result.message : result.status,
      });
    } finally {
      refreshingRef.current = false;
    }
  }, [doc, key, tripId, viewerToken]);

  useEffect(() => {
    if (!active) {
      return;
    }
    void refresh();

    // Coming back to the tab, or back online, is the cheapest signal that time
    // has passed and the members may have changed something.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [active, refresh]);

  const state: SyncState =
    key !== null && reported?.key === key
      ? reported.state
      : active
        ? STARTING_STATE
        : LOCAL_STATE;

  return {
    state,
    syncNow: () => {
      void refresh();
    },
  };
}
