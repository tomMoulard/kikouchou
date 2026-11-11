/**
 * @fileoverview Reads a streamed chat completion, in the OpenAI event format.
 *
 * api.kikouchou.app relays OpenRouter's stream unchanged, in that format.
 *
 * `onChunk` receives the **whole answer so far**, and an abort resolves with
 * what arrived. `onUsage` receives what the answer cost, from the last event
 * OpenRouter sends: the tokens and the US dollars charged to the project's key.
 *
 * @module features/assistant/chat-stream
 */

// ============================================================================
// Type Definitions
// ============================================================================

/** How the caller turns a failure into its own error type. */
export interface ChatStreamErrors {
  /** The provider reported an error after the stream started. */
  readonly provider: (message: string) => Error;
  /** The connection dropped mid-answer. */
  readonly dropped: () => Error;
}

/**
 * What one answer cost, as OpenRouter reports it in its last event.
 *
 * The figures are remote input: each one is dropped unless it is a finite,
 * non-negative number, so a malformed event costs a property, not the event.
 */
export interface ChatUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  /** US dollars charged for the answer, the provider's share included. */
  readonly costUsd?: number;
}

type DataLine =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'usage'; readonly usage: ChatUsage }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'none' };

/** OpenRouter's `usage` object, as far as this module reads it. */
interface RawUsage {
  readonly prompt_tokens?: unknown;
  readonly completion_tokens?: unknown;
  readonly cost?: unknown;
  readonly is_byok?: unknown;
  readonly cost_details?: { readonly upstream_inference_cost?: unknown } | null;
}

// ============================================================================
// Helper Functions
// ============================================================================

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function readAmount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Reads OpenRouter's usage accounting.
 *
 * `cost` is what OpenRouter charged the account. With a provider key of the
 * project's own (BYOK), that is only OpenRouter's fee, and the provider bills
 * `upstream_inference_cost` separately, so the two are added.
 */
function parseUsage(raw: RawUsage): ChatUsage {
  const charged = readAmount(raw.cost);
  const upstream =
    raw.is_byok === true
      ? readAmount(raw.cost_details?.upstream_inference_cost)
      : undefined;
  const costUsd =
    charged === undefined && upstream === undefined
      ? undefined
      : (charged ?? 0) + (upstream ?? 0);
  const inputTokens = readAmount(raw.prompt_tokens);
  const outputTokens = readAmount(raw.completion_tokens);

  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(costUsd === undefined ? {} : { costUsd }),
  };
}

/**
 * Reads one SSE `data:` payload.
 */
function parseDataLine(data: string): DataLine {
  if (data === '[DONE]') return { kind: 'none' };

  let payload: {
    error?: { message?: unknown };
    choices?: { delta?: { content?: unknown } }[];
    usage?: RawUsage | null;
  };
  try {
    payload = JSON.parse(data) as typeof payload;
  } catch {
    return { kind: 'none' };
  }

  // A provider can fail after the 200 went out; OpenRouter then sends the
  // error as one more event instead of a status code.
  if (payload.error !== undefined) {
    return {
      kind: 'error',
      message:
        typeof payload.error.message === 'string'
          ? payload.error.message
          : 'The model stopped with an error.',
    };
  }

  const content = payload.choices?.[0]?.delta?.content;
  if (typeof content === 'string' && content.length > 0) {
    return { kind: 'text', text: content };
  }

  // The usage arrives once, in an event of its own after the last text.
  if (typeof payload.usage === 'object' && payload.usage !== null) {
    return { kind: 'usage', usage: parseUsage(payload.usage) };
  }
  return { kind: 'none' };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Reads the stream to its end.
 *
 * @returns The full answer, or what had arrived when the request aborted
 * @throws The caller's error from `errors`, for anything other than an abort
 */
export async function readChatStream(
  body: ReadableStream<Uint8Array>,
  onChunk: ((text: string) => void) | undefined,
  errors: ChatStreamErrors,
  onUsage?: (usage: ChatUsage) => void,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';

  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (error) {
      if (isAbortError(error)) return answer;
      throw errors.dropped();
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });

    // An event can be split across reads, so only complete lines are parsed.
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');

      // Blank lines end an event; `:` lines are keep-alive comments.
      if (!line.startsWith('data:')) continue;
      const parsed = parseDataLine(line.slice('data:'.length).trim());
      if (parsed.kind === 'error') throw errors.provider(parsed.message);
      if (parsed.kind === 'usage') onUsage?.(parsed.usage);
      if (parsed.kind === 'text') {
        answer += parsed.text;
        onChunk?.(answer);
      }
    }
  }

  return answer;
}
