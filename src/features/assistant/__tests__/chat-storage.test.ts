/**
 * @fileoverview Tests for assistant chat persistence and LLM history rebuild.
 *
 * @module features/assistant/__tests__/chat-storage
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ChatMessageData } from '../components/ChatMessage';
import {
  MAX_PROMPT_HISTORY_CHARS,
  MAX_PROMPT_HISTORY_MESSAGES,
  clearAssistantChatStorage,
  loadAssistantChatMessages,
  messagesToLLMChatHistory,
  saveAssistantChatMessages,
  trimChatHistoryForPrompt,
} from '../chat-storage';
import type { ChatMessage as LLMChatMessage } from '../hooks/useWebLLM';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * jsdom is configured without web storage here, so the round-trip needs one.
 */
function installMemoryLocalStorage(): void {
  const store = new Map<string, string>();

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length(): number {
        return store.size;
      },
      key: (index: number): string | null =>
        Array.from(store.keys())[index] ?? null,
      getItem: (key: string): string | null => store.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        store.set(key, value);
      },
      removeItem: (key: string): void => {
        store.delete(key);
      },
      clear: (): void => {
        store.clear();
      },
    },
  });
}

function message(
  id: string,
  role: 'user' | 'assistant',
  content: string,
  extra: Partial<ChatMessageData> = {},
): ChatMessageData {
  return { id, role, content, ...extra };
}

/** `count` complete exchanges followed by the prompt now being answered. */
function exchanges(count: number, size = 10): LLMChatMessage[] {
  const history: LLMChatMessage[] = [];
  for (let index = 0; index < count; index += 1) {
    history.push({ role: 'user', content: `q${index}`.padEnd(size, '.') });
    history.push({ role: 'assistant', content: `a${index}`.padEnd(size, '.') });
  }
  history.push({ role: 'user', content: 'newest question' });
  return history;
}

// ============================================================================
// Tests
// ============================================================================

describe('messagesToLLMChatHistory', () => {
  it('keeps complete user/assistant pairs', () => {
    expect(
      messagesToLLMChatHistory([
        message('1', 'user', 'hello'),
        message('2', 'assistant', 'hi'),
        message('3', 'user', 'again'),
        message('4', 'assistant', 'sure'),
      ]),
    ).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'again' },
      { role: 'assistant', content: 'sure' },
    ]);
  });

  it('drops a prompt whose turn failed, so roles keep alternating', () => {
    // Two user turns in a row make Gemma's chat template throw, which would
    // break every later generation rather than just the failed one.
    const history = messagesToLLMChatHistory([
      message('1', 'user', 'hello'),
      message('2', 'assistant', 'hi'),
      message('3', 'user', 'crashes'),
      message('4', 'assistant', 'engine crashed', { failed: true }),
      message('5', 'user', 'retry'),
      message('6', 'assistant', 'done'),
    ]);

    expect(history).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'retry' },
      { role: 'assistant', content: 'done' },
    ]);
  });

  it('ignores queued prompts and answers still streaming', () => {
    expect(
      messagesToLLMChatHistory([
        message('1', 'user', 'answered'),
        message('2', 'assistant', 'yes'),
        message('3', 'user', 'in flight'),
        message('4', 'assistant', ''),
        message('5', 'user', 'waiting', { queued: true }),
      ]),
    ).toEqual([
      { role: 'user', content: 'answered' },
      { role: 'assistant', content: 'yes' },
    ]);
  });
});

describe('saveAssistantChatMessages', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
    clearAssistantChatStorage();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'localStorage');
  });

  it('persists only settled turns', () => {
    saveAssistantChatMessages([
      message('1', 'user', 'answered'),
      message('2', 'assistant', 'yes'),
      message('3', 'user', 'failed one'),
      message('4', 'assistant', 'engine crashed', { failed: true }),
      message('5', 'user', 'waiting', { queued: true }),
      message('6', 'assistant', ''),
    ]);

    expect(loadAssistantChatMessages().map((m) => m.id)).toEqual([
      '1',
      '2',
      '3',
    ]);
  });
});

describe('trimChatHistoryForPrompt', () => {
  it('leaves a short conversation untouched', () => {
    const history = exchanges(2);

    expect(trimChatHistoryForPrompt(history)).toEqual(history);
  });

  it('keeps only the most recent exchanges once the turn cap is passed', () => {
    const trimmed = trimChatHistoryForPrompt(exchanges(10));

    expect(trimmed).toHaveLength(MAX_PROMPT_HISTORY_MESSAGES + 1);
    expect(trimmed.at(-1)?.content).toBe('newest question');
    expect(trimmed[0]?.content).toContain('q7');
  });

  it('drops whole exchanges so the roles keep alternating', () => {
    // Gemma's chat template rejects two user turns in a row, so a history that
    // starts on an assistant answer would break every later generation.
    const trimmed = trimChatHistoryForPrompt(exchanges(10));

    for (const [index, entry] of trimmed.entries()) {
      expect(entry.role).toBe(index % 2 === 0 ? 'user' : 'assistant');
    }
  });

  it('drops older exchanges when a few long answers blow the character budget', () => {
    // Three exchanges is under the turn cap, but each answer is nearly the
    // whole budget — a turn count alone would let this through.
    const long = MAX_PROMPT_HISTORY_CHARS;
    const trimmed = trimChatHistoryForPrompt(exchanges(3, long));

    const size = trimmed.reduce((total, m) => total + m.content.length, 0);
    expect(size).toBeLessThanOrEqual(MAX_PROMPT_HISTORY_CHARS);
    expect(trimmed.at(-1)?.content).toBe('newest question');
  });

  it('keeps the prompt being answered even when it alone exceeds the budget', () => {
    const huge = 'x'.repeat(MAX_PROMPT_HISTORY_CHARS * 2);
    const trimmed = trimChatHistoryForPrompt([
      { role: 'user', content: 'old' },
      { role: 'assistant', content: 'older answer' },
      { role: 'user', content: huge },
    ]);

    expect(trimmed).toEqual([{ role: 'user', content: huge }]);
  });

  it('returns an empty history unchanged', () => {
    expect(trimChatHistoryForPrompt([])).toEqual([]);
  });
});
