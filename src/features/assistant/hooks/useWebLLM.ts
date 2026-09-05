/**
 * @fileoverview Custom hook for managing a selectable local LLM via
 * @huggingface/transformers (Transformers.js).
 *
 * The heavy lifting — downloading weights, building the ONNX session and the
 * token loop — runs inside a dedicated worker (see `workers/llm.worker.ts`), so
 * loading or answering never freezes the page. This hook is the main-thread
 * client: it owns the worker, translates progress events into UI state, and
 * exposes a promise-based API.
 *
 * @module features/assistant/hooks/useWebLLM
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import i18n from '@/lib/i18n';
import posthog from '@/lib/posthog';
import { formatBytes } from '@/lib/utils/format-bytes';
import type { AssistantModelPreset } from '../models';
import type {
  HubProgressEvent,
  LLMWorkerRequest,
  LLMWorkerResponse,
} from '../workers/llm-worker-protocol';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Possible states for the engine lifecycle.
 */
export type EngineStatus = 'idle' | 'loading' | 'ready' | 'generating' | 'error';

/**
 * One model shard / file on Hugging Face Hub (e.g. `.onnx`, `.onnx_data`).
 */
export interface FileDownloadProgress {
  readonly fileKey: string;
  readonly fileName: string;
  /** 0–1; completed files stay at 1. */
  readonly progress: number;
  readonly bytesHint?: string;
  readonly done: boolean;
}

/**
 * Progress information during model download/loading.
 */
export interface LoadProgress {
  /** Summary line (initializing, or overall status while files download). */
  readonly text: string;
  /**
   * Progress 0–1 — meaningful for the **initial** single-bar state; when `files`
   * is non-empty, the UI uses per-file bars instead.
   */
  readonly progress: number;
  readonly bytesHint?: string;
  /** One entry per file seen in the Hub download callback (order preserved). */
  readonly files: readonly FileDownloadProgress[];
}

/**
 * A single chat message.
 */
export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

/**
 * Error raised when the inference session itself died. The engine unloads
 * itself and reloads from cache; the prompt that hit it was never answered.
 */
export interface FatalEngineError extends Error {
  readonly fatal: true;
}

/**
 * Whether a rejected `generate()` took the whole engine down with it, rather
 * than just failing that one answer.
 */
export function isFatalEngineError(error: unknown): error is FatalEngineError {
  return (
    error instanceof Error &&
    (error as { readonly fatal?: unknown }).fatal === true
  );
}

/**
 * Why a model failed to load, as far as the error message can be trusted to
 * say. Four different fixes: ship a device gate, shrink the prompt or the
 * preset, retry the download, or go and read the message.
 */
export type ModelLoadFailureReason =
  | 'webgpu-unavailable'
  | 'out-of-memory'
  | 'network'
  | 'unknown';

/**
 * Buckets a load failure by its message.
 *
 * Order matters. An allocation failure raised by the WebGPU backend names both
 * WebGPU and the memory, and the memory is the half somebody can act on — so
 * it is tested first, or every OOM would be filed as a missing device.
 */
export function classifyModelLoadFailure(
  message: string,
): ModelLoadFailureReason {
  if (/out of memory|failed to allocate|buffer mapping/i.test(message)) {
    return 'out-of-memory';
  }
  if (/no available backend|gpu adapter|webgpu|no adapter/i.test(message)) {
    return 'webgpu-unavailable';
  }
  if (/failed to fetch|network|load model file|unauthorized|not found/i.test(message)) {
    return 'network';
  }
  return 'unknown';
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

interface FileEntry {
  fileName: string;
  progress: number;
  bytesHint?: string;
  done: boolean;
}

function fileEntriesToProgress(
  map: Map<string, FileEntry>,
): readonly FileDownloadProgress[] {
  return Array.from(map.entries()).map(([fileKey, v]) => ({
    fileKey,
    fileName: v.fileName,
    progress: v.done ? 1 : v.progress,
    bytesHint: v.done ? undefined : v.bytesHint,
    done: v.done,
  }));
}

function buildLoadProgressFromMap(
  map: Map<string, FileEntry>,
  loadingFromCache: boolean,
): LoadProgress {
  const files = fileEntriesToProgress(map);

  if (files.length === 0) {
    return {
      text: i18n.t('assistant.initializingLoader', {
        defaultValue: 'Initializing…',
      }),
      progress: 0,
      bytesHint: undefined,
      files: [],
    };
  }

  const overall =
    files.reduce((sum, f) => sum + (f.done ? 1 : f.progress), 0) /
    files.length;

  return {
    text: i18n.t(
      loadingFromCache
        ? 'assistant.loadingCachedModelFiles'
        : 'assistant.downloadingModelFiles',
      {
        defaultValue: loadingFromCache
          ? 'Loading cached model files…'
          : 'Downloading model files…',
      },
    ),
    progress: overall,
    bytesHint: undefined,
    files,
  };
}

/**
 * Folds one raw Hub progress event into the per-file map.
 */
function applyHubProgressEvent(
  map: Map<string, FileEntry>,
  event: HubProgressEvent,
): void {
  const fileKey = event.file;
  if (!fileKey) return;

  const fileName = fileKey.split('/').pop() ?? '';

  if (event.status === 'initiate') {
    map.set(fileKey, {
      fileName: fileName || '…',
      progress: 0,
      done: false,
    });
    return;
  }

  if (event.status === 'progress' && event.progress != null) {
    const { loaded, total } = event;
    const bytesHint =
      typeof loaded === 'number' && typeof total === 'number' && total > 0
        ? `${formatBytes(loaded)} / ${formatBytes(total)}`
        : undefined;
    const prev = map.get(fileKey) ?? {
      fileName: fileName || '…',
      progress: 0,
      done: false,
    };
    map.set(fileKey, {
      ...prev,
      fileName: fileName || prev.fileName,
      progress: event.progress / 100,
      bytesHint,
      done: false,
    });
    return;
  }

  if (event.status === 'done') {
    const prev = map.get(fileKey);
    map.set(fileKey, {
      fileName: prev?.fileName ?? (fileName || '…'),
      progress: 1,
      done: true,
      bytesHint: undefined,
    });
  }
}

function getInitialLoaderText(loadingFromCache: boolean): string {
  return i18n.t(
    loadingFromCache
      ? 'assistant.initializingCachedLoader'
      : 'assistant.initializingLoader',
    {
      defaultValue: loadingFromCache
        ? 'Initializing cached model…'
        : 'Initializing…',
    },
  );
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
// Module-level worker client
// ============================================================================

/**
 * One worker per tab, created lazily on first load and reused across React
 * strict-mode double-mounts and model switches.
 */
let workerInstance: Worker | null = null;

/**
 * Hugging Face model ID the worker currently holds a pipeline for.
 */
let loadedModelId: string | null = null;

/**
 * Monotonic request counter; pairs a worker reply with the promise that asked.
 */
let requestCounter = 0;

interface PendingRequest {
  readonly resolve: (value: string) => void;
  readonly reject: (error: Error) => void;
  readonly onProgress?: (event: HubProgressEvent) => void;
  readonly onChunk?: (text: string) => void;
}

const pendingRequests = new Map<string, PendingRequest>();

function nextRequestId(): string {
  requestCounter += 1;
  return `llm-${requestCounter}`;
}

function settleAllPending(error: Error): void {
  const pending = Array.from(pendingRequests.values());
  pendingRequests.clear();
  for (const request of pending) {
    request.reject(error);
  }
}

function handleWorkerMessage(event: MessageEvent<LLMWorkerResponse>): void {
  const response = event.data;
  const pending = pendingRequests.get(response.requestId);
  if (!pending) return;

  switch (response.type) {
    case 'progress':
      pending.onProgress?.(response.event);
      break;
    case 'chunk':
      pending.onChunk?.(response.text);
      break;
    case 'loaded':
    case 'unloaded':
      pendingRequests.delete(response.requestId);
      pending.resolve('');
      break;
    case 'done':
      pendingRequests.delete(response.requestId);
      pending.resolve(response.text);
      break;
    case 'error':
      pendingRequests.delete(response.requestId);
      if (response.fatal) {
        // The worker tore the pipeline down; the client's view of what is
        // loaded has to follow or `loadModel` would no-op.
        loadedModelId = null;
      }
      pending.reject(
        Object.assign(new Error(response.message), { fatal: response.fatal }),
      );
      break;
  }
}

function handleWorkerError(event: ErrorEvent): void {
  loadedModelId = null;
  settleAllPending(
    new Error(event.message || 'The assistant worker stopped unexpectedly.'),
  );
}

function getWorker(): Worker {
  if (workerInstance !== null) return workerInstance;

  if (typeof Worker === 'undefined') {
    throw new Error('Web Workers are not supported in this browser.');
  }

  const worker = new Worker(
    new URL('../workers/llm.worker.ts', import.meta.url),
    { type: 'module' },
  );
  worker.addEventListener('message', handleWorkerMessage);
  worker.addEventListener('error', handleWorkerError);
  workerInstance = worker;
  return worker;
}

/**
 * Every worker request except the fire-and-forget `interrupt`.
 */
type TrackedWorkerRequest = Extract<LLMWorkerRequest, { requestId: string }>;

/**
 * Posts a request and resolves when the worker settles that same request id.
 */
function sendRequest(
  request: TrackedWorkerRequest,
  handlers: Pick<PendingRequest, 'onProgress' | 'onChunk'> = {},
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = getWorker();
    } catch (error) {
      reject(
        error instanceof Error ? error : new Error('Failed to start worker'),
      );
      return;
    }

    pendingRequests.set(request.requestId, { resolve, reject, ...handlers });
    worker.postMessage(request);
  });
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook that manages a local selectable model for on-device inference
 * via Hugging Face Transformers.js, running in a worker.
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
    loadedModelId === preset.modelId ? 'ready' : 'idle',
  );
  const [loadProgress, setLoadProgress] = useState<LoadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCached, setIsCached] = useState<boolean | null>(null);

  // Track whether we're currently loading (to prevent double-loading)
  const loadingRef = useRef(false);
  const activeModelIdRef = useRef(preset.modelId);
  const cacheProbeVersionRef = useRef(0);

  /** Per-file download state for Transformers.js Hub progress (key = full `file` URL/path). */
  const downloadFilesRef = useRef<Map<string, FileEntry>>(new Map());

  const refreshCacheStatus = useCallback((modelId: string): void => {
    activeModelIdRef.current = modelId;
    const probeVersion = cacheProbeVersionRef.current + 1;
    cacheProbeVersionRef.current = probeVersion;

    void isModelCached(modelId).then((cached) => {
      if (cacheProbeVersionRef.current !== probeVersion) {
        return;
      }
      if (activeModelIdRef.current !== modelId) {
        return;
      }

      setIsCached(cached);
    });
  }, []);

  // Track the selected preset and cache availability.
  useEffect(() => {
    activeModelIdRef.current = preset.modelId;

    if (loadedModelId === preset.modelId) {
      cacheProbeVersionRef.current += 1;
      // Already loaded in the worker — no need to check cache.
      setStatus('ready');
      setIsCached(true);
      return;
    }

    setStatus('idle');
    setLoadProgress(null);
    setError(null);
    setIsCached(null);

    refreshCacheStatus(preset.modelId);
  }, [preset.modelId, refreshCacheStatus]);

  useEffect(
    () => () => {
      cacheProbeVersionRef.current += 1;
    },
    [],
  );

  // ------------------------------------------------------------------
  // loadModel
  // ------------------------------------------------------------------
  const loadModel = useCallback(async (): Promise<void> => {
    if (loadingRef.current) {
      return;
    }

    if (loadedModelId === preset.modelId) {
      return;
    }

    const loadingFromCache = isCached === true;
    loadingRef.current = true;
    downloadFilesRef.current = new Map();
    setStatus('loading');
    setError(null);
    setLoadProgress({
      text: getInitialLoaderText(loadingFromCache),
      progress: 0,
      files: [],
    });

    try {
      await sendRequest(
        {
          type: 'load',
          requestId: nextRequestId(),
          config: {
            modelId: preset.modelId,
            dtype: preset.dtype,
            ...(preset.device ? { device: preset.device } : {}),
          },
        },
        {
          onProgress: (event) => {
            applyHubProgressEvent(downloadFilesRef.current, event);
            setLoadProgress(
              buildLoadProgressFromMap(
                downloadFilesRef.current,
                loadingFromCache,
              ),
            );
          },
        },
      );

      loadedModelId = preset.modelId;
      setStatus('ready');
      setLoadProgress(null);
      setIsCached(true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load model';

      // The only place this failure is ever reported. The worker catches it and
      // posts it back as a message, so it is never an unhandled error or
      // rejection — and posthog-js's `capture_exceptions` autocapture hooks
      // exactly those, on `window`, on the main thread. Nothing about a caught
      // error in a worker reaches it on its own, which is why a device that
      // cannot run the assistant at all used to look, in PostHog, like somebody
      // who opened the page and lost interest.
      posthog?.capture('assistant_model_load_failed', {
        reason: classifyModelLoadFailure(message),
        model_id: preset.modelId,
        dtype: preset.dtype,
        device: preset.device ?? 'default',
        // Separates a download that broke from a session that would not build
        // on weights already sitting in the browser cache.
        from_cache: loadingFromCache,
        error_message: message,
      });
      // And again as an exception, so it groups into an issue in Error tracking
      // rather than only being countable as an event.
      posthog?.captureException(err, {
        model_id: preset.modelId,
        device: preset.device ?? 'default',
      });

      setError(message);
      setStatus('error');
      setLoadProgress(null);
    } finally {
      loadingRef.current = false;
    }
  }, [isCached, preset.device, preset.dtype, preset.modelId]);

  // ------------------------------------------------------------------
  // generate
  // ------------------------------------------------------------------
  const generate = useCallback(
    async (
      messages: ChatMessage[],
      onChunk?: (chunk: string) => void,
    ): Promise<string> => {
      if (loadedModelId !== preset.modelId) {
        throw new Error('Model not loaded. Call loadModel() first.');
      }

      setStatus('generating');
      setError(null);

      try {
        const response = await sendRequest(
          {
            type: 'generate',
            requestId: nextRequestId(),
            modelId: preset.modelId,
            messages,
          },
          { onChunk: (text) => onChunk?.(text) },
        );

        setStatus('ready');
        return response;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Generation failed';
        setError(message);
        // On a fatal failure the pipeline is gone: going back to `idle` (with
        // the files still cached) is what makes the page reload it on its own.
        setStatus(isFatalEngineError(err) ? 'idle' : 'ready');
        throw err;
      }
    },
    [preset.modelId],
  );

  // ------------------------------------------------------------------
  // interrupt
  // ------------------------------------------------------------------
  const interrupt = useCallback((): void => {
    if (workerInstance === null) return;
    workerInstance.postMessage({ type: 'interrupt' } satisfies LLMWorkerRequest);
  }, []);

  // ------------------------------------------------------------------
  // unload
  // ------------------------------------------------------------------
  const unload = useCallback(async (): Promise<void> => {
    if (workerInstance !== null) {
      try {
        await sendRequest({ type: 'unload', requestId: nextRequestId() });
      } catch (unloadError) {
        console.error('Failed to unload assistant model:', unloadError);
      }
    }

    loadedModelId = null;
    activeModelIdRef.current = preset.modelId;
    setStatus('idle');
    setLoadProgress(null);
    setError(null);
    setIsCached(null);
    refreshCacheStatus(preset.modelId);
  }, [preset.modelId, refreshCacheStatus]);

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
