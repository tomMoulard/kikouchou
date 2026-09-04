/**
 * @fileoverview Binds the sync provider to the document React already has.
 *
 * Sits inside the Yjs provider tree so it can take the live `Y.Doc` from
 * context rather than creating a second one — two documents for one trip would
 * both persist to the same IndexedDB rows and fight.
 *
 * Renders nothing. The status it produces is published through
 * {@link SyncStatusContext} for the badge to read.
 *
 * @module lib/sync/SupabaseTripSync
 */
/* eslint-disable react-refresh/only-export-components -- The provider ships with the `SyncStatusContext` its badge reads; separating them would put a one-line context in its own module. */

import {
  type ReactElement,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';

import { useTripContext } from '@/contexts/TripContext';
import { useAuth } from '@/features/auth/AuthContext';
import posthog from '@/lib/posthog';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useYjsContext } from '@/lib/yjs/YjsProvider';
import { syncRemoteTripMetadata } from './remote-trip';
import type { SyncState } from './SupabaseYjsProvider';
import { useTripSync } from './useTripSync';
import type { TripId } from '@/types';

// ============================================================================
// Context
// ============================================================================

export interface SyncStatusContextValue {
  readonly state: SyncState;
  readonly syncNow: () => void;
}

const LOCAL_STATE: SyncState = { status: 'local', pendingCount: 0, onlineCount: null };

const SyncStatusContext = createContext<SyncStatusContextValue>({
  state: LOCAL_STATE,
  syncNow: () => undefined,
});
SyncStatusContext.displayName = 'SyncStatusContext';

/**
 * The current trip's sync state.
 *
 * Defaults to `local` rather than throwing when no provider is mounted, because
 * "this trip does not sync" is the ordinary case for an unshared trip and every
 * caller should render the same way for it.
 */
export function useSyncStatus(): SyncStatusContextValue {
  return useContext(SyncStatusContext);
}

// ============================================================================
// Component
// ============================================================================

interface SupabaseTripSyncProps {
  readonly tripId: TripId;
  /** Server `trips.id`, absent until the trip has been shared. */
  readonly remoteTripId: string | undefined;
  readonly children: ReactNode;
}

export function SupabaseTripSync({
  tripId,
  remoteTripId,
  children,
}: SupabaseTripSyncProps): ReactElement {
  const yjs = useYjsContext();
  const { session } = useAuth();
  // The id, not the session object: the object is replaced on every token
  // refresh and would remount the provider each time.
  const userId = session?.user.id ?? null;

  const { state, syncNow } = useTripSync({
    // `loaded` gates on the document having replayed its persisted updates.
    // Starting before that would diff a half-built document against the server
    // and push a deletion of everything not yet replayed.
    doc: yjs?.loaded ? yjs.doc : null,
    tripId,
    remoteTripId: remoteTripId ?? null,
    isSignedIn: session !== null,
    userId,
  });

  // Keep the server's denormalised preview in step with the document.
  //
  // The trip list on another device renders name and dates before the document
  // has downloaded, so without this a renamed trip shows its old name there
  // until that device hydrates. Cosmetic, and deliberately fire-and-forget: a
  // stale preview must never hold up an edit.
  const { currentTrip } = useTripContext();
  const previewKey =
    currentTrip && currentTrip.id === tripId && remoteTripId !== undefined
      ? `${currentTrip.name}|${currentTrip.startDate}|${currentTrip.endDate}`
      : null;

  useEffect(() => {
    if (previewKey === null || !currentTrip) {
      return;
    }
    let cancelled = false;

    void (async () => {
      const client = await getSupabaseClient();
      if (cancelled) {
        return;
      }
      await syncRemoteTripMetadata(client, currentTrip);
    })();

    return () => {
      cancelled = true;
    };
    // Keyed on the three fields the preview holds, so an unrelated edit — a room,
    // a guest — does not fire a pointless update.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Keyed on `previewKey` deliberately, for the reason directly above.
  }, [previewKey]);

  /**
   * Reports sync falling over and coming back, on the transition only.
   *
   * Transitions rather than states, because a state would fire on every
   * re-render and drown the project. `status` only changes when something a user
   * could notice changed, so this is a handful of events per session at most.
   *
   * Worth having because sync failing is invisible from the outside: the app
   * keeps working offline by design, so a person whose changes never reach
   * anybody looks exactly like a person who is simply editing.
   */
  const lastStatusRef = useRef<SyncState['status'] | null>(null);
  useEffect(() => {
    const previous = lastStatusRef.current;
    lastStatusRef.current = state.status;

    if (previous === null || previous === state.status) {
      return;
    }
    if (state.status === 'offline') {
      posthog?.capture('trip_sync_offline', { pending_count: state.pendingCount });
      return;
    }
    if (previous === 'offline' && state.status === 'synced') {
      posthog?.capture('trip_sync_recovered', { pending_count: state.pendingCount });
    }
  }, [state.status, state.pendingCount]);

  const value = useMemo<SyncStatusContextValue>(
    () => ({ state, syncNow }),
    [state, syncNow],
  );

  return (
    <SyncStatusContext.Provider value={value}>{children}</SyncStatusContext.Provider>
  );
}
