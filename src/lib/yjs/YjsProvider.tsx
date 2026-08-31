/**
 * @fileoverview Yjs context provider for P2P real-time collaboration.
 * @module lib/yjs/YjsProvider
 */
/* eslint-disable react-refresh/only-export-components */

import {
  type ReactElement,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import type * as Y from 'yjs';
import type { WebrtcProvider } from 'y-webrtc';

import { getPresenceProfile } from './presence';
import { useYjsSync, type YjsTransport } from './useYjsSync';

export interface OnlineUser {
  readonly clientId: number;
  readonly name: string;
  readonly color: string;
  readonly isLocal: boolean;
}

export interface YjsContextValue {
  readonly doc: Y.Doc;
  readonly provider: WebrtcProvider | null;
  readonly awareness: WebrtcProvider['awareness'] | null;
  /** Whether the provider is active (looking for peers). */
  readonly connected: boolean;
  /** Whether at least one signaling WebSocket is actually open. */
  readonly signalingConnected: boolean;
  readonly synced: boolean;
  readonly peerCount: number;
  readonly loaded: boolean;
  readonly roomId: string | null;
  readonly onlineUsers: readonly OnlineUser[];
}

const YjsContext = createContext<YjsContextValue | null>(null);
YjsContext.displayName = 'YjsContext';

interface YjsProviderProps {
  readonly roomId: string | null | undefined;
  readonly encryptionKey: string | null | undefined;
  readonly userName?: string;
  readonly userColor?: string;
  /** Defaults to the legacy WebRTC transport; `'none'` for server-synced trips. */
  readonly transport?: YjsTransport;
  readonly children: ReactNode;
}

function isAwarenessUser(value: unknown): value is { name?: unknown; color?: unknown } {
  return typeof value === 'object' && value !== null;
}

function readOnlineUsers(
  awareness: WebrtcProvider['awareness'] | null,
  clientId: number,
): readonly OnlineUser[] {
  if (!awareness) {
    return [];
  }

  return Array.from(awareness.getStates().entries())
    .flatMap(([stateClientId, state]) => {
      if (!isAwarenessUser(state)) {
        return [];
      }

      const name = typeof state.name === 'string' ? state.name : undefined;
      const color = typeof state.color === 'string' ? state.color : undefined;
      if (!name || !color) {
        return [];
      }

      return [{
        clientId: stateClientId,
        name,
        color,
        isLocal: stateClientId === clientId,
      } satisfies OnlineUser];
    })
    .sort((left, right) => {
      if (left.isLocal !== right.isLocal) {
        return left.isLocal ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
}

/**
 * Provides Yjs context to child components for P2P collaboration.
 */
export function YjsProvider({
  roomId,
  encryptionKey,
  userName,
  userColor,
  transport = 'webrtc',
  children,
}: YjsProviderProps): ReactElement {
  const { doc, provider, awareness, connected, signalingConnected, synced, peerCount, loaded } =
    useYjsSync(roomId, encryptionKey, transport);
  const onlineUsersSnapshotRef = useRef<{
    key: string;
    users: readonly OnlineUser[];
  }>({
    key: '',
    users: [],
  });

  const presenceProfile = useMemo(() => {
    const stored = getPresenceProfile();
    return {
      name: userName ?? stored.name,
      color: userColor ?? stored.color,
    };
  }, [userColor, userName]);

  const onlineUsers = useSyncExternalStore(
    (onStoreChange) => {
      if (!awareness) {
        return () => undefined;
      }

      awareness.on('change', onStoreChange);
      return () => {
        awareness.off('change', onStoreChange);
      };
    },
    () => {
      const nextUsers = readOnlineUsers(awareness, doc.clientID);
      const nextKey = JSON.stringify(nextUsers);
      const currentSnapshot = onlineUsersSnapshotRef.current;

      if (currentSnapshot.key === nextKey) {
        return currentSnapshot.users;
      }

      onlineUsersSnapshotRef.current = {
        key: nextKey,
        users: nextUsers,
      };

      return nextUsers;
    },
    () => [],
  );

  useEffect(() => {
    if (!awareness) {
      return;
    }

    awareness.setLocalState({
      name: presenceProfile.name,
      color: presenceProfile.color,
    });

    return () => {
      awareness.setLocalState(null);
    };
  }, [awareness, presenceProfile.color, presenceProfile.name]);

  const value = useMemo<YjsContextValue>(
    () => ({
      doc,
      provider,
      awareness,
      connected,
      signalingConnected,
      synced,
      peerCount,
      loaded,
      roomId: roomId ?? null,
      onlineUsers,
    }),
    [
      awareness,
      connected,
      doc,
      loaded,
      onlineUsers,
      peerCount,
      provider,
      roomId,
      signalingConnected,
      synced,
    ],
  );

  return <YjsContext.Provider value={value}>{children}</YjsContext.Provider>;
}

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
