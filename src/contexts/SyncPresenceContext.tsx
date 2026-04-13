/**
 * @fileoverview Yjs / P2P awareness count for UI in {@link Layout} (sidebar + mobile header).
 *
 * @module contexts/SyncPresenceContext
 */

import {
  createContext,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

// ============================================================================
// Types
// ============================================================================

export interface SyncPresenceContextValue {
  /** Connected awareness peers (including this client when listed). */
  readonly onlineCount: number;
  readonly setOnlineCount: (count: number) => void;
}

// ============================================================================
// Context
// ============================================================================

const SyncPresenceContext = createContext<SyncPresenceContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

/**
 * Wraps the app so Yjs bindings can push peer counts and {@link Layout} can read them.
 */
export function SyncPresenceProvider({
  children,
}: {
  readonly children: ReactNode;
}): ReactElement {
  const [onlineCount, setOnlineCountState] = useState(0);
  const setOnlineCount = useCallback((count: number) => {
    setOnlineCountState(count < 0 ? 0 : count);
  }, []);

  const value = useMemo(
    (): SyncPresenceContextValue => ({
      onlineCount,
      setOnlineCount,
    }),
    [onlineCount, setOnlineCount],
  );

  return (
    <SyncPresenceContext.Provider value={value}>{children}</SyncPresenceContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

/**
 * @returns Presence state, or `null` if used outside {@link SyncPresenceProvider}.
 */
export function useSyncPresence(): SyncPresenceContextValue | null {
  return useContext(SyncPresenceContext);
}
