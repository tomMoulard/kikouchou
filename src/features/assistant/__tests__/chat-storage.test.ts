/**
 * @fileoverview Tests for assistant chat persistence and LLM history rebuild.
 *
 * @module features/assistant/__tests__/chat-storage
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ChatMessageData } from '../components/ChatMessage';
import {
  clearAssistantChatStorage,
  loadAssistantChatMessages,
  messagesToLLMChatHistory,
  saveAssistantChatMessages,
} from '../chat-storage';

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
