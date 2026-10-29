/**
 * @fileoverview AI Assistant page. Users ask questions about their trip and
 * request changes to it (guests, rooms, transports, assignments) in plain
 * words. api.kikouchou.app answers, for a signed-in account.
 *
 * @module features/assistant/pages/AssistantPage
 */

import {
  type ReactElement,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { nanoid } from 'nanoid';
import {
  Bot,
  CloudOff,
  ListPlus,
  LogIn,
  Send,
  Square,
  Sparkles,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { PageHeader } from '@/components/shared/PageHeader';
import { useAuth } from '@/features/auth';
import { SignInDialog } from '@/features/auth/components/SignInDialog';

import { cn } from '@/lib/utils';

import {
  ChatMessage,
  type ChatMessageData,
} from '../components/ChatMessage';
import {
  clearAssistantChatStorage,
  getOrCreateAssistantSessionId,
  loadAssistantChatMessages,
  messagesToLLMChatHistory,
  saveAssistantChatMessages,
  trimChatHistoryForPrompt,
} from '../chat-storage';
import {
  listDestructiveActions,
  listViewRequests,
  useTripActions,
} from '../hooks/useTripActions';
import { useTripSystemPrompt } from '../hooks/useTripSystemPrompt';
import { redactAiMessages, redactAiOutput } from '../ai-telemetry';
import { splitReasoning } from '../reasoning';
import { ViewShortcuts } from '../components/ViewShortcuts';
import { StarterPrompts } from '../components/StarterPrompts';
import type { StarterKind } from '../starters';
import { storePendingPrompt, takePendingPrompt } from '../pending-prompt';
import { type AssistantView, buildShowViewBlock } from '../views';
import {
  type ChatMessage as LLMChatMessage,
  useAssistantChat,
} from '../hooks/useAssistantChat';
import posthog, { captureEvent, captureUsage } from '@/lib/posthog';
import { notify } from '@/lib/notifications';
import { isSupabaseConfigured } from '@/lib/supabase/client';

// ============================================================================
// Constants
// ============================================================================

/**
 * The `model_id` the assistant's events carry. It named the preset the user
 * picked while there were several; it stays, so the events before and after
 * the picker went away still line up.
 */
const ASSISTANT_MODEL_ID = 'cloud-kikouchou';

/**
 * The `$ai_model` an answer is reported under. api.kikouchou.app picks the
 * real model, so the client only knows it asked the server.
 */
const ASSISTANT_AI_MODEL = 'kikouchou/assistant';

// ============================================================================
// Helper
// ============================================================================

/**
 * How one queued turn ended.
 */
type TurnOutcome = 'answered' | 'failed' | 'abandoned';

/**
 * A prompt accepted by the UI and waiting for the assistant to reach it.
 */
/**
 * An answer whose deletions are waiting for the user's say-so.
 *
 * `resolve` settles the turn: `true` applies every action in the answer,
 * `false` applies none of it. The dialog that asks is the one place a model's
 * instruction to remove data meets a person, so a note another member wrote
 * into the prompt cannot empty the trip on its own.
 */
interface PendingDeletions {
  readonly actions: readonly string[];
  readonly resolve: (apply: boolean) => void;
}

interface QueuedPrompt {
  /** Id of the user bubble already rendered in the transcript. */
  readonly messageId: string;
  readonly text: string;
}

/**
 * How close to the bottom of the transcript counts as "following along".
 * Past it, streamed tokens must not yank the reader back down.
 */
const SCROLL_PIN_THRESHOLD_PX = 80;

let messageCounter = 0;
function nextMessageId(): string {
  return `msg-${++messageCounter}-${Date.now()}`;
}

// ============================================================================
// Sub-Components
// ============================================================================

/**
 * The card a signed-out visitor sees: the questions the assistant can start
 * with, where the trip goes, and the way to an account.
 *
 * The starters are here, and not only in the empty chat, because this is the
 * first screen of the onboarding experiment's assistant arm. A tap on one asks
 * for the account and keeps the question, which is sent once the visitor is
 * back. The privacy line is not small print: the system prompt carries every
 * guest's name, phone and notes, and those people never agreed to anything,
 * so the user reads where it goes before the first question leaves the device.
 */
const AccountAssistantCard = memo(function AccountAssistantCard({
  onPick,
  onSignIn,
  error,
}: {
  readonly onPick: (text: string, kind: StarterKind) => void;
  readonly onSignIn: () => void;
  readonly error: string | null;
}): ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/10 mb-2">
            <Sparkles className="size-7 text-primary" aria-hidden="true" />
          </div>
          <CardTitle className="text-lg">
            {t('assistant.account.title', 'Plan your trip by asking')}
          </CardTitle>
          <CardDescription>
            {t(
              'assistant.account.description',
              'Tell the assistant about your trip and it fills in the dates, the guests and the rooms. It comes with a free Kikouchou account, with a daily limit, and needs no download.',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
          <StarterPrompts onPick={onPick} disabled={false} />
          <p className="text-xs text-muted-foreground text-center">
            {t(
              'assistant.account.privacyNotice',
              'Each question sends your trip details, guest names included, to the Kikouchou server, then to OpenRouter and to the company that runs the model.',
            )}
          </p>
          <Button className="w-full" onClick={onSignIn}>
            <LogIn className="size-4 mr-2" aria-hidden="true" />
            {t('assistant.account.signIn', 'Sign in to start')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
});

/**
 * The card a build with no Supabase project shows. The assistant answers for
 * an account, and such a build (a fork, most e2e servers) has none to offer.
 */
const AssistantUnavailableCard = memo(function AssistantUnavailableCard(): ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-muted mb-2">
            <CloudOff className="size-7 text-muted-foreground" aria-hidden="true" />
          </div>
          <CardTitle className="text-lg">
            {t('assistant.unavailable.title', 'The assistant is not available here')}
          </CardTitle>
          <CardDescription>
            {t(
              'assistant.unavailable.description',
              'The assistant answers through a Kikouchou account, and this copy of the app has no account service.',
            )}
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
});


/**
 * Chat input area with a textarea, a send button and — while the assistant is
 * answering — a stop button.
 *
 * The textarea and send button stay live during generation: a prompt sent then
 * joins the queue instead of being dropped on the floor.
 */
const ChatInput = memo(function ChatInput({
  onSend,
  isGenerating,
  onStop,
  disabled,
  queuedCount,
  onClearQueue,
}: {
  readonly onSend: (message: string) => void;
  readonly isGenerating: boolean;
  readonly onStop: () => void;
  readonly disabled: boolean;
  readonly queuedCount: number;
  readonly onClearQueue: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput('');
    // Re-focus textarea after sending
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [input, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="shrink-0 border-t bg-background p-3">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {queuedCount > 0 ? (
          <div
            className="flex items-center justify-between gap-2 rounded-lg border border-dashed bg-muted/40 px-3 py-1.5"
            role="status"
          >
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <ListPlus className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {t('assistant.queuedCount', { count: queuedCount })}
              </span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 px-2 text-xs"
              onClick={onClearQueue}
            >
              {t('assistant.clearQueue', 'Clear queue')}
            </Button>
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isGenerating
                ? t(
                    'assistant.placeholderQueue',
                    'Send another request. It will be answered next...',
                  )
                : t(
                    'assistant.placeholder',
                    'Ask about your trip or request changes...',
                  )
            }
            disabled={disabled}
            className="min-h-10 max-h-32 resize-none"
            rows={1}
          />
          {isGenerating ? (
            <Button
              variant="outline"
              size="icon"
              onClick={onStop}
              aria-label={t('assistant.stop', 'Stop generating')}
            >
              <Square className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!input.trim() || disabled}
            aria-label={
              isGenerating
                ? t('assistant.queueMessage', 'Queue message')
                : t('assistant.send', 'Send message')
            }
          >
            <Send className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
});

// ============================================================================
// Main Component
// ============================================================================

/**
 * AI Assistant page component.
 *
 * Features:
 * - Answers from api.kikouchou.app, for a signed-in account
 * - Chat interface with streaming responses
 * - Trip context injected as system prompt
 * - Automatic action execution for trip modifications
 *
 * @returns The assistant page element
 */
function AssistantPageComponent(): ReactElement {
  const { t } = useTranslation();
  const { session } = useAuth();
  // An anonymous session is not an account: the server refuses it.
  const accountSignedIn = session !== null && session.user.is_anonymous !== true;
  const accountsAvailable = isSupabaseConfigured();
  const [signInOpen, setSignInOpen] = useState(false);
  const { status, error, generate, interrupt } = useAssistantChat({
    accountSignedIn,
  });
  const { systemPrompt, buildSystemPrompt, offeredActions } = useTripSystemPrompt();
  const { executeActions } = useTripActions();

  const [messages, setMessages] = useState<ChatMessageData[]>(() =>
    loadAssistantChatMessages(),
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const isPinnedToBottomRef = useRef(true);
  const chatHistoryRef = useRef<LLMChatMessage[]>([]);

  /** Prompts accepted while an answer was in flight, oldest first. */
  const queueRef = useRef<QueuedPrompt[]>([]);
  /** Guards the drain loop so exactly one turn runs at a time. */
  const isDrainingRef = useRef(false);
  /**
   * Bumped whenever the transcript is wiped. A turn that started before the
   * wipe must not write its answer into the fresh conversation.
   */
  const conversationVersionRef = useRef(0);
  const [isAnswering, setIsAnswering] = useState(false);

  // Groups this conversation's turns for PostHog AI observability
  // ($ai_session_id). Lazily minted so it survives re-renders, and reset
  // alongside the transcript in handleClearConversation.
  const sessionIdRef = useRef<string | null>(null);
  if (sessionIdRef.current === null) {
    sessionIdRef.current = getOrCreateAssistantSessionId();
  }

  // Latest-value refs: a turn started minutes ago must still generate against
  // the current trip prompt and action executor, not the ones captured when it
  // was queued.
  const systemPromptRef = useRef(systemPrompt);
  systemPromptRef.current = systemPrompt;
  const buildSystemPromptRef = useRef(buildSystemPrompt);
  buildSystemPromptRef.current = buildSystemPrompt;
  const offeredActionsRef = useRef(offeredActions);
  offeredActionsRef.current = offeredActions;
  const generateRef = useRef(generate);
  generateRef.current = generate;
  const executeActionsRef = useRef(executeActions);
  executeActionsRef.current = executeActions;

  const [pendingDeletions, setPendingDeletions] = useState<PendingDeletions | null>(null);

  /** Asks before an answer's deletions run; resolves with the user's choice. */
  const askBeforeDeleting = useCallback(
    (actions: readonly string[]): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        setPendingDeletions({ actions, resolve });
      }),
    [],
  );

  const handleDeletionsConfirmed = useCallback((): void => {
    pendingDeletions?.resolve(true);
  }, [pendingDeletions]);

  const handleDeletionsOpenChange = useCallback(
    (open: boolean): void => {
      if (!open) {
        // After a confirm this resolve is a no-op: the promise already settled.
        pendingDeletions?.resolve(false);
        setPendingDeletions(null);
      }
    },
    [pendingDeletions],
  );

  const pendingDeletionsDescription = useMemo(() => {
    const actions = pendingDeletions?.actions ?? [];
    const names = actions.map((action) => t(`assistant.destructive.${action}`, action));
    return t('assistant.confirmDeletions.description', {
      count: actions.length,
      list: names.join(', '),
      defaultValue:
        'The assistant wants to make {{count}} deletion(s): {{list}}. A deletion reaches every member of the trip.',
    });
  }, [pendingDeletions, t]);
  const tRef = useRef(t);
  tRef.current = t;

  // Restore LLM turn history from persisted UI messages (see runTurn for live updates).
  useLayoutEffect(() => {
    chatHistoryRef.current = messagesToLLMChatHistory(messages);
    // Sync only on mount: live updates stay in runTurn (a queued prompt and the
    // streaming placeholder must not enter history before the turn runs).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Mount-only by design, for the reason directly above.
  }, []);

  // Persist chat locally (debounced — avoids writes on every streaming chunk).
  useEffect(() => {
    const id = window.setTimeout(() => {
      saveAssistantChatMessages(messages);
    }, 400);
    return () => window.clearTimeout(id);
  }, [messages]);

  // Follow the conversation only while the reader is already at the bottom, and
  // jump instantly rather than animating — a smooth scroll restarted on every
  // streamed token makes the transcript impossible to read or scroll away from.
  useEffect(() => {
    if (!isPinnedToBottomRef.current) return;
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const handleMessagesScroll = useCallback((): void => {
    const container = messagesScrollRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    isPinnedToBottomRef.current = distanceFromBottom <= SCROLL_PIN_THRESHOLD_PX;
  }, []);

  /**
   * Runs one queued prompt to completion: promote it out of the queue, stream
   * the answer, then apply any actions it asked for.
   */
  const runTurn = useCallback(
    async ({ messageId, text }: QueuedPrompt): Promise<TurnOutcome> => {
      // Wall clock: how long somebody waits for an answer, connection
      // included, which no server metric shows.
      const startedAt = Date.now();
      const conversationVersion = conversationVersionRef.current;
      const isSameConversation = (): boolean =>
        conversationVersionRef.current === conversationVersion;
      // Shares every LLM call of this turn under one PostHog $ai_trace_id.
      const traceId = nanoid();

      // The prompt is now the one being answered — drop the queued marker.
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId ? { ...msg, queued: false } : msg,
        ),
      );

      // Enter the LLM history only now, so an answer already in flight never
      // sees a prompt the user typed after it started.
      chatHistoryRef.current.push({ role: 'user', content: text });

      // Create assistant placeholder for streaming
      const assistantId = nextMessageId();
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: 'assistant', content: '' },
      ]);

      // Every offered action, every turn (`ACTION_SCHEMAS`, minus the meal
      // planner's where its flag is off). That prompt is what the character
      // budget in `action-schema.test.ts` guards.
      const actions = offeredActionsRef.current;

      // Built before the try/catch so a rejected generate() can still report
      // it in the $ai_generation failure capture below.
      //
      // The transcript keeps growing; the prompt must not. Every token of it
      // is paid on the project's key, so the history is trimmed to the most
      // recent exchanges.
      const fullMessages: LLMChatMessage[] = [
        { role: 'system', content: buildSystemPromptRef.current(actions) },
        ...trimChatHistoryForPrompt(chatHistoryRef.current),
      ];

      try {
        const response = await generateRef.current(fullMessages, (chunk) => {
          // Split on every chunk rather than once at the end: while a reasoning
          // block is still open the answer is empty, and showing the thinking
          // live is the difference between a working bubble and a blank one.
          const streamed = splitReasoning(chunk);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId
                ? {
                    ...msg,
                    content: streamed.answer,
                    reasoning: streamed.reasoning,
                    thinking: streamed.thinking,
                  }
                : msg,
            ),
          );
        });

        // The transcript was cleared while this ran: its history is gone, so
        // appending the answer would leave a reply with nothing to reply to.
        if (!isSameConversation()) return 'abandoned';

        // The reasoning is display only: the history keeps the answer alone, so
        // the model never reads its own thinking back as something it said.
        const { reasoning, answer } = splitReasoning(response);

        // Add to chat history
        chatHistoryRef.current.push({ role: 'assistant', content: answer });

        // A deletion waits for the user. The prompt carries text every member
        // of the trip wrote, so an answer that removes data is applied only
        // once a person has read what it removes.
        const deletions = listDestructiveActions(answer);
        const apply = deletions.length === 0 || (await askBeforeDeleting(deletions));
        if (!isSameConversation()) return 'abandoned';

        // Execute any action blocks in the response
        const { count: actionsExecuted, summaries: actionSummaries } = apply
          ? await executeActionsRef.current(answer)
          : { count: 0, summaries: [] };

        // An answer with nothing in it, not even reasoning, says nothing was
        // done rather than showing an empty bubble.
        const content =
          answer.length === 0 && reasoning.length === 0
            ? tRef.current('assistant.noActionTaken', {
                defaultValue:
                  'Nothing in that matched a change I can make to the trip.',
              })
            : answer;

        // Update message with final content and action count
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  content,
                  reasoning,
                  thinking: false,
                  actionsExecuted,
                  actionSummaries,
                  ...(apply ? {} : { actionsDeclined: true }),
                }
              : msg,
          ),
        );

        captureEvent('assistant_answer_received', {
          duration_ms: Date.now() - startedAt,
          answer_length: response.length,
          action_count: actionsExecuted,
          // How often the gate on deletions is met, and how often it refuses.
          deletion_count: deletions.length,
          deletions_declined: !apply,
        });
        // Which views people ask the model for, beside the ones a shortcut
        // opens, says whether the chat is read as a way to look at the trip.
        for (const view of listViewRequests(answer)) {
          captureEvent('assistant_view_shown', { view, via: 'model' });
        }

        // One $ai_generation per turn, sharing the turn's trace id and the
        // conversation's session id so PostHog groups them into a trace tree.
        posthog?.capture('$ai_generation', {
          $ai_trace_id: traceId,
          $ai_session_id: sessionIdRef.current,
          $ai_model: ASSISTANT_AI_MODEL,
          $ai_provider: 'kikouchou',
          $ai_input: redactAiMessages(fullMessages),
          $ai_output_choices: redactAiOutput(response),
          $ai_latency: (Date.now() - startedAt) / 1000,
          $ai_stream: true,
          // The answer is billed to the project, which the server's own
          // OpenRouter activity records. The client does not know the cost, so
          // it claims none rather than a false 0.
        });

        return 'answered';
      } catch (err) {
        if (!isSameConversation()) return 'abandoned';

        // The exchange never happened: leaving the prompt in the history would
        // send two user turns in a row.
        chatHistoryRef.current.pop();

        const detail = err instanceof Error ? err.message : String(err);
        const content = tRef.current('assistant.generationFailed', {
          defaultValue: 'Could not answer that: {{error}}',
          error: detail,
        });

        console.error('Assistant generation failed:', err);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId ? { ...msg, content, failed: true } : msg,
          ),
        );

        captureEvent('assistant_answer_failed', {
          duration_ms: Date.now() - startedAt,
        });

        posthog?.capture('$ai_generation', {
          $ai_trace_id: traceId,
          $ai_session_id: sessionIdRef.current,
          $ai_model: ASSISTANT_AI_MODEL,
          $ai_provider: 'kikouchou',
          $ai_input: redactAiMessages(fullMessages),
          $ai_latency: (Date.now() - startedAt) / 1000,
          $ai_stream: true,
          $ai_is_error: true,
          $ai_error: detail,
        });

        return 'failed';
      }
    },
    [askBeforeDeleting],
  );

  /**
   * Answers queued prompts one at a time. Re-entrant calls are no-ops: the loop
   * already running picks up anything appended while it works.
   */
  const drainQueue = useCallback(async (): Promise<void> => {
    if (isDrainingRef.current) return;

    isDrainingRef.current = true;
    setIsAnswering(true);
    try {
      let next = queueRef.current.shift();
      while (next !== undefined) {
        await runTurn(next);
        next = queueRef.current.shift();
      }
    } finally {
      isDrainingRef.current = false;
      setIsAnswering(false);
    }
  }, [runTurn]);

  const handleSend = useCallback(
    (text: string): void => {
      const messageId = nextMessageId();

      // The prompt text itself, which is the point: knowing *what* people ask
      // the assistant is the only way to tell whether it answers the questions
      // they actually have.
      //
      // Worth being explicit that this is the one capture in the app carrying
      // free-text user content. A prompt about a trip routinely names its guests
      // and where they are staying, and those people are not users of this app
      // and have not agreed to anything. `prompt_length` is kept alongside so
      // the volume question stays answerable if the text is ever dropped.
      captureUsage('assistant_prompt_sent', {
        prompt: text,
        prompt_length: text.length,
        model_id: ASSISTANT_MODEL_ID,
        // Read before the push below, so this is the depth the prompt waited
        // behind rather than including itself.
        queue_depth: queueRef.current.length,
        engine_status: status,
      });

      // Show the prompt straight away; `queued` is cleared when its turn starts.
      setMessages((prev) => [
        ...prev,
        { id: messageId, role: 'user', content: text, queued: true },
      ]);
      // A prompt the user just sent should always scroll into view.
      isPinnedToBottomRef.current = true;

      queueRef.current.push({ messageId, text });
      void drainQueue();
    },
    [drainQueue, status],
  );

  // A starter tapped before signing in, sent once the account answers. The
  // take forgets it, so StrictMode's second run finds nothing to send twice.
  useEffect(() => {
    if (status !== 'ready') return;
    const pending = takePendingPrompt();
    if (pending !== null) handleSend(pending.text);
  }, [handleSend, status]);

  const handleStarterPick = useCallback(
    (text: string, kind: StarterKind): void => {
      const needsAccount = !accountSignedIn;
      captureEvent('assistant_starter_picked', {
        starter_kind: kind,
        model_id: ASSISTANT_MODEL_ID,
        needs_sign_in: needsAccount,
      });
      if (!needsAccount) {
        handleSend(text);
        return;
      }

      storePendingPrompt({ text, kind });
      setSignInOpen(true);
    },
    [accountSignedIn, handleSend],
  );

  const handleAccountSignIn = useCallback((): void => {
    captureEvent('assistant_sign_in_requested', { model_id: ASSISTANT_MODEL_ID });
    setSignInOpen(true);
  }, []);

  const handleClearQueue = useCallback((): void => {
    const dropped = queueRef.current;
    if (dropped.length === 0) return;
    queueRef.current = [];

    const droppedIds = new Set(dropped.map((prompt) => prompt.messageId));
    setMessages((prev) => prev.filter((msg) => !droppedIds.has(msg.id)));
    // Deliberately a raw confirmation: the queue lives in memory, nothing was saved.
    notify.success(t('assistant.queueCleared', { count: dropped.length }));
  }, [t]);

  /**
   * Opens a view from a shortcut, with no model turn: the label as the user's
   * line and the `showView` block as the answer, both kept out of the history
   * the model reads.
   */
  const handleShowView = useCallback(
    (view: AssistantView): void => {
      captureEvent('assistant_view_shown', { view, via: 'shortcut' });
      setMessages((prev) => [
        ...prev,
        {
          id: nextMessageId(),
          role: 'user',
          content: t(`assistant.views.${view}.request`),
          shortcut: true,
        },
        {
          id: nextMessageId(),
          role: 'assistant',
          content: buildShowViewBlock(view),
          shortcut: true,
        },
      ]);
      isPinnedToBottomRef.current = true;
    },
    [t],
  );

  const handleClearConversation = useCallback(() => {
    // Stop the answer in flight and drop everything still waiting, or they
    // would keep writing into a transcript the user just emptied.
    queueRef.current = [];
    conversationVersionRef.current += 1;
    interrupt();
    setMessages([]);
    chatHistoryRef.current = [];
    clearAssistantChatStorage();
    // A cleared transcript is a new conversation for AI observability too.
    sessionIdRef.current = getOrCreateAssistantSessionId();
    // Deliberately a raw confirmation: this erases local chat state, it saves nothing.
    notify.success(t('assistant.conversationCleared'));
  }, [interrupt, t]);

  const isReady = status === 'ready' || status === 'generating';
  const queuedCount = useMemo(
    () => messages.reduce((count, msg) => (msg.queued ? count + 1 : count), 0),
    [messages],
  );

  return (
    <div
      className={cn(
        'container mx-auto flex min-h-0 max-w-3xl flex-col',
        /* Fits in Layout main: sticky header (h-14) + main pt-4 + main pb (pb-20 mobile, pb-4 md) */
        'h-[calc(100dvh-3.5rem-1rem-5rem)] md:h-[calc(100dvh-3.5rem-1rem-1rem)]',
      )}
    >
      <PageHeader
        title={t('assistant.title', 'AI Assistant')}
        description={t(
          'assistant.pageDescription',
          'Ask questions or modify your trip using natural language',
        )}
        action={
          isReady && messages.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  aria-label={t('assistant.clearConversation')}
                  onClick={handleClearConversation}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">
                    {t('assistant.clearConversation')}
                  </span>
                </Button>
          ) : undefined
        }
      />

      {!accountsAvailable ? (
        <AssistantUnavailableCard />
      ) : !isReady ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          <AccountAssistantCard
            onPick={handleStarterPick}
            onSignIn={handleAccountSignIn}
            error={error}
          />
        </div>
      ) : (
        <>
          {/* Messages area — only this region scrolls; input stays visible above mobile nav */}
          <div
            ref={messagesScrollRef}
            onScroll={handleMessagesScroll}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-4"
          >
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-3">
                <Bot className="size-12 opacity-50" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    {t(
                      'assistant.emptyTitle',
                      'Ready to help with your trip!',
                    )}
                  </p>
                  <p className="text-xs max-w-sm">
                    {t(
                      'assistant.emptyHint',
                      'Try asking "Who is staying tonight?" or "Add a guest named Alice"',
                    )}
                  </p>
                </div>
                <StarterPrompts
                  onPick={handleStarterPick}
                  disabled={isAnswering || queuedCount > 0}
                />
              </div>
            )}

            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}

            <div ref={messagesEndRef} />
          </div>

          {/* Disabled while an answer runs or a prompt waits: the answer lands
              after the prompt that asked for it, and a view slipped in between
              would split the pair the model's history is rebuilt from. */}
          <ViewShortcuts
            onShowView={handleShowView}
            disabled={isAnswering || queuedCount > 0}
          />

          {/* Input area — stays live while answering so prompts can be queued */}
          <ChatInput
            onSend={handleSend}
            isGenerating={isAnswering}
            onStop={interrupt}
            disabled={status !== 'ready' && status !== 'generating'}
            queuedCount={queuedCount}
            onClearQueue={handleClearQueue}
          />

          <ConfirmDialog
            open={pendingDeletions !== null}
            onOpenChange={handleDeletionsOpenChange}
            title={t('assistant.confirmDeletions.title', 'Apply these deletions?')}
            description={pendingDeletionsDescription}
            confirmLabel={t('assistant.confirmDeletions.apply', 'Apply')}
            variant="destructive"
            onConfirm={handleDeletionsConfirmed}
          />
        </>
      )}

      <SignInDialog
        open={signInOpen}
        onOpenChange={setSignInOpen}
        title={t('assistant.account.signInTitle', 'Sign in to ask the assistant')}
        reason={t(
          'assistant.account.signInReason',
          'The Kikouchou server answers your questions, and it answers accounts: a free account is all it takes.',
        )}
        detail={t(
          'assistant.account.signInDetail',
          'Your question is kept and sent as soon as you are back.',
        )}
      />
    </div>
  );
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Memoized Assistant page component.
 */
export const AssistantPage = memo(AssistantPageComponent);
