/**
 * @fileoverview Chat message bubble component for the AI assistant.
 *
 * @module features/assistant/components/ChatMessage
 */

import { memo, useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, ChevronRight, Clock3 } from 'lucide-react';

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
  /**
   * What the model showed of its thinking, already separated from `content` by
   * `splitReasoning`. Shown in a collapsed section above the answer.
   *
   * It is display only: the history replayed to the model carries the answer
   * alone, so a model never reads back its own reasoning as if it were speech.
   */
  readonly reasoning?: string;
  /**
   * The reasoning is still arriving — its closing tag has not streamed in yet.
   * The section stays open while this holds, so the user sees something happen
   * before the first word of the answer exists.
   */
  readonly thinking?: boolean;
  /** Number of actions executed from this message */
  readonly actionsExecuted?: number;
  /** Human-readable line per applied action (enables expandable details) */
  readonly actionSummaries?: readonly string[];
  /**
   * Set on a user prompt that is waiting its turn behind the answer currently
   * being generated. Never persisted — an unanswered prompt is dropped on
   * reload rather than restored as a turn the model never saw.
   */
  readonly queued?: boolean;
  /**
   * Set on an assistant bubble that reports a failure instead of an answer.
   * Never persisted and never replayed to the model — the exchange did not
   * happen, and feeding an error back as the model's own words derails the
   * next turn.
   */
  readonly failed?: boolean;
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
}: ChatMessageProps): ReactElement {
  const { t } = useTranslation();

  const displayContent = useMemo(
    () => stripActionBlocks(message.content),
    [message.content],
  );

  const isUser = message.role === 'user';

  const hasReasoning = !isUser && (message.reasoning ?? '').length > 0;

  const appliedCount =
    message.actionSummaries?.length ?? message.actionsExecuted ?? 0;
  const hasExpandableDetails =
    (message.actionSummaries?.length ?? 0) > 0;

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
          message.queued && 'opacity-70',
          message.failed &&
            !isUser &&
            'border border-destructive/40 bg-destructive/10 text-destructive',
        )}
      >
        {hasReasoning && (
          <details
            open={message.thinking === true}
            className="mb-1.5 border-b border-border pb-1.5 open:[&_svg.chevron]:rotate-90"
          >
            <summary
              className={cn(
                'flex cursor-pointer list-none items-center gap-2 rounded-sm text-xs font-medium text-muted-foreground outline-none [&::-webkit-details-marker]:hidden',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              )}
            >
              <ChevronRight
                className="chevron size-3.5 shrink-0 transition-transform"
                aria-hidden="true"
              />
              <Brain className="size-3.5 shrink-0" aria-hidden="true" />
              <span>
                {message.thinking === true
                  ? t('assistant.reasoningInProgress', 'Thinking…')
                  : t('assistant.reasoningLabel', 'Reasoning')}
              </span>
            </summary>
            <div className="mt-2 whitespace-pre-wrap border-l-2 border-muted-foreground/25 pl-3 text-xs font-normal leading-snug text-muted-foreground">
              {message.reasoning}
            </div>
          </details>
        )}
        {isUser ? (
          displayContent || '...'
        ) : (
          <MarkdownText content={displayContent || (hasReasoning ? '' : '...')} />
        )}
        {message.queued && (
          <div
            className={cn(
              'mt-1.5 flex items-center gap-1.5 border-t pt-1.5 text-xs',
              isUser
                ? 'border-primary-foreground/20 text-primary-foreground/80'
                : 'border-border text-muted-foreground',
            )}
          >
            <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{t('assistant.queuedBadge', 'Queued')}</span>
          </div>
        )}
        {appliedCount > 0 && (
          hasExpandableDetails ? (
            <details
              className={cn(
                'mt-1.5 border-t pt-1.5 open:[&_svg]:rotate-90',
                isUser
                  ? 'border-primary-foreground/20 text-primary-foreground/90'
                  : 'border-border text-muted-foreground',
              )}
            >
              <summary
                className={cn(
                  'flex cursor-pointer list-none items-center gap-2 rounded-sm text-xs font-medium outline-none [&::-webkit-details-marker]:hidden',
                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                )}
              >
                <ChevronRight
                  className="size-3.5 shrink-0 transition-transform"
                  aria-hidden="true"
                />
                <span>
                  {t('assistant.changesApplied', { count: appliedCount })}
                </span>
              </summary>
              <ul
                className={cn(
                  'mt-2 space-y-1.5 border-l-2 pl-3 text-xs font-normal leading-snug',
                  isUser
                    ? 'border-primary-foreground/35 text-primary-foreground/85'
                    : 'border-muted-foreground/25 text-muted-foreground',
                )}
              >
                {message.actionSummaries?.map((line, index) => (
                  <li key={`${message.id}-action-${index}`}>{line}</li>
                ))}
              </ul>
            </details>
          ) : (
            <div
              className={cn(
                'mt-1.5 pt-1.5 border-t text-xs',
                isUser
                  ? 'border-primary-foreground/20 text-primary-foreground/70'
                  : 'border-border text-muted-foreground',
              )}
            >
              {t('assistant.changesApplied', {
                count: message.actionsExecuted ?? 0,
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { ChatMessage };
