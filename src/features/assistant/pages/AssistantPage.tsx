/**
 * @fileoverview AI Assistant page that runs Gemma locally on-device via
 * @huggingface/transformers (Transformers.js).
 * Users can ask questions about their trip and request modifications to
 * trip attributes (guests, rooms, transports, assignments).
 *
 * @module features/assistant/pages/AssistantPage
 */

import {
  type ReactElement,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Bot,
  Download,
  Loader2,
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

import { PageHeader } from '@/components/shared/PageHeader';

import { cn } from '@/lib/utils';

import {
  ChatMessage,
  type ChatMessageData,
} from '../components/ChatMessage';
import {
  clearAssistantChatStorage,
  loadAssistantChatMessages,
  messagesToLLMChatHistory,
  saveAssistantChatMessages,
} from '../chat-storage';
import { useTripActions } from '../hooks/useTripActions';
import { useTripSystemPrompt } from '../hooks/useTripSystemPrompt';
import {
  type ChatMessage as LLMChatMessage,
  type LoadProgress,
  useWebLLM,
} from '../hooks/useWebLLM';

// ============================================================================
// Helper
// ============================================================================

let messageCounter = 0;
function nextMessageId(): string {
  return `msg-${++messageCounter}-${Date.now()}`;
}

// ============================================================================
// Sub-Components
// ============================================================================

/**
 * Model loading card shown before the engine is ready.
 */
const ModelLoadingCard = memo(function ModelLoadingCard({
  onLoad,
  status,
  loadProgress,
  error,
}: {
  readonly onLoad: () => void;
  readonly status: string;
  readonly loadProgress: LoadProgress | null;
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
            {t('assistant.title', 'AI Assistant')}
          </CardTitle>
          <CardDescription>
            {t(
              'assistant.description',
              'Run Gemma locally on your device to manage your trip with natural language.',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === 'loading' && loadProgress && (
            <div className="space-y-2">
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <Loader2
                  className="size-4 shrink-0 animate-spin mt-0.5"
                  aria-hidden="true"
                />
                <span className="min-w-0 text-left leading-snug">
                  {loadProgress.text}
                </span>
              </div>
              <div
                className="h-2 w-full rounded-full bg-muted overflow-hidden"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(loadProgress.progress * 100)}
                aria-label={t(
                  'assistant.loadingProgressAria',
                  'Download progress for the current file',
                )}
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                  style={{
                    width: `${Math.round(loadProgress.progress * 100)}%`,
                  }}
                />
              </div>
              {loadProgress.bytesHint ? (
                <p className="text-xs text-muted-foreground text-center tabular-nums">
                  {loadProgress.bytesHint}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground text-center text-balance">
                {t(
                  'assistant.loadingProgressCaption',
                  'The model is split into several files. They download one after another, so the bar restarts for each file. This is normal.',
                )}
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {(status === 'idle' || status === 'error') && (
            <>
              <p className="text-xs text-muted-foreground text-center">
                {t(
                  'assistant.loadHint',
                  'The model (~2.5 GB) will be downloaded and cached in your browser. Requires WebGPU support.',
                )}
              </p>
              <Button className="w-full" onClick={onLoad}>
                <Download className="size-4 mr-2" aria-hidden="true" />
                {t('assistant.loadModel', 'Load Model')}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
});

/**
 * Chat input area with a textarea and send/stop buttons.
 */
const ChatInput = memo(function ChatInput({
  onSend,
  isGenerating,
  onStop,
  disabled,
}: {
  readonly onSend: (message: string) => void;
  readonly isGenerating: boolean;
  readonly onStop: () => void;
  readonly disabled: boolean;
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
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t(
            'assistant.placeholder',
            'Ask about your trip or request changes...',
          )}
          disabled={disabled}
          className="min-h-10 max-h-32 resize-none"
          rows={1}
        />
        {isGenerating ? (
          <Button
            variant="destructive"
            size="icon"
            onClick={onStop}
            aria-label={t('assistant.stop', 'Stop generating')}
          >
            <Square className="size-4" aria-hidden="true" />
          </Button>
        ) : (
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!input.trim() || disabled}
            aria-label={t('assistant.send', 'Send message')}
          >
            <Send className="size-4" aria-hidden="true" />
          </Button>
        )}
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
 * - On-device Gemma model via @huggingface/transformers (WebGPU)
 * - Chat interface with streaming responses
 * - Trip context injected as system prompt
 * - Automatic action execution for trip modifications
 *
 * @returns The assistant page element
 */
function AssistantPageComponent(): ReactElement {
  const { t } = useTranslation();
  const { status, loadProgress, error, isCached, loadModel, generate, interrupt } =
    useWebLLM();
  const { systemPrompt } = useTripSystemPrompt();
  const { executeActions } = useTripActions();

  const [messages, setMessages] = useState<ChatMessageData[]>(() =>
    loadAssistantChatMessages(),
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatHistoryRef = useRef<LLMChatMessage[]>([]);

  // Restore LLM turn history from persisted UI messages (see handleSend for live updates).
  useLayoutEffect(() => {
    chatHistoryRef.current = messagesToLLMChatHistory(messages);
    // Sync only on mount: live updates stay in handleSend (placeholder assistant must not enter history).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist chat locally (debounced — avoids writes on every streaming chunk).
  useEffect(() => {
    const id = window.setTimeout(() => {
      saveAssistantChatMessages(messages);
    }, 400);
    return () => window.clearTimeout(id);
  }, [messages]);

  // Auto-load the model if it's already cached in the browser
  useEffect(() => {
    if (isCached === true && status === 'idle') {
      loadModel();
    }
  }, [isCached, status, loadModel]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(
    async (text: string) => {
      // Add user message
      const userMsg: ChatMessageData = {
        id: nextMessageId(),
        role: 'user',
        content: text,
      };
      setMessages((prev) => [...prev, userMsg]);

      // Build chat history for the LLM
      chatHistoryRef.current.push({ role: 'user', content: text });

      // Create assistant placeholder for streaming
      const assistantId = nextMessageId();
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: 'assistant', content: '' },
      ]);

      try {
        const fullMessages: LLMChatMessage[] = [
          { role: 'system', content: systemPrompt },
          ...chatHistoryRef.current,
        ];

        const response = await generate(fullMessages, (chunk) => {
          // Update the assistant message with streaming content
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId ? { ...msg, content: chunk } : msg,
            ),
          );
        });

        // Add to chat history
        chatHistoryRef.current.push({ role: 'assistant', content: response });

        // Execute any action blocks in the response
        const { count: actionsExecuted, summaries: actionSummaries } =
          await executeActions(response);

        // Update message with final content and action count
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  content: response,
                  actionsExecuted,
                  actionSummaries,
                }
              : msg,
          ),
        );
      } catch (err) {
        // On error, update the placeholder with error text
        const errorText =
          err instanceof Error ? err.message : 'Generation failed';
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? { ...msg, content: `Error: ${errorText}` }
              : msg,
          ),
        );
      }
    },
    [systemPrompt, generate, executeActions],
  );

  const handleClearConversation = useCallback(() => {
    setMessages([]);
    chatHistoryRef.current = [];
    clearAssistantChatStorage();
    toast.success(t('assistant.conversationCleared'));
  }, [t]);

  const isReady = status === 'ready' || status === 'generating';

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

      {!isReady ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <ModelLoadingCard
            onLoad={loadModel}
            status={status}
            loadProgress={loadProgress}
            error={error}
          />
        </div>
      ) : (
        <>
          {/* Messages area — only this region scrolls; input stays visible above mobile nav */}
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-4">
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
              </div>
            )}

            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}

            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <ChatInput
            onSend={handleSend}
            isGenerating={status === 'generating'}
            onStop={interrupt}
            disabled={status === 'generating'}
          />
        </>
      )}
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
