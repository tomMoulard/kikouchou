/**
 * @fileoverview Custom hook for managing a local Gemma model via
 * @huggingface/transformers (Transformers.js).
 * Handles model loading, chat completion with streaming, and lifecycle.
 *
 * @module features/assistant/hooks/useWebLLM
 */

import { useCallback, useEffect, useRef, useState } from 'react';

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
  /** Download progress from 0 to 1 (if available) */
  readonly progress: number;
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

// ============================================================================
// Constants
// ============================================================================

/**
 * The HuggingFace ONNX model ID for Gemma 4 (E2B = ~2B effective parameters).
 * Optimised for Transformers.js with WebGPU backend.
 */
const MODEL_ID = 'onnx-community/gemma-4-E2B-it-ONNX';

/**
 * Cache name used by @huggingface/transformers to store downloaded model files.
 */
const TRANSFORMERS_CACHE_NAME = 'transformers-cache';

// ============================================================================
// Cache Detection
// ============================================================================

/**
 * Checks whether the model files are already cached in the browser's Cache API.
 * Looks for entries under the transformers-cache that match our MODEL_ID.
 *
 * @returns `true` if cached files are found, `false` otherwise
 */
async function isModelCached(): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;
    const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
    const keys = await cache.keys();
    // Check if at least one cached entry belongs to our model
    return keys.some((req) => req.url.includes(MODEL_ID.replace('/', '%2F')) || req.url.includes(MODEL_ID));
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

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook that manages a local Gemma model for on-device inference
 * via Hugging Face Transformers.js.
 *
 * @returns Engine state and control functions
 *
 * @example
 * ```tsx
 * const { status, loadModel, generate, error } = useWebLLM();
 *
 * await loadModel();
 *
 * const response = await generate([
 *   { role: 'system', content: 'You are a helpful assistant.' },
 *   { role: 'user', content: 'Hello!' },
 * ]);
 * ```
 */
export function useWebLLM(): UseWebLLMReturn {
  const [status, setStatus] = useState<EngineStatus>(
    pipelineInstance ? 'ready' : 'idle',
  );
  const [loadProgress, setLoadProgress] = useState<LoadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCached, setIsCached] = useState<boolean | null>(null);

  // Track whether we're currently loading (to prevent double-loading)
  const loadingRef = useRef(false);

  // Check on mount whether the model is already cached in the browser
  useEffect(() => {
    if (pipelineInstance !== null) {
      // Already loaded in memory — no need to check cache
      setIsCached(true);
      return;
    }
    isModelCached().then(setIsCached);
  }, []);

  // ------------------------------------------------------------------
  // loadModel
  // ------------------------------------------------------------------
  const loadModel = useCallback(async (): Promise<void> => {
    if (pipelineInstance !== null || loadingRef.current) {
      return;
    }

    loadingRef.current = true;
    setStatus('loading');
    setError(null);
    setLoadProgress({ text: 'Initializing...', progress: 0 });

    try {
      // Dynamic import so the heavy library is only pulled in on demand
      const transformers = await import('@huggingface/transformers');

      // Disable local model checks — always use HuggingFace Hub / browser cache
      transformers.env.allowLocalModels = false;

      // Store the TextStreamer class for later use in generate()
      TextStreamerClass = transformers.TextStreamer;

      const generator = await transformers.pipeline(
        'text-generation',
        MODEL_ID,
        {
          dtype: 'q4f16',
          device: 'webgpu',
          progress_callback: (progress: {
            status: string;
            file?: string;
            progress?: number;
            loaded?: number;
            total?: number;
          }) => {
            if (
              progress.status === 'progress' &&
              progress.progress != null
            ) {
              const fileName = progress.file?.split('/').pop() ?? '';
              setLoadProgress({
                text: `Downloading ${fileName}`,
                progress: progress.progress / 100,
              });
            } else if (progress.status === 'initiate') {
              setLoadProgress({
                text: `Loading ${progress.file?.split('/').pop() ?? 'model'}...`,
                progress: 0,
              });
            } else if (progress.status === 'done') {
              setLoadProgress({ text: 'Finalizing...', progress: 1 });
            }
          },
        },
      );

      pipelineInstance = generator;
      setStatus('ready');
      setLoadProgress(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load model';
      setError(message);
      setStatus('error');
      setLoadProgress(null);
    } finally {
      loadingRef.current = false;
    }
  }, []);

  // ------------------------------------------------------------------
  // generate
  // ------------------------------------------------------------------
  const generate = useCallback(
    async (
      messages: ChatMessage[],
      onChunk?: (chunk: string) => void,
    ): Promise<string> => {
      if (pipelineInstance === null) {
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
    [],
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
    if (pipelineInstance !== null) {
      await pipelineInstance.dispose?.();
      pipelineInstance = null;
      TextStreamerClass = null;
    }
    setStatus('idle');
    setLoadProgress(null);
    setError(null);
  }, []);

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
