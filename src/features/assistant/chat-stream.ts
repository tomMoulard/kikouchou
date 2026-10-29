/**
 * @fileoverview Reads a streamed chat completion, in the OpenAI event format.
 *
 * Two engines receive that format: `openrouter`, straight from OpenRouter
 * with the user's key, and `kikouchou`, from api.kikouchou.app, which relays
 * OpenRouter's stream unchanged. One reader serves both, so a fix to how an
 * event is split or how a mid-stream error reads reaches both.
 *
 * `onChunk` receives the **whole answer so far**, the contract the local
 * workers keep too, and an abort resolves with what arrived.
 *
 * @module features/assistant/chat-stream
 */

// ============================================================================
// Type Definitions
// ============================================================================

/** How each engine turns a failure into its own error type. */
export interface ChatStreamErrors {
  /** The provider reported an error after the stream started. */
  readonly provider: (message: string) => Error;
  /** The connection dropped mid-answer. */
  readonly dropped: () => Error;
}

type DataLine =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'none' };

// ============================================================================
// Helper Functions
// ============================================================================

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Reads one SSE `data:` payload.
 */
function parseDataLine(data: string): DataLine {
  if (data === '[DONE]') return { kind: 'none' };

  let payload: {
    error?: { message?: unknown };
    choices?: { delta?: { content?: unknown } }[];
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
  return typeof content === 'string' && content.length > 0
    ? { kind: 'text', text: content }
    : { kind: 'none' };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Reads the stream to its end.
 *
 * @returns The full answer, or what had arrived when the request aborted
 * @throws The engine's error from `errors`, for anything other than an abort
 */
export async function readChatStream(
  body: ReadableStream<Uint8Array>,
  onChunk: ((text: string) => void) | undefined,
  errors: ChatStreamErrors,
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
      if (parsed.kind === 'text') {
        answer += parsed.text;
        onChunk?.(answer);
      }
    }
  }

  return answer;
}
