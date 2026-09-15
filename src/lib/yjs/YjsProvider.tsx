/**
 * @fileoverview Puts the trip's document in context.
 *
 * Previously this also exposed a `y-webrtc` provider, its awareness and a peer
 * count. All three are gone with the transport: the server is the peer now, and
 * "is anyone else here" is answered by the sync badge rather than by WebRTC
 * awareness. What remains is the document and whether it has finished loading.
 *
 * @module lib/yjs/YjsProvider
 */
/* eslint-disable react-refresh/only-export-components -- The provider ships with its document hook and context type; splitting them would be three files for one concept. */

import {
  type ReactElement,
  type ReactNode,
  createContext,
  useContext,
  useMemo,
} from 'react';
import type * as Y from 'yjs';

import { useTripDoc } from './useTripDoc';
import type { TripId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

export interface YjsContextValue {
  readonly doc: Y.Doc;
  /** Whether the persisted updates have been replayed. */
  readonly loaded: boolean;
  readonly tripId: TripId | null;
}

// ============================================================================
// Context
// ============================================================================

const YjsContext = createContext<YjsContextValue | null>(null);
YjsContext.displayName = 'YjsContext';

// ============================================================================
// Provider
// ============================================================================

interface YjsProviderProps {
  readonly tripId: TripId | null | undefined;
  readonly children: ReactNode;
}

export function YjsProvider({ tripId, children }: YjsProviderProps): ReactElement {
  const { doc, loaded } = useTripDoc(tripId);

  const value = useMemo<YjsContextValue>(
    () => ({ doc, loaded, tripId: tripId ?? null }),
    [doc, loaded, tripId],
  );

  return <YjsContext.Provider value={value}>{children}</YjsContext.Provider>;
}

// ============================================================================
// Hooks
// ============================================================================

export function useYjsContext(): YjsContextValue | null {
  return useContext(YjsContext);
}

export function useRequiredYjsContext(): YjsContextValue {
  const context = useContext(YjsContext);
  if (!context) {
    throw new Error('useRequiredYjsContext must be used within a YjsProvider');
  }
  return context;
}

export { YjsContext };
