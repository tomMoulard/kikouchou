/**
 * @fileoverview Streams one chat completion from OpenRouter.
 *
 * Runs on the main thread, unlike the local engines: there is nothing to
 * compute here, only a `fetch` whose body arrives as server-sent events.
 * The contract matches the local workers so `useWebLLM` can treat the cloud
 * like one more engine: `onChunk` receives the **whole answer so far**, and an
 * interrupt resolves with what arrived rather than rejecting. The events are
 * read by `chat-stream`, which api.kikouchou.app's relay shares.
 *
 * @module features/assistant/openrouter/client
 */

import { isAbortError, readChatStream } from '../chat-stream';

// ============================================================================
// Type Definitions
// ============================================================================

/** One chat message, in the shape the API takes. */
export interface OpenRouterMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface OpenRouterChatRequest {
  readonly apiKey: string;
  /** OpenRouter model slug, e.g. `anthropic/claude-sonnet-5.5`. */
  readonly model: string;
  readonly messages: readonly OpenRouterMessage[];
  /** Origin of the app, sent as `HTTP-Referer` for OpenRouter's attribution. */
  readonly referer: string;
  readonly signal: AbortSignal;
  readonly onChunk?: (text: string) => void;
  readonly fetchImpl?: typeof fetch;
}

/** Why the request failed, so the page can say what to do about it. */
export type OpenRouterErrorKind =
  /** The key was revoked or never valid: the user has to connect again. */
  | 'unauthorized'
  /** The account has no credits left. */
  | 'insufficient-credits'
  | 'rate-limited'
  | 'network'
  | 'provider';

export class OpenRouterError extends Error {
  readonly kind: OpenRouterErrorKind;

  constructor(kind: OpenRouterErrorKind, message: string) {
    super(message);
    this.name = 'OpenRouterError';
    this.kind = kind;
  }
}

// ============================================================================
// Constants
// ============================================================================

export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** The name OpenRouter shows for this app in the user's activity log. */
const APP_TITLE = 'Kikouchou';

/**
 * Cap on one answer. Twice the local cap: a cloud model does not run out of GPU,
 * but an action block and a few sentences never need more, and the user pays
 * per token.
 */
const MAX_TOKENS = 2048;

// ============================================================================
// Helper Functions
// ============================================================================

function kindForStatus(status: number): OpenRouterErrorKind {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 402) return 'insufficient-credits';
  if (status === 429) return 'rate-limited';
  return 'provider';
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === 'string') return body.error.message;
  } catch {
    // Not JSON: fall back to the status line.
  }
  return `OpenRouter answered ${response.status}`;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Sends the conversation and streams the answer back.
 *
 * @returns The full answer, or what had arrived when `signal` aborted
 * @throws OpenRouterError for anything other than an abort
 */
export async function streamOpenRouterChat({
  apiKey,
  model,
  messages,
  referer,
  signal,
  onChunk,
  fetchImpl = fetch,
}: OpenRouterChatRequest): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': referer,
        'X-Title': APP_TITLE,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        max_tokens: MAX_TOKENS,
      }),
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) return '';
    throw new OpenRouterError('network', 'Could not reach OpenRouter.');
  }

  if (!response.ok) {
    throw new OpenRouterError(
      kindForStatus(response.status),
      await readErrorMessage(response),
    );
  }
  if (response.body === null) {
    throw new OpenRouterError('provider', 'OpenRouter sent an empty answer.');
  }

  return readChatStream(response.body, onChunk, {
    provider: (message) => new OpenRouterError('provider', message),
    dropped: () =>
      new OpenRouterError('network', 'The connection to OpenRouter dropped.'),
  });
}
