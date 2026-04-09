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
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  Download,
  Loader2,
  Send,
  Square,
  Sparkles,
} from 'lucide-react';

import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

import {
  ChatMessage,
  type ChatMessageData,
} from '../components/ChatMessage';
import { useTripActions } from '../hooks/useTripActions';
import { useTripSystemPrompt } from '../hooks/useTripSystemPrompt';
import { type ChatMessage as LLMChatMessage, useWebLLM } from '../hooks/useWebLLM';

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
  readonly loadProgress: { text: string; progress: number } | null;
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
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2
                  className="size-4 animate-spin"
                  aria-hidden="true"
                />
                <span className="truncate">{loadProgress.text}</span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{
                    width: `${Math.round(loadProgress.progress * 100)}%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-center">
                {Math.round(loadProgress.progress * 100)}%
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
    <div className="border-t bg-background p-3">
      <div className="flex items-end gap-2 max-w-3xl mx-auto">
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

  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatHistoryRef = useRef<LLMChatMessage[]>([]);

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
        const actionsExecuted = await executeActions(response);

        // Update message with final content and action count
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? { ...msg, content: response, actionsExecuted }
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

  const isReady = status === 'ready' || status === 'generating';

  return (
    <div className="container mx-auto flex h-[calc(100vh-3.5rem-2rem)] max-w-3xl flex-col">
      <PageHeader
        title={t('assistant.title', 'AI Assistant')}
        description={t(
          'assistant.pageDescription',
          'Ask questions or modify your trip using natural language',
        )}
      />

      {!isReady ? (
        <ModelLoadingCard
          onLoad={loadModel}
          status={status}
          loadProgress={loadProgress}
          error={error}
        />
      ) : (
        <>
          {/* Messages area */}
          <div className="flex-1 overflow-y-auto space-y-3 py-4">
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
