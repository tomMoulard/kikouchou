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

export function resolveSignalingServer(): string {
  if (import.meta.env.VITE_SIGNALING_URL) {
    return import.meta.env.VITE_SIGNALING_URL;
  }

  if (typeof window !== 'undefined') {
    const { hostname } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return `ws://${hostname}:4444`;
    }
  }

  return 'wss://kikoushou.cyprin.eu';
}

/**
 * Introspects the internal signaling connections of a WebrtcProvider to
 * determine whether the WebSocket to the signaling server is actually open.
 *
 * y-webrtc's `provider.connected` only means "the provider is looking for
 * peers", not that the underlying WebSocket is established. This helper
 * reads the real WebSocket readyState so the UI can display accurate status.
 */
function isSignalingConnected(provider: WebrtcProvider): boolean {
  const conns = (provider as unknown as { signalingConns?: { ws?: WebSocket | null; connected?: boolean }[] })
    .signalingConns;
  if (!conns || conns.length === 0) {
    return false;
  }
  return conns.some((conn) => conn.connected === true);
}

export interface YjsSyncState {
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
}

function createInitialState(): YjsSyncState {
  return {
    doc: new Y.Doc(),
    provider: null,
    awareness: null,
    connected: false,
    signalingConnected: false,
    synced: false,
    peerCount: 0,
    loaded: false,
  };
}

/**
 * Which network transport backs the document.
 *
 * `'webrtc'` is the legacy peer-to-peer path, retired in Phase 8 of the sync
 * migration. `'none'` keeps the document and its IndexedDB persistence but opens
 * no connection, which is what a trip synced through the server wants: running
 * both transports would converge correctly but do the work twice.
 */
export type YjsTransport = 'webrtc' | 'none';

export function useYjsSync(
  roomId: string | null | undefined,
  encryptionKey: string | null | undefined,
  transport: YjsTransport = 'webrtc',
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

    let signalingPollTimer: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      if (signalingPollTimer !== null) {
        clearInterval(signalingPollTimer);
        signalingPollTimer = null;
      }
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

      if (transport === 'none') {
        // The document is live and persisted; something else owns the network.
        setState({
          doc,
          provider: null,
          awareness: null,
          connected: false,
          signalingConnected: false,
          synced: false,
          peerCount: 0,
          loaded: true,
        });
        return;
      }

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

      // y-webrtc does not emit events when the signaling WebSocket opens or
      // closes, so we poll the internal connection state every 2 s to keep the
      // UI accurate.  The interval is cheap (a few property reads) and is
      // cleaned up when the effect unmounts.
      signalingPollTimer = setInterval(() => {
        if (cancelled) {
          return;
        }
        const next = isSignalingConnected(provider);
        setState((current) => {
          if (current.signalingConnected === next) {
            return current;
          }
          return { ...current, signalingConnected: next };
        });
      }, 2_000);

      setState({
        doc,
        provider,
        awareness: provider.awareness,
        connected: provider.connected,
        signalingConnected: isSignalingConnected(provider),
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
  }, [roomId, encryptionKey, transport]);

  return state;
}
