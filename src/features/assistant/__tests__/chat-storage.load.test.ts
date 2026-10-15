/**
 * @fileoverview Reading the assistant transcript back, and the session id.
 *
 * What is stored is whatever the last version of the app wrote, so the loader
 * treats it as untrusted: anything that is not a well-formed turn is dropped
 * rather than rendered. The session id is the other half — it groups a
 * conversation's turns for observability and has to survive a reload, but never
 * outlive a cleared conversation.
 *
 * @module features/assistant/__tests__/chat-storage.load.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearAssistantChatStorage,
  getOrCreateAssistantSessionId,
  loadAssistantChatMessages,
  saveAssistantChatMessages,
} from '../chat-storage';
import type { ChatMessageData } from '../components/ChatMessage';

// ============================================================================
// Helpers
// ============================================================================

/** jsdom here ships no web storage, so the round trip needs one. */
function installMemoryLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length(): number {
        return store.size;
      },
      key: (index: number): string | null => Array.from(store.keys())[index] ?? null,
      getItem: (key: string): string | null => store.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        store.set(key, value);
      },
      removeItem: (key: string): void => {
        store.delete(key);
      },
      clear: (): void => store.clear(),
    } satisfies Storage,
  });

  return store;
}

/** The key the module writes the transcript under. */
function transcriptKey(store: Map<string, string>): string {
  saveAssistantChatMessages([{ id: 'probe', role: 'user', content: 'probe' }]);
  const key = [...store.keys()].find((candidate) => store.get(candidate)?.includes('probe'));
  store.clear();
  return key ?? '';
}

let store: Map<string, string>;

beforeEach(() => {
  store = installMemoryLocalStorage();
  clearAssistantChatStorage();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
  vi.restoreAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('loadAssistantChatMessages', () => {
  it('reads back what was saved', () => {
    const messages: ChatMessageData[] = [
      { id: '1', role: 'user', content: 'Hello' },
      { id: '2', role: 'assistant', content: 'Hi', actionsExecuted: 1 },
    ];
    saveAssistantChatMessages(messages);

    expect(loadAssistantChatMessages()).toEqual(messages);
  });

  it('reads an empty list when nothing was ever saved', () => {
    expect(loadAssistantChatMessages()).toEqual([]);
  });

  it('drops a stored value that is not JSON at all', () => {
    const key = transcriptKey(store);
    store.set(key, 'not json');

    expect(loadAssistantChatMessages()).toEqual([]);
  });

  it('drops a stored value that is not a list', () => {
    const key = transcriptKey(store);
    store.set(key, JSON.stringify({ id: '1', role: 'user', content: 'Hello' }));

    expect(loadAssistantChatMessages()).toEqual([]);
  });

  it('keeps the well-formed turns and drops the rest', () => {
    const key = transcriptKey(store);
    store.set(
      key,
      JSON.stringify([
        { id: '1', role: 'user', content: 'Hello' },
        // Each of these is malformed in exactly one way.
        null,
        'a string',
        { id: 2, role: 'user', content: 'numeric id' },
        { id: '3', role: 'system', content: 'wrong role' },
        { id: '4', role: 'user', content: 42 },
        { id: '5', role: 'user', content: 'x', actionsExecuted: 'one' },
        { id: '6', role: 'user', content: 'x', actionSummaries: 'not a list' },
        { id: '7', role: 'user', content: 'x', actionSummaries: [1, 2] },
        { id: '8', role: 'assistant', content: 'Good', actionSummaries: ['added a guest'] },
      ]),
    );

    expect(loadAssistantChatMessages().map((message) => message.id)).toEqual(['1', '8']);
  });

  it('reads nothing when the store itself throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error('private mode');
        },
      },
    });

    expect(loadAssistantChatMessages()).toEqual([]);
  });
});

describe('the assistant session id', () => {
  it('mints one and keeps it across calls', () => {
    const first = getOrCreateAssistantSessionId();

    expect(first).not.toBe('');
    expect(getOrCreateAssistantSessionId()).toBe(first);
  });

  it('starts a new one once the conversation is cleared', () => {
    const first = getOrCreateAssistantSessionId();

    clearAssistantChatStorage();

    expect(getOrCreateAssistantSessionId()).not.toBe(first);
  });

  it('still answers when the store cannot be read', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error('private mode');
        },
        setItem: () => {},
        removeItem: () => {},
      },
    });

    expect(getOrCreateAssistantSessionId()).not.toBe('');
  });
});

describe('clearAssistantChatStorage', () => {
  it('survives a store that refuses to forget', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        removeItem: () => {
          throw new Error('private mode');
        },
      },
    });

    expect(() => {
      clearAssistantChatStorage();
    }).not.toThrow();
  });
});

describe('saveAssistantChatMessages', () => {
  it('reports a store that is full rather than throwing at the caller', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        setItem: () => {
          throw new Error('quota exceeded');
        },
      },
    });

    expect(() => {
      saveAssistantChatMessages([{ id: '1', role: 'user', content: 'Hello' }]);
    }).not.toThrow();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
