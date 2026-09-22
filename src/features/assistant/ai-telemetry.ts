/**
 * @fileoverview What an `$ai_generation` event is allowed to carry.
 *
 * PostHog's LLM analytics wants the whole exchange, and the whole exchange on
 * this app is the trip. `useTripSystemPrompt` builds the system message out of
 * every guest's name, their phone number, their notes, who sleeps where, who is
 * driving whom and what everybody owes — and the model's answer is composed
 * from the same material.
 *
 * Those people are not users of this app. They gave a name to whoever organised
 * the holiday, and this project's rule is that analytics carries counts and
 * enum values rather than user content, with exactly one exception decided on
 * deliberately: `assistant_prompt_sent`, which carries the prompt because what
 * people ask is the only way to tell whether the assistant answers it. The
 * user's own turns are that exception. The system message and the model's reply
 * are not, and they were travelling verbatim.
 *
 * So each redacted message keeps its length. Length is what the interesting
 * questions are actually about — prefill memory is linear in prompt length, and
 * `qwen3-1-7b` reads back 297 KiB of logits per prompt token — and a number
 * answers them without naming anybody.
 *
 * @module features/assistant/ai-telemetry
 */

import type { ChatMessage } from './hooks/useWebLLM';

// ============================================================================
// Type Definitions
// ============================================================================

/** One turn as the analytics event carries it. */
export interface RedactedChatMessage {
  readonly role: ChatMessage['role'];
  readonly content: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Stands in for text that names people who are not users of this app. */
const REDACTED = '[redacted';

// ============================================================================
// Redaction
// ============================================================================

/** `[redacted: 2401 chars]`, which is the part worth reporting. */
function redactedPlaceholder(content: string): string {
  return `${REDACTED}: ${content.length} chars]`;
}

/**
 * Keeps the user's own turns and replaces everything else with its length.
 *
 * @param messages - The prompt exactly as it was handed to the model
 * @returns The same turns, with the trip's contents taken out
 */
export function redactAiMessages(
  messages: readonly ChatMessage[],
): RedactedChatMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content:
      message.role === 'user'
        ? message.content
        : redactedPlaceholder(message.content),
  }));
}

/**
 * The model's answer, as the analytics event may carry it.
 *
 * Redacted for the same reason the system message is: the answer is assembled
 * out of the trip. `answer_length` on `assistant_answer_received` is the figure
 * anybody actually reads.
 *
 * @param response - The model's reply
 * @returns One choice, with the reply's length in place of the reply
 */
export function redactAiOutput(
  response: string,
): readonly RedactedChatMessage[] {
  return [{ role: 'assistant', content: redactedPlaceholder(response) }];
}
