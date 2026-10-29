/**
 * @fileoverview The assistant's connection to api.kikouchou.app.
 *
 * The project's server answers every question, on the project's OpenRouter
 * key, for a signed-in account (`server/api`). Nothing runs or downloads on
 * the device: "ready" means an account is signed in, and `generate` streams
 * the answer over `fetch` (see `kikouchou-api/client`).
 *
 * @module features/assistant/hooks/useAssistantChat
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import i18n from '@/lib/i18n';

import {
  KikouchouApiError,
  streamKikouchouChat,
} from '../kikouchou-api/client';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Where the assistant stands: `idle` with no account to answer for, `ready`
 * to take a question, `generating` while an answer streams.
 */
export type AssistantStatus = 'idle' | 'ready' | 'generating';

/**
 * A single chat message.
 */
export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

/**
 * What the hook cannot find out for itself.
 */
export interface UseAssistantChatOptions {
  /**
   * Whether an account is signed in on this device. The assistant is ready
   * exactly when it is: the server answers accounts, and the account lives in
   * `AuthContext`, which this hook does not read.
   */
  readonly accountSignedIn: boolean;
}

/**
 * Return type of the useAssistantChat hook.
 */
export interface UseAssistantChatReturn {
  readonly status: AssistantStatus;
  /** Why the last answer failed, in words the user can act on. */
  readonly error: string | null;
  /** Streams one answer to a message history. */
  generate: (
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
  ) => Promise<string>;
  /** Stops the answer in flight; it resolves with what already arrived. */
  interrupt: () => void;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * The words a failed answer from api.kikouchou.app is shown with.
 */
function describeKikouchouError(error: KikouchouApiError): string {
  switch (error.kind) {
    case 'unauthorized':
      return i18n.t('assistant.account.errors.unauthorized', {
        defaultValue: 'Your session has ended. Sign in again to keep using the assistant.',
      });
    case 'daily-limit':
      return i18n.t('assistant.account.errors.dailyLimit', {
        defaultValue: 'You have used today\'s questions. The count starts again tomorrow.',
      });
    case 'unavailable':
      return i18n.t('assistant.account.errors.unavailable', {
        defaultValue: 'The Kikouchou server cannot answer right now. Try again in a moment.',
      });
    case 'network':
      return i18n.t('assistant.account.errors.network', {
        defaultValue: 'Could not reach the Kikouchou server. Check your connection.',
      });
    case 'provider':
      return i18n.t('assistant.account.errors.provider', {
        defaultValue: 'The model did not answer. Try again.',
      });
  }
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook that asks api.kikouchou.app on behalf of the signed-in account.
 *
 * @param options - What the hook cannot find out for itself
 * @returns The assistant's state and the calls that drive it
 */
export function useAssistantChat({
  accountSignedIn,
}: UseAssistantChatOptions): UseAssistantChatReturn {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // A new session starts clean: the error that sent the user to sign in again
  // has been answered.
  useEffect(() => {
    if (accountSignedIn) setError(null);
  }, [accountSignedIn]);

  const generate = useCallback(
    async (
      messages: ChatMessage[],
      onChunk?: (chunk: string) => void,
    ): Promise<string> => {
      const controller = new AbortController();
      abortControllerRef.current?.abort();
      abortControllerRef.current = controller;
      setIsGenerating(true);
      setError(null);

      try {
        return await streamKikouchouChat({
          messages,
          signal: controller.signal,
          onChunk,
        });
      } catch (err) {
        if (!(err instanceof KikouchouApiError)) throw err;
        // The account is `AuthContext`'s to end, not this hook's: an expired
        // session says so and leaves the page where it is.
        const message = describeKikouchouError(err);
        setError(message);
        throw new Error(message, { cause: err });
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        setIsGenerating(false);
      }
    },
    [],
  );

  const interrupt = useCallback((): void => {
    abortControllerRef.current?.abort();
  }, []);

  const status: AssistantStatus = !accountSignedIn
    ? 'idle'
    : isGenerating
      ? 'generating'
      : 'ready';

  return { status, error, generate, interrupt };
}
