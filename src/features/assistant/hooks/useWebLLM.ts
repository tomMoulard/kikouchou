/**
 * @fileoverview Custom hook for managing a selectable local LLM via
 * @huggingface/transformers (Transformers.js).
 * Handles model loading, chat completion with streaming, and lifecycle.
 *
 * @module features/assistant/hooks/useWebLLM
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import i18n from '@/lib/i18n';
import type { AssistantModelPreset } from '../models';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Possible states for the engine lifecycle.
 */
export type EngineStatus = 'idle' | 'loading' | 'ready' | 'generating' | 'error';

/**
 * Progress information during model download/loading.
 */
export interface LoadProgress {
  /** Human-readable progress text */
  readonly text: string;
  /**
   * Progress 0–1 for the **current file** only (Transformers.js reports per shard).
   * The bar resets when a new file starts; see UI caption.
   */
  readonly progress: number;
  /** Optional transferred size for the current file (e.g. `12.4 MB / 450 MB`). */
  readonly bytesHint?: string;
}

/**
 * A single chat message.
 */
export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

/**
 * Return type of the useWebLLM hook.
 */
export interface UseWebLLMReturn {
  /** Current engine status */
  readonly status: EngineStatus;
  /** Loading progress information */
  readonly loadProgress: LoadProgress | null;
  /** Error message if engine failed to load or generate */
  readonly error: string | null;
  /** Whether the model files are already cached in the browser */
  readonly isCached: boolean | null;
  /** Initialize and load the model */
  loadModel: () => Promise<void>;
  /** Generate a chat completion from a message history */
  generate: (
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
  ) => Promise<string>;
  /** Interrupt an ongoing generation */
  interrupt: () => void;
  /** Unload the model and free resources */
  unload: () => Promise<void>;
}

/**
 * Cache name used by @huggingface/transformers to store downloaded model files.
 */
const TRANSFORMERS_CACHE_NAME = 'transformers-cache';

/**
 * Formats a byte count for short progress lines.
 */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

// ============================================================================
// Cache Detection
// ============================================================================

/**
 * Checks whether the model files are already cached in the browser's Cache API.
 * Looks for entries under the transformers-cache that match our MODEL_ID.
 *
 * @returns `true` if cached files are found, `false` otherwise
 */
async function isModelCached(modelId: string): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;
    const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
    const keys = await cache.keys();
    // Check if at least one cached entry belongs to our model
    return keys.some(
      (req) =>
        req.url.includes(modelId.replace('/', '%2F')) || req.url.includes(modelId),
    );
  } catch {
    return false;
  }
}

// ============================================================================
// Module-level singleton state
// ============================================================================

/**
 * Holds the loaded text-generation pipeline.
 * Module-level to survive React strict-mode double-mounts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipelineInstance: any = null;

/**
 * Hugging Face model ID associated with the currently loaded pipeline.
 */
let loadedModelId: string | null = null;

/**
 * Reference to the dynamically imported TextStreamer class.
 * Stored at module level so `generate` can create instances without
 * re-importing the entire library.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let TextStreamerClass: any = null;

/**
 * Flag used by the interrupt mechanism.
 */
let shouldStop = false;

/**
 * Disposes the currently loaded pipeline, if any.
 */
async function disposeLoadedPipeline(): Promise<void> {
  if (pipelineInstance !== null) {
    await pipelineInstance.dispose?.();
    pipelineInstance = null;
  }
  TextStreamerClass = null;
  loadedModelId = null;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook that manages a local selectable model for on-device inference
 * via Hugging Face Transformers.js.
 *
 * @param preset - Selected assistant model preset
 * @returns Engine state and control functions
 *
 * @example
 * ```tsx
 * const { status, loadModel, generate, error } = useWebLLM(preset);
 *
 * await loadModel();
 *
 * const response = await generate([
 *   { role: 'system', content: 'You are a helpful assistant.' },
 *   { role: 'user', content: 'Hello!' },
 * ]);
 * ```
 */
export function useWebLLM(preset: AssistantModelPreset): UseWebLLMReturn {
  const [status, setStatus] = useState<EngineStatus>(
    pipelineInstance !== null && loadedModelId === preset.modelId ? 'ready' : 'idle',
  );
  const [loadProgress, setLoadProgress] = useState<LoadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCached, setIsCached] = useState<boolean | null>(null);

  // Track whether we're currently loading (to prevent double-loading)
  const loadingRef = useRef(false);

  // Track the selected preset and cache availability.
  useEffect(() => {
    if (pipelineInstance !== null && loadedModelId === preset.modelId) {
      // Already loaded in memory — no need to check cache.
      setStatus('ready');
      setIsCached(true);
      return;
    }

    setStatus('idle');
    setLoadProgress(null);
    setError(null);
    setIsCached(null);

    void isModelCached(preset.modelId).then(setIsCached);
  }, [preset.modelId]);

  // ------------------------------------------------------------------
  // loadModel
  // ------------------------------------------------------------------
  const loadModel = useCallback(async (): Promise<void> => {
    if (loadingRef.current) {
      return;
    }

    if (pipelineInstance !== null && loadedModelId === preset.modelId) {
      return;
    }

    loadingRef.current = true;
    setStatus('loading');
    setError(null);
    setLoadProgress({
      text: i18n.t('assistant.initializingLoader', {
        defaultValue: 'Initializing…',
      }),
      progress: 0,
    });

    try {
      // Dynamic import so the heavy library is only pulled in on demand
      const transformers = await import('@huggingface/transformers');

      // Disable local model checks — always use HuggingFace Hub / browser cache
      transformers.env.allowLocalModels = false;

      // Store the TextStreamer class for later use in generate()
      TextStreamerClass = transformers.TextStreamer;

      if (pipelineInstance !== null && loadedModelId !== preset.modelId) {
        await disposeLoadedPipeline();
      }

      const generator = await transformers.pipeline(
        'text-generation',
        preset.modelId,
        {
          dtype: preset.dtype,
          ...(preset.device ? { device: preset.device } : {}),
          progress_callback: (progress: {
            status: string;
            file?: string;
            progress?: number;
            loaded?: number;
            total?: number;
          }) => {
            const fileName = progress.file?.split('/').pop() ?? '';

            if (
              progress.status === 'progress' &&
              progress.progress != null
            ) {
              const pct = Math.round(progress.progress);
              const loaded = progress.loaded;
              const total = progress.total;
              const bytesHint =
                typeof loaded === 'number' &&
                typeof total === 'number' &&
                total > 0
                  ? `${formatBytes(loaded)} / ${formatBytes(total)}`
                  : undefined;

              setLoadProgress({
                text: i18n.t('assistant.downloadingFile', {
                  file: fileName || '…',
                  percent: pct,
                  defaultValue:
                    'Downloading {{file}} — {{percent}}% of this file',
                }),
                progress: progress.progress / 100,
                bytesHint,
              });
            } else if (progress.status === 'initiate') {
              setLoadProgress({
                text: i18n.t('assistant.preparingFile', {
                  file: fileName || 'model',
                  defaultValue: 'Preparing {{file}}…',
                }),
                progress: 0,
                bytesHint: undefined,
              });
            } else if (progress.status === 'done') {
              setLoadProgress((prev) => ({
                text: i18n.t('assistant.fileDownloadDone', {
                  file: fileName || '…',
                  defaultValue: 'Finished {{file}}',
                }),
                progress: prev?.progress ?? 0,
                bytesHint: undefined,
              }));
            }
          },
        },
      );

      pipelineInstance = generator;
      loadedModelId = preset.modelId;
      setStatus('ready');
      setLoadProgress(null);
      setIsCached(true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load model';
      setError(message);
      setStatus('error');
      setLoadProgress(null);
    } finally {
      loadingRef.current = false;
    }
  }, [preset.device, preset.dtype, preset.modelId]);

  // ------------------------------------------------------------------
  // generate
  // ------------------------------------------------------------------
  const generate = useCallback(
    async (
      messages: ChatMessage[],
      onChunk?: (chunk: string) => void,
    ): Promise<string> => {
      if (pipelineInstance === null || loadedModelId !== preset.modelId) {
        throw new Error('Model not loaded. Call loadModel() first.');
      }

      setStatus('generating');
      setError(null);
      shouldStop = false;

      let fullResponse = '';

      try {
        // Build a proper TextStreamer that decodes token IDs into text.
        // The pipeline exposes its tokenizer at `pipelineInstance.tokenizer`.
        const streamer =
          TextStreamerClass && pipelineInstance.tokenizer
            ? new TextStreamerClass(pipelineInstance.tokenizer, {
                skip_prompt: true,
                skip_special_tokens: true,
                callback_function: (text: string) => {
                  if (shouldStop) return;
                  fullResponse += text;
                  onChunk?.(fullResponse);
                },
              })
            : undefined;

        const output = await pipelineInstance(messages, {
          max_new_tokens: 1024,
          temperature: 0.7,
          do_sample: true,
          return_full_text: false,
          ...(streamer ? { streamer } : {}),
          // Interrupt hook: the callback_function is called per-step
          // and throwing inside it aborts generation early.
          callback_function: () => {
            if (shouldStop) {
              throw new Error('__interrupted__');
            }
          },
        });

        // If streamer wasn't available (fallback), extract from pipeline output
        if (!fullResponse && Array.isArray(output) && output.length > 0) {
          const generated = output[0]?.generated_text;
          if (typeof generated === 'string') {
            fullResponse = generated;
          } else if (Array.isArray(generated)) {
            // Chat-style output: array of {role, content}
            const last = generated[generated.length - 1];
            fullResponse =
              typeof last === 'object' && last?.content
                ? String(last.content)
                : '';
          }
        }

        setStatus('ready');
        return fullResponse;
      } catch (err) {
        if (
          err instanceof Error &&
          err.message === '__interrupted__'
        ) {
          setStatus('ready');
          return fullResponse;
        }
        const message =
          err instanceof Error ? err.message : 'Generation failed';
        setError(message);
        setStatus('ready');
        throw err;
      }
    },
    [preset.modelId],
  );

  // ------------------------------------------------------------------
  // interrupt
  // ------------------------------------------------------------------
  const interrupt = useCallback((): void => {
    shouldStop = true;
  }, []);

  // ------------------------------------------------------------------
  // unload
  // ------------------------------------------------------------------
  const unload = useCallback(async (): Promise<void> => {
    await disposeLoadedPipeline();
    setStatus('idle');
    setLoadProgress(null);
    setError(null);
    setIsCached(null);
    void isModelCached(preset.modelId).then(setIsCached);
  }, [preset.modelId]);

  return {
    status,
    loadProgress,
    error,
    isCached,
    loadModel,
    generate,
    interrupt,
    unload,
  };
}
