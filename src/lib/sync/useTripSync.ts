/**
 * @fileoverview Mounts the sync provider for a trip, when there is one to mount.
 *
 * Every condition below is a reason *not* to sync, and none of them is an error:
 * no backend configured, nobody signed in, or a trip that has never been shared.
 * All three are the ordinary local-only mode, so this hook returns a `local`
 * status and does nothing at all — no client loaded, no request made.
 *
 * @module lib/sync/useTripSync
 */

import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';

import { getSupabaseClient } from '@/lib/supabase/client';
import { SupabaseYjsProvider, type SyncState } from './SupabaseYjsProvider';
import type { TripId } from '@/types';

// ============================================================================
// Constants
// ============================================================================

const LOCAL_STATE: SyncState = { status: 'local', pendingCount: 0, onlineCount: null };

/** Reported between mounting a provider and its first status callback. */
const STARTING_STATE: SyncState = { status: 'syncing', pendingCount: 0, onlineCount: null };

// ============================================================================
// Hook
// ============================================================================

export interface UseTripSyncOptions {
  readonly doc: Y.Doc | null | undefined;
  readonly tripId: TripId | null | undefined;
  /** Server `trips.id`, absent until the trip has been shared. */
  readonly remoteTripId: string | null | undefined;
  /** Whether a session exists. Sync is pointless without one. */
  readonly isSignedIn: boolean;
  /** The signed-in account, so presence counts people rather than tabs. */
  readonly userId?: string | null | undefined;
}

/**
 * @returns The trip's sync state, and a `syncNow` for a manual retry.
 */
export function useTripSync({
  doc,
  tripId,
  remoteTripId,
  isSignedIn,
  userId,
}: UseTripSyncOptions): {
  readonly state: SyncState;
  readonly syncNow: () => void;
} {
  const canSync = Boolean(doc && tripId && remoteTripId && isSignedIn);

  /**
   * Identifies which provider a stored status belongs to.
   *
   * Without it, switching trips would briefly report the previous trip's status
   * — including a stale "offline" — until the new provider's first callback.
   */
  const syncKey = canSync ? `${String(tripId)}:${String(remoteTripId)}` : null;

  const [reported, setReported] = useState<{
    key: string;
    state: SyncState;
  } | null>(null);

  const providerRef = useRef<SupabaseYjsProvider | null>(null);
  const isMountedRef = useRef(true);

  /**
   * Derived, never stored for the not-syncing case.
   *
   * "This trip does not sync" follows entirely from the inputs, so writing it
   * into state from an effect would be a cascading render for no information —
   * and the eslint rule that flags it is right.
   */
  const state: SyncState =
    syncKey !== null && reported?.key === syncKey
      ? reported.state
      : canSync
        ? STARTING_STATE
        : LOCAL_STATE;

  useEffect(() => {
    // Set on setup, not only in cleanup: StrictMode's dev-time
    // mount -> cleanup -> mount cycle would otherwise latch this false forever,
    // turning every guarded setState into a silent no-op.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!doc || !tripId || !remoteTripId || !isSignedIn || syncKey === null) {
      // Nothing to mount, and nothing to record: `state` above already reads
      // as local.
      return;
    }

    const activeKey = syncKey;
    let cancelled = false;
    let provider: SupabaseYjsProvider | null = null;

    const attach = async (): Promise<void> => {
      const client = await getSupabaseClient();
      if (cancelled || !client) {
        return;
      }

      provider = new SupabaseYjsProvider({
        client,
        doc,
        tripId,
        remoteTripId,
        // Conditional rather than `userId: userId ?? undefined`, because
        // `exactOptionalPropertyTypes` distinguishes absent from undefined.
        ...(typeof userId === 'string' && userId.length > 0 ? { userId } : {}),
        onStateChange: (next) => {
          if (!cancelled && isMountedRef.current) {
            setReported({ key: activeKey, state: next });
          }
        },
      });
      providerRef.current = provider;

      // Unmounted while the client chunk was loading: tear down rather than
      // leaving a provider holding the document and a Realtime channel.
      if (cancelled) {
        provider.destroy();
        providerRef.current = null;
        provider = null;
        return;
      }

      await provider.start();
    };

    void attach().catch((error: unknown) => {
      console.error('[sync] failed to start the provider:', error);
    });

    return () => {
      cancelled = true;
      provider?.destroy();
      if (providerRef.current === provider) {
        providerRef.current = null;
      }
    };
  }, [doc, isSignedIn, remoteTripId, tripId, syncKey, userId]);

  // Coming back to the tab is the cheapest signal that time has passed and the
  // log may have moved on. The provider also listens for `online` itself.
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const onVisible = (): void => {
      if (document.visibilityState === 'visible') {
        void providerRef.current?.syncNow();
      }
    };

    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return {
    state,
    syncNow: () => {
      void providerRef.current?.syncNow();
    },
  };
}
