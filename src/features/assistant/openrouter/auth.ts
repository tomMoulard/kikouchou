/**
 * @fileoverview Connects the assistant to the user's own OpenRouter account.
 *
 * ## Why OpenRouter, and not Anthropic or OpenAI directly
 *
 * The app has no server, so the sign-in has to finish in the browser with no
 * client secret. Neither model vendor offers that for a web page:
 *
 * - Anthropic's consumer terms reserve the OAuth tokens of a Claude plan for
 *   Claude Code and claude.ai (updated 2026-02-19). Any other app must use an
 *   API key.
 * - OpenAI's "Sign in with ChatGPT" for websites is a waitlisted, identity-only
 *   client: it returns who the user is and no token that can call a model. The
 *   flow that does reach the Responses API accepts only a `127.0.0.1` loopback
 *   redirect, which a web page cannot serve.
 *
 * OpenRouter runs a public PKCE flow: no app registration, no client secret,
 * open CORS on both the exchange and the chat endpoint. The user signs in on
 * openrouter.ai, and the exchange returns an API key that belongs to them,
 * billed to their account, which reaches the Claude and GPT models through one
 * API.
 *
 * ## Where the key lives
 *
 * In `localStorage`, on this device only. It never enters Dexie, so it is in
 * no export, no sync and no trip document. Holding it in memory alone would
 * mint a new key in the user's account on every reload. Disconnecting forgets
 * it here; the user revokes it on openrouter.ai.
 *
 * @module features/assistant/openrouter/auth
 */

import { createCodeChallenge, createCodeVerifier, createState } from './pkce';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * The request a redirect to OpenRouter is waiting on.
 *
 * In `localStorage` rather than `sessionStorage`: an installed Android app
 * opens openrouter.ai in a browser tab, and the callback lands in that tab, a
 * different session from the one that started the flow.
 */
export interface PendingOpenRouterConnect {
  readonly verifier: string;
  readonly state: string;
  /** Epoch milliseconds, so a stale request expires. */
  readonly createdAt: number;
}

/** What OpenRouter put on the callback URL. */
export interface OpenRouterCallback {
  readonly code: string;
  readonly state: string | null;
}

/** Why a callback did not end with a key. */
export type OpenRouterConnectFailure =
  | 'no-pending-request'
  | 'expired'
  | 'state-mismatch'
  | 'exchange-failed'
  | 'network'
  | 'storage-unavailable';

export type OpenRouterConnectResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: OpenRouterConnectFailure };

// ============================================================================
// Constants
// ============================================================================

/** Where the user signs in and approves the key. */
export const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth';

/** Where the authorization code is exchanged for the key. */
export const OPENROUTER_KEY_EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys';

/** The label OpenRouter prefills on the key, so the user can find it later. */
const KEY_LABEL = 'Kikouchou assistant';

export const OPENROUTER_KEY_STORAGE_KEY = 'kikouchou-openrouter-key';
export const OPENROUTER_PENDING_STORAGE_KEY = 'kikouchou-openrouter-pkce';

/**
 * How long a started sign-in stays valid. OpenRouter expires its code after
 * ten minutes; a little more covers a slow sign-in page.
 */
export const PENDING_CONNECT_TTL_MS = 15 * 60 * 1000;

/** A key is a short token. Anything longer is not one. */
const MAX_KEY_LENGTH = 512;

// ============================================================================
// Storage
// ============================================================================

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // Private mode or a full quota. The caller sees no key and offers the
    // sign-in again, which is the honest state.
  }
}

/**
 * The pending request, if one is stored and well formed.
 *
 * Read by the import-time callback capture too, so it must stay free of
 * anything but storage.
 */
export function readPendingConnect(): PendingOpenRouterConnect | null {
  const raw = readStorage(OPENROUTER_PENDING_STORAGE_KEY);
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as PendingOpenRouterConnect).verifier === 'string' &&
      typeof (parsed as PendingOpenRouterConnect).state === 'string' &&
      typeof (parsed as PendingOpenRouterConnect).createdAt === 'number'
    ) {
      return parsed as PendingOpenRouterConnect;
    }
  } catch {
    // Fall through: a corrupt entry is no request at all.
  }
  return null;
}

// ============================================================================
// Connection state, as an external store
// ============================================================================

const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

function handleStorageEvent(event: StorageEvent): void {
  if (event.key === null || event.key === OPENROUTER_KEY_STORAGE_KEY) {
    notifyListeners();
  }
}

/**
 * Subscribes to connection changes, for `useSyncExternalStore`.
 *
 * Also follows other tabs: the callback can land in a browser tab while the
 * installed app is the one on screen.
 */
export function subscribeOpenRouterConnection(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorageEvent);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', handleStorageEvent);
    }
  };
}

/** The user's OpenRouter key on this device, if they connected one. */
export function getOpenRouterKey(): string | null {
  const key = readStorage(OPENROUTER_KEY_STORAGE_KEY);
  return key !== null && key.length > 0 ? key : null;
}

/** Whether a key is stored. The snapshot `useSyncExternalStore` compares. */
export function isOpenRouterConnected(): boolean {
  return getOpenRouterKey() !== null;
}

/**
 * Forgets the key on this device. The key itself stays valid on OpenRouter
 * until the user revokes it there, which only its owner can do.
 */
export function disconnectOpenRouter(): void {
  writeStorage(OPENROUTER_KEY_STORAGE_KEY, null);
  notifyListeners();
}

// ============================================================================
// Flow
// ============================================================================

/**
 * Builds the authorization URL and stores what the callback will need.
 *
 * The caller navigates to the URL. It is returned rather than followed here so
 * this module never touches `window.location`.
 *
 * @param callbackUrl - Absolute URL OpenRouter sends the user back to
 * @param now - Clock, for tests
 * @returns The URL to navigate to
 */
export async function prepareOpenRouterConnect(
  callbackUrl: string,
  now: number = Date.now(),
): Promise<string> {
  const verifier = createCodeVerifier();
  const state = createState();
  const challenge = await createCodeChallenge(verifier);

  writeStorage(
    OPENROUTER_PENDING_STORAGE_KEY,
    JSON.stringify({ verifier, state, createdAt: now } satisfies PendingOpenRouterConnect),
  );

  const url = new URL(OPENROUTER_AUTH_URL);
  url.searchParams.set('callback_url', callbackUrl);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('key_label', KEY_LABEL);
  return url.toString();
}

/**
 * Finishes a sign-in: checks the callback against the stored request, then
 * exchanges the code for the key.
 *
 * The stored request is spent whatever happens, so a replayed callback finds
 * nothing to complete.
 *
 * @param callback - Code and state from the callback URL
 * @param fetchImpl - Injected for tests
 * @param now - Clock, for tests
 */
export async function completeOpenRouterConnect(
  callback: OpenRouterCallback,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<OpenRouterConnectResult> {
  const pending = readPendingConnect();
  writeStorage(OPENROUTER_PENDING_STORAGE_KEY, null);

  if (pending === null) {
    return { ok: false, reason: 'no-pending-request' };
  }
  if (now - pending.createdAt > PENDING_CONNECT_TTL_MS) {
    return { ok: false, reason: 'expired' };
  }
  // A missing state is refused like a wrong one: this flow always sends it.
  if (callback.state !== pending.state) {
    return { ok: false, reason: 'state-mismatch' };
  }

  let response: Response;
  try {
    response = await fetchImpl(OPENROUTER_KEY_EXCHANGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: callback.code,
        code_verifier: pending.verifier,
        code_challenge_method: 'S256',
      }),
    });
  } catch {
    return { ok: false, reason: 'network' };
  }

  if (!response.ok) {
    return { ok: false, reason: 'exchange-failed' };
  }

  let key: unknown;
  try {
    key = ((await response.json()) as { key?: unknown }).key;
  } catch {
    return { ok: false, reason: 'exchange-failed' };
  }

  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) {
    return { ok: false, reason: 'exchange-failed' };
  }

  writeStorage(OPENROUTER_KEY_STORAGE_KEY, key);
  if (getOpenRouterKey() !== key) {
    // Private mode or a full quota: the key exists on OpenRouter but nothing
    // here can hold it, and saying "connected" would be a lie on the next turn.
    return { ok: false, reason: 'storage-unavailable' };
  }
  notifyListeners();
  return { ok: true };
}
