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
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { nanoid } from 'nanoid';
import { toast } from 'sonner';
import {
  Bot,
  Check,
  Download,
  ListPlus,
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
  getOrCreateAssistantSessionId,
  loadAssistantChatMessages,
  messagesToLLMChatHistory,
  saveAssistantChatMessages,
  trimChatHistoryForPrompt,
} from '../chat-storage';
import { useTripActions } from '../hooks/useTripActions';
import { useTripSystemPrompt } from '../hooks/useTripSystemPrompt';
import { useWebGPUSupport } from '../hooks/useWebGPUSupport';
import type { WebGPUSupport } from '../webgpu';
import {
  type ChatMessage as LLMChatMessage,
  type LoadProgress,
  isFatalEngineError,
  useWebLLM,
} from '../hooks/useWebLLM';
import {
  ASSISTANT_MODEL_PRESETS,
  DEFAULT_ASSISTANT_MODEL_ID,
  getAssistantModelPreset,
  isAssistantModelId,
} from '../models';
import posthog, { captureUsage } from '@/lib/posthog';
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
 * How one queued turn ended. `engine-lost` means the inference session died and
 * is being rebuilt, so nothing else can run until it is back.
 */
type TurnOutcome = 'answered' | 'failed' | 'abandoned' | 'engine-lost';

/**
 * A prompt accepted by the UI and waiting for the assistant to reach it.
 */
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
 * Whether this device can run the selected preset at all.
 *
 * One prop rather than "does it need WebGPU" plus "does it have WebGPU": the
 * two can disagree, and the card has no way to notice when they do.
 */
type DeviceSupport = 'probing' | 'supported' | 'unsupported';

/**
 * Folds "does this preset need WebGPU" and "can this device supply it" into the
 * single verdict the card renders from.
 *
 * A preset with no `device` runs on the Transformers.js default (WASM/CPU) and
 * is never gated — the probe's answer is irrelevant to it.
 */
function resolveDeviceSupport(
  requiresWebGPU: boolean,
  webgpuSupport: WebGPUSupport | null,
): DeviceSupport {
  if (!requiresWebGPU) return 'supported';
  if (webgpuSupport === null) return 'probing';
  return webgpuSupport === 'supported' ? 'supported' : 'unsupported';
}

/**
 * Model loading card shown before the engine is ready.
 */
const ModelLoadingCard = memo(function ModelLoadingCard({
  onLoad,
  status,
  loadProgress,
  error,
  deviceSupport,
}: {
  readonly onLoad: () => void;
  readonly status: string;
  readonly loadProgress: LoadProgress | null;
  readonly error: string | null;
  readonly deviceSupport: DeviceSupport;
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

          {(status === 'idle' || status === 'error') &&
            deviceSupport === 'unsupported' && (
              <div
                className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 space-y-1"
                role="alert"
              >
                <p className="text-sm font-medium text-destructive">
                  {t(
                    'assistant.deviceUnsupportedTitle',
                    'This device cannot run the assistant',
                  )}
                </p>
                <p className="text-sm text-destructive/90">
                  {t(
                    'assistant.deviceUnsupportedDescription',
                    'The assistant runs the model entirely on your own device, which needs WebGPU — and this browser cannot use it here. Open the app on a recent desktop Chrome, Edge or Safari to use it.',
                  )}
                </p>
              </div>
            )}

          {/* Nothing while the probe is in flight: offering a download that is
              about to be withdrawn is worse than a beat of empty card. */}
          {(status === 'idle' || status === 'error') &&
            deviceSupport === 'supported' && (
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
                    'Send another request — it will be answered next...',
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

  // Asked before the assistant offers a 2.5 GB download, not after it fails.
  const webgpuSupport = useWebGPUSupport();
  const deviceSupport = resolveDeviceSupport(
    selectedModel.device === 'webgpu',
    webgpuSupport,
  );

  const [messages, setMessages] = useState<ChatMessageData[]>(() =>
    loadAssistantChatMessages(),
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const isPinnedToBottomRef = useRef(true);
  const chatHistoryRef = useRef<LLMChatMessage[]>([]);
  const hasUserChangedModelRef = useRef(false);

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
  const generateRef = useRef(generate);
  generateRef.current = generate;
  const executeActionsRef = useRef(executeActions);
  executeActionsRef.current = executeActions;
  const selectedModelRef = useRef(selectedModel);
  selectedModelRef.current = selectedModel;
  const tRef = useRef(t);
  tRef.current = t;

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

  // Auto-load the model if it's already cached in the browser
  useEffect(() => {
    if (!isModelPreferenceReady) {
      return;
    }

    // Cached weights say the download once succeeded, not that the session can
    // be built now — a phone that cached the files on a supported browser would
    // otherwise auto-load straight into the failure the gate exists to prevent.
    if (deviceSupport !== 'supported') {
      return;
    }

    if (isCached === true && status === 'idle') {
      loadModel();
    }
  }, [isCached, isModelPreferenceReady, status, loadModel, deviceSupport]);

  // The gate is where the failure surfaces now, so it is also where it has to
  // be counted: hiding the button without this would take the one signal that
  // something is wrong — a load that fails — and replace it with silence.
  const reportedUnsupportedRef = useRef<string | null>(null);
  useEffect(() => {
    if (deviceSupport !== 'unsupported' || webgpuSupport === null) {
      return;
    }

    // Once per (device verdict, preset), not once per render.
    const key = `${webgpuSupport}:${selectedModel.modelId}`;
    if (reportedUnsupportedRef.current === key) {
      return;
    }
    reportedUnsupportedRef.current = key;

    posthog?.capture('assistant_device_unsupported', {
      reason: webgpuSupport,
      model_id: selectedModel.modelId,
      device: selectedModel.device ?? 'default',
    });
  }, [deviceSupport, webgpuSupport, selectedModel.modelId, selectedModel.device]);

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

  /**
   * Runs one queued prompt to completion: promote it out of the queue, stream
   * the answer, then apply any actions it asked for.
   */
  const runTurn = useCallback(
    async ({ messageId, text }: QueuedPrompt): Promise<TurnOutcome> => {
      // Wall clock, for the only performance question that matters here: how
      // long somebody waits for an answer on their own hardware. The model runs
      // in the browser, so this varies by device in a way no server metric would
      // show.
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

      // Built before the try/catch so a rejected generate() can still report
      // it in the $ai_generation failure capture below.
      //
      // The transcript keeps growing; the prompt must not. Prefill memory is
      // linear in prompt length and the models run on the user's own GPU, so an
      // uncapped history eventually fails to allocate rather than just slowing
      // down — hence the trim to the most recent exchanges.
      const fullMessages: LLMChatMessage[] = [
        { role: 'system', content: systemPromptRef.current },
        ...trimChatHistoryForPrompt(chatHistoryRef.current),
      ];

      try {
        const response = await generateRef.current(fullMessages, (chunk) => {
          // Update the assistant message with streaming content
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId ? { ...msg, content: chunk } : msg,
            ),
          );
        });

        // The transcript was cleared while this ran: its history is gone, so
        // appending the answer would leave a reply with nothing to reply to.
        if (!isSameConversation()) return 'abandoned';

        // Add to chat history
        chatHistoryRef.current.push({ role: 'assistant', content: response });

        // Execute any action blocks in the response
        const { count: actionsExecuted, summaries: actionSummaries } =
          await executeActionsRef.current(response);

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

        posthog?.capture('assistant_answer_received', {
          duration_ms: Date.now() - startedAt,
          answer_length: response.length,
          action_count: actionsExecuted,
        });

        // One $ai_generation per turn, sharing the turn's trace id and the
        // conversation's session id so PostHog groups them into a trace tree.
        posthog?.capture('$ai_generation', {
          $ai_trace_id: traceId,
          $ai_session_id: sessionIdRef.current,
          $ai_model: selectedModelRef.current.modelId,
          $ai_provider: 'huggingface',
          $ai_input: fullMessages,
          $ai_output_choices: [{ role: 'assistant', content: response }],
          $ai_latency: (Date.now() - startedAt) / 1000,
          $ai_stream: true,
          // Runs fully on-device via Transformers.js — there is no vendor
          // token cost to estimate.
          $ai_input_cost_usd: 0,
          $ai_output_cost_usd: 0,
          $ai_total_cost_usd: 0,
        });

        return 'answered';
      } catch (err) {
        const fatal = isFatalEngineError(err);

        if (!isSameConversation()) return fatal ? 'engine-lost' : 'abandoned';

        // The exchange never happened: leaving the prompt in the history would
        // send two user turns in a row, which Gemma's chat template rejects.
        chatHistoryRef.current.pop();

        const detail = err instanceof Error ? err.message : String(err);
        const content = fatal
          ? tRef.current('assistant.engineCrashed', {
              defaultValue:
                'The model ran out of GPU resources and had to restart. Reloading it now — send your request again in a moment.',
            })
          : tRef.current('assistant.generationFailed', {
              defaultValue: 'Could not answer that: {{error}}',
              error: detail,
            });

        console.error('Assistant generation failed:', err);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId ? { ...msg, content, failed: true } : msg,
          ),
        );

        posthog?.capture('assistant_answer_failed', {
          duration_ms: Date.now() - startedAt,
          // A crashed engine and a refused generation need different fixes: the
          // first is the device running out of GPU, the second is the model or
          // the prompt.
          fatal,
        });

        posthog?.capture('$ai_generation', {
          $ai_trace_id: traceId,
          $ai_session_id: sessionIdRef.current,
          $ai_model: selectedModelRef.current.modelId,
          $ai_provider: 'huggingface',
          $ai_input: fullMessages,
          $ai_latency: (Date.now() - startedAt) / 1000,
          $ai_stream: true,
          $ai_is_error: true,
          $ai_error: detail,
        });

        return fatal ? 'engine-lost' : 'failed';
      }
    },
    [],
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
        const outcome = await runTurn(next);
        if (outcome === 'engine-lost') {
          // Every further prompt would hit the same dead session. Leave them
          // queued; the reload effect below restarts the drain.
          return;
        }
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
        model_id: selectedModelId,
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
    [drainQueue, selectedModelId, status],
  );

  // The engine reloads itself after a crash (see useWebLLM); pick the queue up
  // again as soon as it can answer.
  useEffect(() => {
    if (status !== 'ready') return;
    if (queueRef.current.length === 0) return;
    void drainQueue();
  }, [status, drainQueue]);

  const handleClearQueue = useCallback((): void => {
    const dropped = queueRef.current;
    if (dropped.length === 0) return;
    queueRef.current = [];

    const droppedIds = new Set(dropped.map((prompt) => prompt.messageId));
    setMessages((prev) => prev.filter((msg) => !droppedIds.has(msg.id)));
    // Deliberately a raw toast: the queue lives in memory, nothing was saved.
    toast.success(t('assistant.queueCleared', { count: dropped.length }));
  }, [t]);

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
    // Deliberately a raw toast: this erases local chat state, it saves nothing.
    toast.success(t('assistant.conversationCleared'));
  }, [interrupt, t]);

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
        // Deliberately a raw toast: the chosen model is a device preference
        // that never syncs, so "Saved on this device" adds nothing while
        // dropping the model name the user needs to see.
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
  const isModelSelectionLocked =
    status === 'loading' || status === 'generating' || isAnswering;
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
              deviceSupport={deviceSupport}
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

          {/* Input area — stays live while answering so prompts can be queued */}
          <ChatInput
            onSend={handleSend}
            isGenerating={isAnswering}
            onStop={interrupt}
            disabled={status !== 'ready' && status !== 'generating'}
            queuedCount={queuedCount}
            onClearQueue={handleClearQueue}
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
