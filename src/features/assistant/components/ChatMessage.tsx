/**
 * @fileoverview Chat message bubble component for the AI assistant.
 *
 * @module features/assistant/components/ChatMessage
 */

import { memo, useMemo } from 'react';

import { cn } from '@/lib/utils';

import { MarkdownText } from './MarkdownText';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Role of the message sender.
 */
export type MessageRole = 'user' | 'assistant';

/**
 * A single chat message.
 */
export interface ChatMessageData {
  readonly id: string;
  readonly role: MessageRole;
  readonly content: string;
  /** Number of actions executed from this message */
  readonly actionsExecuted?: number;
}

/**
 * Props for the ChatMessage component.
 */
interface ChatMessageProps {
  readonly message: ChatMessageData;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Regex to strip action JSON code blocks from displayed content.
 * Matches ```action, ```json, or bare ``` fenced blocks containing action JSON.
 */
const ACTION_BLOCK_DISPLAY_REGEX =
  /```(?:action|json)?\s*\n?\s*\{[\s\S]*?"action"\s*:[\s\S]*?\}\s*\n?\s*```/g;

/**
 * Strip action blocks from the message so users see only the natural language.
 */
function stripActionBlocks(content: string): string {
  return content.replace(ACTION_BLOCK_DISPLAY_REGEX, '').trim();
}

// ============================================================================
// Component
// ============================================================================

/**
 * Renders a single chat message as a bubble.
 *
 * - User messages: right-aligned, primary color
 * - Assistant messages: left-aligned, muted background
 * - Action blocks are stripped from the visible text
 */
const ChatMessage = memo(function ChatMessage({
  message,
}: ChatMessageProps): React.ReactElement {
  const displayContent = useMemo(
    () => stripActionBlocks(message.content),
    [message.content],
  );

  const isUser = message.role === 'user';

  return (
    <div
      className={cn(
        'flex w-full',
        isUser ? 'justify-end' : 'justify-start',
      )}
    >
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
          isUser
            ? 'bg-primary text-primary-foreground rounded-br-md whitespace-pre-wrap'
            : 'bg-muted text-foreground rounded-bl-md',
        )}
      >
        {isUser ? (
          displayContent || '...'
        ) : (
          <MarkdownText content={displayContent || '...'} />
        )}
        {(message.actionsExecuted ?? 0) > 0 && (
          <div
            className={cn(
              'mt-1.5 pt-1.5 border-t text-xs',
              isUser
                ? 'border-primary-foreground/20 text-primary-foreground/70'
                : 'border-border text-muted-foreground',
            )}
          >
            {message.actionsExecuted === 1
              ? '1 change applied'
              : `${message.actionsExecuted} changes applied`}
          </div>
        )}
      </div>
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { ChatMessage };
