/**
 * @fileoverview Persists AI assistant chat messages in localStorage so the
 * conversation survives navigation away from the assistant page.
 *
 * @module features/assistant/chat-storage
 */

import { nanoid } from 'nanoid';

import type { ChatMessageData } from './components/ChatMessage';
import type { ChatMessage as LLMChatMessage } from './hooks/useWebLLM';

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY = 'kikouchou.assistant.chat.v1';
const SESSION_STORAGE_KEY = 'kikouchou.assistant.chat.session.v1';

/**
 * Past turns kept in the prompt, on top of the one being answered — three
 * complete exchanges.
 *
 * Everything sent to the model is re-tokenised on every turn, and prefill
 * memory grows with the prompt: on a model whose ONNX export does not slice the
 * logits, each prompt token costs `vocab_size` floats of GPU-to-CPU readback.
 * An uncapped transcript therefore does not degrade gradually — it walks into a
 * failed buffer allocation and takes the WebGPU device with it. Three exchanges
 * is also about as much back-reference as a 1–4B on-device model uses well.
 */
export const MAX_PROMPT_HISTORY_MESSAGES = 6;

/**
 * Characters of past conversation kept in the prompt. A handful of long answers
 * reaches the memory that matters long before the turn cap does — one answer
 * can run to `max_new_tokens`.
 */
export const MAX_PROMPT_HISTORY_CHARS = 4000;

// ============================================================================
// Validation
// ============================================================================

function isChatMessageData(value: unknown): value is ChatMessageData {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  if (typeof o.id !== 'string') return false;
  if (o.role !== 'user' && o.role !== 'assistant') return false;
  if (typeof o.content !== 'string') return false;
  if (
    o.actionsExecuted !== undefined &&
    typeof o.actionsExecuted !== 'number'
  ) {
    return false;
  }
  if (o.actionSummaries !== undefined) {
    if (!Array.isArray(o.actionSummaries)) return false;
    if (!o.actionSummaries.every((s) => typeof s === 'string')) return false;
  }
  return true;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Loads persisted assistant messages, or an empty array if missing/invalid.
 */
export function loadAssistantChatMessages(): ChatMessageData[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isChatMessageData);
  } catch {
    return [];
  }
}

/**
 * Keeps only turns that are meaningful to restore: a queued prompt was never
 * seen by the model, and an empty assistant bubble is a placeholder whose
 * generation is still in flight. Persisting either would rebuild an LLM history
 * with a dangling user turn or a blank answer.
 */
function isPersistableMessage(message: ChatMessageData): boolean {
  if (message.queued === true || message.failed === true) return false;
  return message.role !== 'assistant' || message.content.length > 0;
}

/**
 * Saves the current assistant message list (overwrites previous).
 */
export function saveAssistantChatMessages(
  messages: readonly ChatMessageData[],
): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(messages.filter(isPersistableMessage)),
    );
  } catch (error) {
    console.error('Failed to persist assistant chat:', error);
  }
}

/**
 * Removes persisted assistant chat.
 */
export function clearAssistantChatStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore quota / private mode edge cases
  }
}

/**
 * Returns the id grouping this conversation's turns for AI observability
 * (PostHog `$ai_session_id`), minting and persisting one on first use so it
 * survives a page reload and stays stable until the conversation is cleared.
 */
export function getOrCreateAssistantSessionId(): string {
  try {
    const existing = localStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const created = nanoid();
    localStorage.setItem(SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    return nanoid();
  }
}

/**
 * Rebuilds LLM user/assistant history from UI messages (for session restore).
 *
 * Only complete user→assistant pairs survive. Gemma's chat template rejects a
 * history whose roles do not strictly alternate, so a prompt left unanswered by
 * a failed or interrupted turn would break *every* later generation, not just
 * its own.
 */
export function messagesToLLMChatHistory(
  messages: readonly ChatMessageData[],
): LLMChatMessage[] {
  const history: LLMChatMessage[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const prompt = messages[index];
    if (prompt === undefined || prompt.role !== 'user') continue;
    if (prompt.queued === true) continue;

    const answer = messages[index + 1];
    if (
      answer === undefined ||
      answer.role !== 'assistant' ||
      answer.failed === true ||
      answer.content.length === 0
    ) {
      continue;
    }

    history.push(
      { role: 'user', content: prompt.content },
      { role: 'assistant', content: answer.content },
    );
    index += 1;
  }

  return history;
}

/**
 * Bounds the conversation handed to the model, keeping the most recent turns.
 *
 * The transcript the user sees is untouched — only the prompt is trimmed. The
 * caps are hit by whole exchanges from the front, never by half of one: Gemma's
 * chat template rejects a history that does not strictly alternate, so a
 * trimmed history that opened on an assistant answer would break every
 * generation after it, not just this one.
 *
 * @param history - The full user/assistant history, ending with the prompt
 *   being answered
 * @returns The most recent slice that fits both caps, alternation preserved
 *
 * @example
 * ```ts
 * const fullMessages = [
 *   { role: 'system', content: systemPrompt },
 *   ...trimChatHistoryForPrompt(chatHistoryRef.current),
 * ];
 * ```
 */
export function trimChatHistoryForPrompt(
  history: readonly LLMChatMessage[],
): LLMChatMessage[] {
  if (history.length === 0) return [];

  // The last entry is the prompt being answered: it goes in whatever it costs,
  // because dropping it would answer the wrong question.
  const newest = history[history.length - 1]!;
  const older = history.slice(0, -1);

  let budget = MAX_PROMPT_HISTORY_CHARS - newest.content.length;
  let kept = 0;

  // Walk backwards a whole exchange at a time.
  for (let end = older.length; end >= 2; end -= 2) {
    if (kept + 2 > MAX_PROMPT_HISTORY_MESSAGES) break;

    const cost =
      older[end - 2]!.content.length + older[end - 1]!.content.length;
    if (cost > budget) break;

    budget -= cost;
    kept += 2;
  }

  return [...older.slice(older.length - kept), newest];
}
