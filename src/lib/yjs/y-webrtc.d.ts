declare module 'y-webrtc' {
  import type * as Y from 'yjs';

  export interface AwarenessLike {
    readonly clientID: number;
    setLocalState(state: unknown): void;
    setLocalStateField(field: string, value: unknown): void;
    getStates(): Map<number, unknown>;
    on(eventName: 'change', listener: (event: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => void): void;
    on(eventName: 'update', listener: (event: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => void): void;
    off(eventName: 'change', listener: (event: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => void): void;
    off(eventName: 'update', listener: (event: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => void): void;
  }

  export interface WebrtcProviderStatusEvent {
    connected: boolean;
  }

  export interface WebrtcProviderSyncedEvent {
    synced: boolean;
  }

  export interface WebrtcProviderPeersEvent {
    added: string[];
    removed: string[];
    webrtcPeers: string[];
    bcPeers: string[];
  }

  export interface WebrtcProviderOptions {
    signaling?: string[];
    password?: string | null;
    awareness?: AwarenessLike;
    maxConns?: number;
    filterBcConns?: boolean;
    peerOpts?: Record<string, unknown>;
  }

  export class WebrtcProvider {
    constructor(roomName: string, doc: Y.Doc, opts?: WebrtcProviderOptions);

    readonly roomName: string;
    readonly doc: Y.Doc;
    readonly awareness: AwarenessLike;
    readonly connected: boolean;

    connect(): void;
    disconnect(): void;
    destroy(): void;

    on(eventName: 'status', listener: (event: WebrtcProviderStatusEvent) => void): void;
    on(eventName: 'synced', listener: (event: WebrtcProviderSyncedEvent) => void): void;
    on(eventName: 'peers', listener: (event: WebrtcProviderPeersEvent) => void): void;

    off(eventName: 'status', listener: (event: WebrtcProviderStatusEvent) => void): void;
    off(eventName: 'synced', listener: (event: WebrtcProviderSyncedEvent) => void): void;
    off(eventName: 'peers', listener: (event: WebrtcProviderPeersEvent) => void): void;
  }
}
