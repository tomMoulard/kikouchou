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
/* eslint-disable react-refresh/only-export-components */

import {
  type ReactElement,
  type ReactNode,
  createContext,
  useContext,
  useMemo,
} from 'react';

import { useAuth } from '@/features/auth/AuthContext';
import { useYjsContext } from '@/lib/yjs/YjsProvider';
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

const LOCAL_STATE: SyncState = { status: 'local', pendingCount: 0 };

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

  const { state, syncNow } = useTripSync({
    // `loaded` gates on the document having replayed its persisted updates.
    // Starting before that would diff a half-built document against the server
    // and push a deletion of everything not yet replayed.
    doc: yjs?.loaded ? yjs.doc : null,
    tripId,
    remoteTripId: remoteTripId ?? null,
    isSignedIn: session !== null,
  });

  const value = useMemo<SyncStatusContextValue>(
    () => ({ state, syncNow }),
    [state, syncNow],
  );

  return (
    <SyncStatusContext.Provider value={value}>{children}</SyncStatusContext.Provider>
  );
}
