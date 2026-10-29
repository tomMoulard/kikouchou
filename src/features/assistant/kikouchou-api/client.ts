/**
 * @fileoverview Streams one chat completion from api.kikouchou.app.
 *
 * The `kikouchou` engine: the project's own server answers, on the project's
 * OpenRouter key, for a signed-in account (`server/assistant-api`). The
 * request carries the Supabase access token and the messages, nothing else.
 * The server picks the model and caps the answer, so a client cannot spend
 * the project's key on something dearer. Its answer is OpenRouter's stream,
 * relayed, and `chat-stream` reads it.
 *
 * @module features/assistant/kikouchou-api/client
 */

import { getSupabaseClient } from '@/lib/supabase/client';

import { isAbortError, readChatStream } from '../chat-stream';

// ============================================================================
// Type Definitions
// ============================================================================

/** One chat message, in the shape the API takes. */
export interface KikouchouApiMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface KikouchouChatRequest {
  readonly messages: readonly KikouchouApiMessage[];
  readonly signal: AbortSignal;
  readonly onChunk?: (text: string) => void;
  /** Supplies the access token; the signed-in session's by default. */
  readonly getAccessToken?: () => Promise<string | null>;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Why the request failed. The server's statuses are documented in
 * `server/assistant-api/src/app.rs`.
 */
export type KikouchouApiErrorKind =
  /** No session on this device, or one the server could not verify. */
  | 'unauthorized'
  /** The account spent today's allowance. */
  | 'daily-limit'
  /** The server could not check the account or the quota right now. */
  | 'unavailable'
  | 'network'
  | 'provider';

export class KikouchouApiError extends Error {
  readonly kind: KikouchouApiErrorKind;

  constructor(kind: KikouchouApiErrorKind, message: string) {
    super(message);
    this.name = 'KikouchouApiError';
    this.kind = kind;
  }
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Where the API answers. `VITE_ASSISTANT_API_URL` points a build at another
 * deploy; the production origin is the default, like `VITE_SHARE_ORIGIN`'s.
 */
export const KIKOUCHOU_CHAT_URL = `${(
  import.meta.env.VITE_ASSISTANT_API_URL || 'https://api.kikouchou.app'
).replace(/\/+$/, '')}/v1/chat/completions`;

// ============================================================================
// Helper Functions
// ============================================================================

function kindForStatus(status: number): KikouchouApiErrorKind {
  // 403 is an anonymous session: for the user, signing in is the answer to
  // both.
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'daily-limit';
  if (status === 503) return 'unavailable';
  return 'provider';
}

/** The signed-in session's access token, refreshed by supabase-js if due. */
export async function readAccessToken(): Promise<string | null> {
  const client = await getSupabaseClient();
  if (client === null) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Sends the conversation and streams the answer back.
 *
 * @returns The full answer, or what had arrived when `signal` aborted
 * @throws KikouchouApiError for anything other than an abort
 */
export async function streamKikouchouChat({
  messages,
  signal,
  onChunk,
  getAccessToken = readAccessToken,
  fetchImpl = fetch,
}: KikouchouChatRequest): Promise<string> {
  const token = await getAccessToken();
  if (token === null) {
    throw new KikouchouApiError('unauthorized', 'Sign in to use this model.');
  }

  let response: Response;
  try {
    response = await fetchImpl(KIKOUCHOU_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages }),
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) return '';
    throw new KikouchouApiError('network', 'Could not reach the Kikouchou server.');
  }

  if (!response.ok) {
    throw new KikouchouApiError(
      kindForStatus(response.status),
      `The Kikouchou server answered ${response.status}`,
    );
  }
  if (response.body === null) {
    throw new KikouchouApiError('provider', 'The Kikouchou server sent an empty answer.');
  }

  return readChatStream(response.body, onChunk, {
    provider: (message) => new KikouchouApiError('provider', message),
    dropped: () =>
      new KikouchouApiError('network', 'The connection to the Kikouchou server dropped.'),
  });
}
