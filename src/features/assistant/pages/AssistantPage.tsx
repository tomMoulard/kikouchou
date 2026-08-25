/**
 * @fileoverview AI Assistant page that runs a selectable local model on-device
 * via @huggingface/transformers (Transformers.js). Users can ask questions
 * about their trip and request modifications to trip attributes (guests,
 * rooms, transports, assignments).
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
  Check,
  Download,
  Loader2,
  RotateCw,
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import { PageHeader } from '@/components/shared/PageHeader';

import { cn } from '@/lib/utils';
import { getSettings, updateSettings } from '@/lib/db';

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
import {
  ASSISTANT_MODEL_PRESETS,
  DEFAULT_ASSISTANT_MODEL_ID,
  getAssistantModelPreset,
  isAssistantModelId,
} from '../models';
import type { AssistantModelId } from '@/types';

// ============================================================================
// Model Selection UI
// ============================================================================

const TRANSFORMERS_CACHE_NAME = 'transformers-cache';

async function getCachedAssistantModelIds(): Promise<Set<AssistantModelId>> {
  const cached = new Set<AssistantModelId>();
  if (typeof caches === 'undefined') return cached;

  try {
    const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
    const keys = await cache.keys();

    for (const preset of ASSISTANT_MODEL_PRESETS) {
      const encoded = preset.modelId.replace('/', '%2F');
      const found = keys.some(
        (req) => req.url.includes(encoded) || req.url.includes(preset.modelId),
      );
      if (found) {
        cached.add(preset.id);
      }
    }
  } catch {
    // Ignore cache read failures and keep empty set.
  }

  return cached;
}

const CachedModelIcon = memo(function CachedModelIcon(): ReactElement {
  return (
    <span
      className="relative inline-flex size-4 items-center justify-center text-muted-foreground"
      aria-hidden="true"
    >
      <RotateCw className="size-4" strokeWidth={2.25} />
      <Check
        className="absolute size-2.5 text-foreground"
        strokeWidth={3}
      />
    </span>
  );
});

/**
 * Compact model picker for the header when the engine is ready (replaces the full card).
 */
const AssistantModelCompactSelect = memo(function AssistantModelCompactSelect({
  selectedModelId,
  onModelChange,
  disabled,
  cachedModelIds,
}: {
  readonly selectedModelId: AssistantModelId;
  readonly onModelChange: (value: string) => void;
  readonly disabled: boolean;
  readonly cachedModelIds: ReadonlySet<AssistantModelId>;
}): ReactElement {
  const { t } = useTranslation();

  return (
    <Select
      value={selectedModelId}
      onValueChange={onModelChange}
      disabled={disabled}
    >
      <SelectTrigger
        id="assistant-model-select-compact"
        size="sm"
        className="max-w-[12rem] sm:max-w-[16rem]"
        aria-label={t('assistant.modelLabel', 'Assistant model')}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {ASSISTANT_MODEL_PRESETS.map((preset) => (
          <SelectItem key={preset.id} value={preset.id}>
            <span className="inline-flex items-center gap-1.5">
              <span>{`${t(preset.nameKey, preset.fallbackName)} (${preset.id})`}</span>
              {cachedModelIds.has(preset.id) ? <CachedModelIcon /> : null}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
});

const AssistantModelPanel = memo(function AssistantModelPanel({
  selectedModelId,
  onModelChange,
  disabled,
  isCached,
  cachedModelIds,
}: {
  readonly selectedModelId: AssistantModelId;
  readonly onModelChange: (value: string) => void;
  readonly disabled: boolean;
  readonly isCached: boolean | null;
  readonly cachedModelIds: ReadonlySet<AssistantModelId>;
}): ReactElement {
  const { t } = useTranslation();
  const selectedModel = getAssistantModelPreset(selectedModelId);

  return (
    <Card className="mb-4">
      <CardContent className="space-y-3 pt-4">
        <div className="space-y-1">
          <Label htmlFor="assistant-model-select">
            {t('assistant.modelLabel', 'Assistant model')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t(
              'assistant.modelDescription',
              'Pick a smaller model for weaker devices or a bigger one for better quality.',
            )}
          </p>
        </div>

        <Select
          value={selectedModelId}
          onValueChange={onModelChange}
          disabled={disabled}
        >
          <SelectTrigger
            id="assistant-model-select"
            className="w-full"
            aria-label={t('assistant.modelLabel', 'Assistant model')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ASSISTANT_MODEL_PRESETS.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                <span className="inline-flex items-center gap-1.5">
                  <span>{`${t(preset.nameKey, preset.fallbackName)} (${preset.id})`}</span>
                  {cachedModelIds.has(preset.id) ? <CachedModelIcon /> : null}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground font-mono break-all">
          {t('assistant.hubModelLabel', {
            defaultValue: 'HF model: {{model}}',
            model: selectedModel.modelId,
          })}
        </p>

        <div className="space-y-1">
          <p className="text-sm text-foreground">
            {t(selectedModel.descriptionKey, selectedModel.fallbackDescription)}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(selectedModel.hintKey, selectedModel.fallbackHint)}
          </p>
          {isCached === true && (
            <p className="text-xs text-primary">
              {t(
                'assistant.modelCached',
                'This model is already cached on this device.',
              )}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
});

// ============================================================================
// Helper
// ============================================================================

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
  const activeFiles = loadProgress?.files.filter((f) => !f.done) ?? [];

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
            <div className="space-y-3">
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <Loader2
                  className="size-4 shrink-0 animate-spin mt-0.5"
                  aria-hidden="true"
                />
                <span className="min-w-0 text-left leading-snug">
                  {loadProgress.text}
                </span>
              </div>

              {loadProgress.files.length > 0 ? (
                <>
                  <div className="space-y-1.5">
                    <div
                      className="h-2 w-full overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(loadProgress.progress * 100)}
                      aria-label={t(
                        'assistant.loadingOverallProgressAria',
                        'Overall model download progress',
                      )}
                    >
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                        style={{
                          width: `${Math.round(loadProgress.progress * 100)}%`,
                        }}
                      />
                    </div>
                    <p className="text-right text-xs tabular-nums text-muted-foreground">
                      {Math.round(loadProgress.progress * 100)}%
                    </p>
                  </div>

                  {activeFiles.length > 0 ? (
                    <ul
                      className="list-none space-y-3 p-0"
                      aria-label={t(
                        'assistant.modelFilesListAria',
                        'Per-file download progress',
                      )}
                    >
                      {activeFiles.map((f) => (
                        <li key={f.fileKey} className="space-y-1.5">
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <p
                              className="truncate text-xs font-medium text-foreground"
                              title={f.fileName}
                            >
                              {f.fileName}
                            </p>
                          </div>
                          <div
                            className="h-2 w-full overflow-hidden rounded-full bg-muted"
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(f.progress * 100)}
                            aria-label={t('assistant.fileDownloadProgressAria', {
                              defaultValue: 'Download progress for {{file}}',
                              file: f.fileName,
                            })}
                          >
                            <div
                              className={cn(
                                'h-full rounded-full bg-primary transition-[width] duration-300 ease-out',
                              )}
                              style={{
                                width: `${Math.round(f.progress * 100)}%`,
                              }}
                            />
                          </div>
                          {f.bytesHint ? (
                            <p className="text-xs text-muted-foreground tabular-nums">
                              {f.bytesHint}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : (
                <>
                  <div
                    className="h-2 w-full overflow-hidden rounded-full bg-muted"
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
                    <p className="text-center text-xs text-muted-foreground tabular-nums">
                      {loadProgress.bytesHint}
                    </p>
                  ) : null}
                </>
              )}

              {loadProgress.files.length > 0 ? (
                <p className="text-center text-xs text-balance text-muted-foreground">
                  {t(
                    'assistant.loadingProgressCaption',
                    'Top bar: overall model download progress. List: only files currently downloading.',
                  )}
                </p>
              ) : null}
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
  const [selectedModelId, setSelectedModelId] =
    useState<AssistantModelId>(DEFAULT_ASSISTANT_MODEL_ID);
  const [cachedModelIds, setCachedModelIds] = useState<Set<AssistantModelId>>(
    () => new Set(),
  );
  const [isModelPreferenceReady, setIsModelPreferenceReady] = useState(false);
  const selectedModel = getAssistantModelPreset(selectedModelId);
  const {
    status,
    loadProgress,
    error,
    isCached,
    loadModel,
    generate,
    interrupt,
    unload,
  } = useWebLLM(selectedModel);
  const { systemPrompt } = useTripSystemPrompt();
  const { executeActions } = useTripActions();

  const [messages, setMessages] = useState<ChatMessageData[]>(() =>
    loadAssistantChatMessages(),
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const isPinnedToBottomRef = useRef(true);
  const chatHistoryRef = useRef<LLMChatMessage[]>([]);
  const hasUserChangedModelRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function loadModelPreference(): Promise<void> {
      try {
        const settings = await getSettings();
        if (
          !cancelled &&
          !hasUserChangedModelRef.current &&
          settings.assistantModelId
        ) {
          setSelectedModelId(settings.assistantModelId);
        }
      } catch (settingsError) {
        console.error('Failed to load assistant model preference:', settingsError);
      } finally {
        if (!cancelled) {
          setIsModelPreferenceReady(true);
        }
      }
    }

    void loadModelPreference();
    return () => {
      cancelled = true;
    };
  }, []);

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
    if (!isModelPreferenceReady) {
      return;
    }

    if (isCached === true && status === 'idle') {
      loadModel();
    }
  }, [isCached, isModelPreferenceReady, status, loadModel]);

  useEffect(() => {
    void getCachedAssistantModelIds().then(setCachedModelIds);
  }, []);

  useEffect(() => {
    if (isCached !== true) return;
    setCachedModelIds((prev) => {
      if (prev.has(selectedModelId)) return prev;
      const next = new Set(prev);
      next.add(selectedModelId);
      return next;
    });
  }, [isCached, selectedModelId]);

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

  const handleSend = useCallback(
    async (text: string) => {
      // Add user message
      const userMsg: ChatMessageData = {
        id: nextMessageId(),
        role: 'user',
        content: text,
      };
      setMessages((prev) => [...prev, userMsg]);
      // A prompt the user just sent should always scroll into view.
      isPinnedToBottomRef.current = true;

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

  const handleModelChange = useCallback(
    async (value: string): Promise<void> => {
      if (!isAssistantModelId(value) || value === selectedModelId) {
        return;
      }

      const previousModelId = selectedModelId;
      hasUserChangedModelRef.current = true;
      setSelectedModelId(value);

      try {
        if (status !== 'idle') {
          await unload();
        }
        await updateSettings({ assistantModelId: value });
        toast.success(
          t('assistant.modelChanged', {
            model: t(
              getAssistantModelPreset(value).nameKey,
              getAssistantModelPreset(value).fallbackName,
            ),
            defaultValue: 'Assistant model set to {{model}}',
          }),
        );
      } catch (changeError) {
        console.error('Failed to update assistant model:', changeError);
        setSelectedModelId(previousModelId);
        toast.error(
          t(
            'assistant.modelChangeFailed',
            'Could not switch the assistant model. Please try again.',
          ),
        );
      }
    },
    [selectedModelId, status, t, unload],
  );

  const isReady = status === 'ready' || status === 'generating';
  const isModelSelectionLocked = status === 'loading' || status === 'generating';

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
          isReady ? (
            <>
              <AssistantModelCompactSelect
                selectedModelId={selectedModelId}
                onModelChange={(value) => {
                  void handleModelChange(value);
                }}
                disabled={isModelSelectionLocked}
                cachedModelIds={cachedModelIds}
              />
              {messages.length > 0 ? (
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
              ) : null}
            </>
          ) : undefined
        }
      />

      {!isReady ? (
        <>
          <AssistantModelPanel
            selectedModelId={selectedModelId}
            onModelChange={(value) => {
              void handleModelChange(value);
            }}
            disabled={isModelSelectionLocked}
            isCached={isCached}
            cachedModelIds={cachedModelIds}
          />
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <ModelLoadingCard
              onLoad={loadModel}
              status={status}
              loadProgress={loadProgress}
              error={error}
            />
          </div>
        </>
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
