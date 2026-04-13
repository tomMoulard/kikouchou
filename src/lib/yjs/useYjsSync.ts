/**
 * @fileoverview React hook that manages a Y.Doc with y-webrtc
 * and Dexie persistence for a given P2P room.
 *
 * @module lib/yjs/useYjsSync
 */

import { useEffect, useRef, useState } from 'react';
import { WebrtcProvider } from 'y-webrtc';
import * as Y from 'yjs';

import { loadPersistedUpdates, subscribeToUpdates } from './dexie-bridge';

function resolveSignalingServer(): string {
  if (import.meta.env.VITE_SIGNALING_URL) {
    return import.meta.env.VITE_SIGNALING_URL;
  }

  if (typeof window !== 'undefined') {
    const { hostname } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return `ws://${hostname}:4444`;
    }
  }

  return 'wss://signaling.kikoushou.app';
}

export interface YjsSyncState {
  readonly doc: Y.Doc;
  readonly provider: WebrtcProvider | null;
  readonly awareness: WebrtcProvider['awareness'] | null;
  readonly connected: boolean;
  readonly synced: boolean;
  readonly peerCount: number;
  readonly loaded: boolean;
}

function createInitialState(): YjsSyncState {
  return {
    doc: new Y.Doc(),
    provider: null,
    awareness: null,
    connected: false,
    synced: false,
    peerCount: 0,
    loaded: false,
  };
}

export function useYjsSync(
  roomId: string | null | undefined,
  encryptionKey: string | null | undefined,
): YjsSyncState {
  const [state, setState] = useState<YjsSyncState>(() => createInitialState());
  const providerRef = useRef<WebrtcProvider | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const docRef = useRef<Y.Doc | null>(null);

  useEffect(() => {
    if (!roomId || !encryptionKey) {
      return undefined;
    }

    let cancelled = false;
    const activeRoomId = roomId;
    const activeKey = encryptionKey;
    const doc = new Y.Doc();
    docRef.current = doc;

    const cleanup = () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      providerRef.current?.destroy();
      providerRef.current = null;
      docRef.current?.destroy();
      docRef.current = null;
      setState(createInitialState());
    };

    const initialize = async (): Promise<void> => {
      await loadPersistedUpdates(doc, activeRoomId);
      if (cancelled) {
        doc.destroy();
        return;
      }

      unsubscribeRef.current = subscribeToUpdates(doc, activeRoomId);

      const provider = new WebrtcProvider(activeRoomId, doc, {
        signaling: [resolveSignalingServer()],
        password: activeKey,
      });
      providerRef.current = provider;

      provider.on('status', ({ connected }: { connected: boolean }) => {
        if (!cancelled) {
          setState((current) => ({ ...current, connected }));
        }
      });
      provider.on('synced', ({ synced }: { synced: boolean }) => {
        if (!cancelled) {
          setState((current) => ({ ...current, synced }));
        }
      });
      provider.on('peers', ({ webrtcPeers, bcPeers }: { webrtcPeers: string[]; bcPeers: string[] }) => {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            peerCount: webrtcPeers.length + bcPeers.length,
          }));
        }
      });

      setState({
        doc,
        provider,
        awareness: provider.awareness,
        connected: provider.connected,
        synced: false,
        peerCount: 0,
        loaded: true,
      });
    };

    void initialize().catch((error: unknown) => {
      console.error('[useYjsSync] Failed to initialize Yjs sync:', error);
      cleanup();
    });

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [roomId, encryptionKey]);

  return state;
}
