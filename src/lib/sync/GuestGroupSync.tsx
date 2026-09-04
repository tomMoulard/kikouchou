/**
 * @fileoverview Runs guest group sync, and hands the UI a way to ask for it.
 *
 * Groups are global, so this mounts once for the whole app rather than per
 * trip. It renders nothing and gates on the same three conditions the rest of
 * the sync layer does — no backend, nobody signed in, no network — none of
 * which is an error: the groups page is fully usable in all three.
 *
 * Sync is deliberately *not* driven by watching the table. A pull writes to the
 * very rows a `useLiveQuery` would be watching, so a change-driven sync feeds
 * itself. It runs instead at the three moments something can actually have
 * changed elsewhere or here: signing in, coming back online, and a local edit
 * calling `syncNow`.
 *
 * @module lib/sync/GuestGroupSync
 */
/* eslint-disable react-refresh/only-export-components -- The provider ships with the `useGuestGroupSync` hook its callers read; separating them would put a one-line context in its own module. */

import {
  type ReactElement,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useOnlineStatus } from '@/hooks';
import { useAuth } from '@/features/auth/AuthContext';
import { getSupabaseClient } from '@/lib/supabase/client';
import { syncGuestGroups, type GuestGroupSyncResult } from './guest-groups';

// ============================================================================
// Context
// ============================================================================

export interface GuestGroupSyncContextValue {
  /** The last attempt's outcome, or null before one has run. */
  readonly lastResult: GuestGroupSyncResult | null;
  /** Whether an attempt is in flight. */
  readonly isSyncing: boolean;
  /** Requests a sync. Safe to call when signed out — it becomes a no-op. */
  readonly syncNow: () => void;
}

const DEFAULT_VALUE: GuestGroupSyncContextValue = {
  lastResult: null,
  isSyncing: false,
  syncNow: () => undefined,
};

const GuestGroupSyncContext = createContext<GuestGroupSyncContextValue>(DEFAULT_VALUE);
GuestGroupSyncContext.displayName = 'GuestGroupSyncContext';

/**
 * Asks for the account's guest groups to be reconciled.
 *
 * Defaults to a no-op rather than throwing when no provider is mounted: "this
 * device does not sync groups" is the ordinary local-only case, and every
 * caller should behave identically for it.
 *
 * @returns The sync state and a `syncNow` trigger
 */
export function useGuestGroupSync(): GuestGroupSyncContextValue {
  return useContext(GuestGroupSyncContext);
}

// ============================================================================
// Component
// ============================================================================

interface GuestGroupSyncProps {
  readonly children: ReactNode;
}

/**
 * Mounts guest group sync for the whole app.
 *
 * @param props - Children to render underneath
 * @returns The provider wrapping its children
 */
export function GuestGroupSync({ children }: GuestGroupSyncProps): ReactElement {
  const { session } = useAuth(),
    { isOnline } = useOnlineStatus(),
    // The id, not the session object: the object is replaced on every token
    // refresh, and keying on it would re-sync on each one.
    userId = session?.user.id ?? null;

  const [lastResult, setLastResult] = useState<GuestGroupSyncResult | null>(null),
    [isSyncing, setIsSyncing] = useState(false);

  // Set on setup, not only in cleanup: StrictMode's mount → cleanup → mount
  // latches a cleanup-only ref `false` forever, turning every guarded setState
  // into a silent no-op (AGENTS.md § Unmount guards).
  const isMountedRef = useRef(false);
  // One attempt at a time. A second call while one is in flight would race the
  // same rows through two reconciliations.
  const inFlightRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const run = useCallback(async (): Promise<void> => {
    if (inFlightRef.current || !userId) {
      return;
    }

    inFlightRef.current = true;
    if (isMountedRef.current) {
      setIsSyncing(true);
    }

    try {
      const client = await getSupabaseClient(),
        result = await syncGuestGroups(client, userId);

      if (isMountedRef.current) {
        setLastResult(result);
      }
      if (result.status === 'error') {
        // Loud in the console, silent in the UI: the page works regardless, and
        // a toast on every failed background attempt would be noise.
        console.warn('[guest-groups] sync failed:', result.message);
      }
    } finally {
      inFlightRef.current = false;
      if (isMountedRef.current) {
        setIsSyncing(false);
      }
    }
  }, [userId]);

  const syncNow = useCallback((): void => {
    void run();
  }, [run]);

  // Sign-in and regaining the network are the two moments the account's copy
  // can have moved without this device knowing.
  useEffect(() => {
    if (!userId || !isOnline) {
      return;
    }
    void run();
  }, [userId, isOnline, run]);

  const value = useMemo<GuestGroupSyncContextValue>(
    () => ({ lastResult, isSyncing, syncNow }),
    [lastResult, isSyncing, syncNow],
  );

  return (
    <GuestGroupSyncContext.Provider value={value}>
      {children}
    </GuestGroupSyncContext.Provider>
  );
}
