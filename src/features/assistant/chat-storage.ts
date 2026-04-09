/**
 * @fileoverview Persists AI assistant chat messages in localStorage so the
 * conversation survives navigation away from the assistant page.
 *
 * @module features/assistant/chat-storage
 */

import type { ChatMessageData } from './components/ChatMessage';
import type { ChatMessage as LLMChatMessage } from './hooks/useWebLLM';

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY = 'kikoushou.assistant.chat.v1';

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
 * Saves the current assistant message list (overwrites previous).
 */
export function saveAssistantChatMessages(
  messages: readonly ChatMessageData[],
): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
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
  } catch {
    // ignore quota / private mode edge cases
  }
}

/**
 * Rebuilds LLM user/assistant history from UI messages (for session restore).
 */
export function messagesToLLMChatHistory(
  messages: readonly ChatMessageData[],
): LLMChatMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}
