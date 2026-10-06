/**
 * @fileoverview Custom hook for managing a selectable LLM: a local one via
 * @huggingface/transformers (Transformers.js) or Needle, or a cloud one through
 * the user's OpenRouter account.
 *
 * For the local engines the heavy lifting (downloading weights, building the
 * ONNX session and the token loop) runs inside a dedicated worker (see
 * `workers/llm.worker.ts`), so loading or answering never freezes the page.
 * This hook is the main-thread client: it owns the worker, translates progress
 * events into UI state, and exposes a promise-based API.
 *
 * The `openrouter` engine has no worker and nothing to load. "Ready" means a
 * key is stored, and `generate` streams over `fetch` (see `openrouter/client`).
 *
 * @module features/assistant/hooks/useWebLLM
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import i18n from '@/lib/i18n';
import posthog, { captureEvent } from '@/lib/posthog';
import { formatBytes } from '@/lib/utils/format-bytes';
import type { AssistantEngine, AssistantModelPreset } from '../models';
import {
  disconnectOpenRouter,
  getOpenRouterKey,
  isOpenRouterConnected,
  prepareOpenRouterConnect,
  subscribeOpenRouterConnection,
} from '../openrouter/auth';
import { OPENROUTER_CALLBACK_SEGMENT } from '../openrouter/callback';
import { OpenRouterError, streamOpenRouterChat } from '../openrouter/client';
import type {
  HubProgressEvent,
  LLMWorkerRequest,
  LLMWorkerResponse,
  WorkerModelConfig,
} from '../workers/llm-worker-protocol';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Possible states for the engine lifecycle.
 */
export type EngineStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'generating'
  | 'error'
  | 'cancelled';

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
 * Error used to settle the in-flight load when the user cancels it. Not a
 * failure: nothing is reported, and the card goes back to offering the
 * download.
 */
export interface LoadCancelledError extends Error {
  readonly cancelled: true;
}

/**
 * Whether a rejected `loadModel()` was cancelled by the user rather than
 * broken.
 */
export function isLoadCancelledError(
  error: unknown,
): error is LoadCancelledError {
  return (
    error instanceof Error &&
    (error as { readonly cancelled?: unknown }).cancelled === true
  );
}

/**
 * Error used to settle what an old worker still owed when a model on the
 * other engine replaced it. Not a failure either: the worker was taken down on
 * purpose, and the request that replaced it owns the status from then on.
 */
export interface WorkerReplacedError extends Error {
  readonly replaced: true;
}

/**
 * Whether a request was dropped because its worker was replaced.
 */
export function isWorkerReplacedError(
  error: unknown,
): error is WorkerReplacedError {
  return (
    error instanceof Error &&
    (error as { readonly replaced?: unknown }).replaced === true
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
  /** Stop a load in progress and drop the partial download */
  cancelLoad: () => void;
  /** Generate a chat completion from a message history */
  generate: (
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
  ) => Promise<string>;
  /** Interrupt an ongoing generation */
  interrupt: () => void;
  /** Unload the model and free resources */
  unload: () => Promise<void>;
  /**
   * Cloud presets only: sends the user to OpenRouter to sign in. The page
   * navigates away, and the callback lands back on the assistant.
   */
  connect: () => Promise<void>;
  /** Cloud presets only: forgets the OpenRouter key on this device. */
  disconnect: () => void;
}

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
 * Checks whether the model files are already in the browser's Cache Storage.
 *
 * The bucket differs per engine — Transformers.js owns one and the Needle
 * worker writes its own — so the preset names it rather than this function
 * assuming it.
 *
 * @returns `true` if cached files are found, `false` otherwise
 */
async function isModelCached(
  modelId: string,
  cacheName: string,
): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;
    const cache = await caches.open(cacheName);
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
 * Which runtime {@link workerInstance} was built for.
 *
 * The two engines are separate worker modules on purpose: the Needle preset is
 * 13.7 MB of weights behind a 423 KB runtime, and loading it should not also
 * pull in the ONNX runtime it never calls. Switching preset across engines
 * therefore replaces the worker rather than reconfiguring it.
 */
let workerEngine: AssistantEngine | null = null;

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

/**
 * The cloud answer in flight, if any. Module-level like the worker, so the
 * page's stop button reaches it from any render.
 */
let cloudAbortController: AbortController | null = null;

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

/**
 * Kills the worker and settles everything it still owed.
 *
 * Transformers.js gives `pipeline()` no abort signal, so the only way to stop a
 * download that is already in flight is to take the whole worker down. The next
 * request builds a new one.
 */
function terminateWorker(reason: Error): void {
  const worker = workerInstance;
  workerInstance = null;
  workerEngine = null;
  loadedModelId = null;
  settleAllPending(reason);
  worker?.terminate();
}

function handleWorkerError(event: ErrorEvent): void {
  loadedModelId = null;
  settleAllPending(
    new Error(event.message || 'The assistant worker stopped unexpectedly.'),
  );
}

function getWorker(engine: AssistantEngine): Worker {
  if (workerInstance !== null && workerEngine === engine) return workerInstance;

  if (typeof Worker === 'undefined') {
    throw new Error('Web Workers are not supported in this browser.');
  }

  if (workerInstance !== null) {
    // A different engine: the old worker still holds its model in memory and
    // will never be asked for it again.
    terminateWorker(
      Object.assign(
        new Error('Switched to a model with a different runtime.'),
        { replaced: true } as const,
      ) satisfies WorkerReplacedError,
    );
  }

  const worker =
    engine === 'needle'
      ? new Worker(new URL('../workers/needle.worker.ts', import.meta.url), {
          type: 'module',
        })
      : new Worker(new URL('../workers/llm.worker.ts', import.meta.url), {
          type: 'module',
        });
  worker.addEventListener('message', handleWorkerMessage);
  worker.addEventListener('error', handleWorkerError);
  workerInstance = worker;
  workerEngine = engine;
  return worker;
}

/**
 * Narrows a preset into the configuration its worker expects.
 *
 * The preset type keeps the engine-specific fields optional so the UI can read
 * one shape; the protocol does not, so this is where the two meet and where a
 * preset missing the field its engine needs fails loudly rather than loading a
 * model with an undefined weights URL.
 */
function toWorkerModelConfig(preset: AssistantModelPreset): WorkerModelConfig {
  if (preset.engine === 'needle') {
    if (!preset.weightsUrl) {
      throw new Error(`Preset ${preset.id} has no weights URL to load.`);
    }
    return {
      engine: 'needle',
      modelId: preset.modelId,
      weightsUrl: preset.weightsUrl,
      cacheName: preset.cacheName,
    };
  }

  return {
    engine: 'transformers',
    modelId: preset.modelId,
    dtype: preset.dtype ?? 'q4f16',
    ...(preset.device ? { device: preset.device } : {}),
    ...(preset.chatTemplateOptions
      ? { chatTemplateOptions: preset.chatTemplateOptions }
      : {}),
  };
}

/**
 * The words a failed cloud answer is shown with.
 *
 * The raw message is a vendor's, in English; most of the time the user can fix
 * the cause, so the kinds that have a fix say what it is.
 */
function describeOpenRouterError(error: OpenRouterError): string {
  switch (error.kind) {
    case 'unauthorized':
      return i18n.t('assistant.cloud.errors.unauthorized', {
        defaultValue:
          'Your OpenRouter connection is no longer valid. Connect again to keep using this model.',
      });
    case 'insufficient-credits':
      return i18n.t('assistant.cloud.errors.insufficientCredits', {
        defaultValue:
          'Your OpenRouter account has no credits left. Add credits on openrouter.ai, then try again.',
      });
    case 'rate-limited':
      return i18n.t('assistant.cloud.errors.rateLimited', {
        defaultValue: 'Too many requests for now. Wait a moment, then try again.',
      });
    case 'network':
      return i18n.t('assistant.cloud.errors.network', {
        defaultValue: 'Could not reach OpenRouter. Check your connection.',
      });
    case 'provider':
      return error.message;
  }
}

/**
 * Where OpenRouter sends the user back: the assistant page, absolute.
 */
function getOpenRouterCallbackUrl(): string {
  return new URL(
    `${import.meta.env.BASE_URL}${OPENROUTER_CALLBACK_SEGMENT}`,
    window.location.origin,
  ).toString();
}

/**
 * Every worker request except the fire-and-forget `interrupt`.
 */
type TrackedWorkerRequest = Extract<LLMWorkerRequest, { requestId: string }>;

/**
 * Posts a request and resolves when the worker settles that same request id.
 */
function sendRequest(
  engine: AssistantEngine,
  request: TrackedWorkerRequest,
  handlers: Pick<PendingRequest, 'onProgress' | 'onChunk'> = {},
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = getWorker(engine);
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
  const isCloud = preset.engine === 'openrouter';
  const cloudConnected = useSyncExternalStore(
    subscribeOpenRouterConnection,
    isOpenRouterConnected,
    () => false,
  );
  const [status, setStatus] = useState<EngineStatus>(() => {
    if (isCloud) return isOpenRouterConnected() ? 'ready' : 'idle';
    return loadedModelId === preset.modelId ? 'ready' : 'idle';
  });
  const [loadProgress, setLoadProgress] = useState<LoadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCached, setIsCached] = useState<boolean | null>(null);

  // Track whether we're currently loading (to prevent double-loading)
  const loadingRef = useRef(false);
  /** Counts loads, so an unload can tell that one started while it waited. */
  const loadGenerationRef = useRef(0);
  const activeModelIdRef = useRef(preset.modelId);
  const cacheProbeVersionRef = useRef(0);

  /** Per-file download state for Transformers.js Hub progress (key = full `file` URL/path). */
  const downloadFilesRef = useRef<Map<string, FileEntry>>(new Map());

  const refreshCacheStatus = useCallback(
    (modelId: string, cacheName: string): void => {
      activeModelIdRef.current = modelId;
      const probeVersion = cacheProbeVersionRef.current + 1;
      cacheProbeVersionRef.current = probeVersion;

      void isModelCached(modelId, cacheName).then((cached) => {
        if (cacheProbeVersionRef.current !== probeVersion) {
          return;
        }
        if (activeModelIdRef.current !== modelId) {
          return;
        }

        setIsCached(cached);
      });
    },
    [],
  );

  // Track the selected preset and cache availability.
  useEffect(() => {
    activeModelIdRef.current = preset.modelId;

    if (isCloud) {
      // Nothing to probe or load: the stored key is the whole of "ready". An
      // error is kept on disconnect, because a revoked key disconnects the
      // account and the card has to say why the user is back on it.
      cacheProbeVersionRef.current += 1;
      setLoadProgress(null);
      setIsCached(cloudConnected);
      setStatus((prev) =>
        prev === 'generating' && cloudConnected
          ? prev
          : cloudConnected
            ? 'ready'
            : 'idle',
      );
      if (cloudConnected) setError(null);
      return;
    }

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

    refreshCacheStatus(preset.modelId, preset.cacheName);
  }, [cloudConnected, isCloud, preset.cacheName, preset.modelId, refreshCacheStatus]);

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

    if (preset.engine === 'openrouter') {
      // Never a sign-in from here: the auto-load effect calls this, and a
      // redirect the user did not ask for would take them off the page.
      if (isOpenRouterConnected()) setStatus('ready');
      return;
    }

    if (loadedModelId === preset.modelId) {
      return;
    }

    const loadingFromCache = isCached === true;
    loadingRef.current = true;
    loadGenerationRef.current += 1;
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
        preset.engine,
        {
          type: 'load',
          requestId: nextRequestId(),
          config: toWorkerModelConfig(preset),
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
      if (isWorkerReplacedError(err)) {
        // Another load, for a model on the other engine, took the worker down.
        // That load reports its own outcome; this one only steps aside.
        setStatus('idle');
        setLoadProgress(null);
        return;
      }

      if (isLoadCancelledError(err)) {
        // The user asked for this, so it is not an error: no capture, no red
        // card, and a status the auto-load effect will not immediately undo.
        captureEvent('assistant_model_load_cancelled', {
          model_id: preset.modelId,
          from_cache: loadingFromCache,
        });
        setError(null);
        setStatus('cancelled');
        setLoadProgress(null);
        return;
      }

      const message =
        err instanceof Error ? err.message : 'Failed to load model';

      // The only place this failure is ever reported. The worker catches it and
      // posts it back as a message, so it is never an unhandled error or
      // rejection — and posthog-js's `capture_exceptions` autocapture hooks
      // exactly those, on `window`, on the main thread. Nothing about a caught
      // error in a worker reaches it on its own, which is why a device that
      // cannot run the assistant at all used to look, in PostHog, like somebody
      // who opened the page and lost interest.
      captureEvent('assistant_model_load_failed', {
        reason: classifyModelLoadFailure(message),
        model_id: preset.modelId,
        engine: preset.engine,
        dtype: preset.dtype ?? 'none',
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
  }, [isCached, preset]);

  // ------------------------------------------------------------------
  // cancelLoad
  // ------------------------------------------------------------------
  const cancelLoad = useCallback((): void => {
    if (!loadingRef.current) return;

    downloadFilesRef.current = new Map();
    terminateWorker(
      Object.assign(new Error('Model loading was cancelled.'), {
        cancelled: true as const,
      }),
    );
  }, []);

  // ------------------------------------------------------------------
  // generateInCloud
  // ------------------------------------------------------------------
  const generateInCloud = useCallback(async (
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
  ): Promise<string> => {
    const apiKey = getOpenRouterKey();
    if (apiKey === null) {
      throw new Error(
        i18n.t('assistant.cloud.errors.notConnected', {
          defaultValue: 'Connect your OpenRouter account to use this model.',
        }),
      );
    }

    const controller = new AbortController();
    cloudAbortController?.abort();
    cloudAbortController = controller;
    setStatus('generating');
    setError(null);

    try {
      const response = await streamOpenRouterChat({
        apiKey,
        model: preset.modelId,
        messages,
        referer: window.location.origin,
        signal: controller.signal,
        onChunk,
      });
      setStatus('ready');
      return response;
    } catch (err) {
      if (!(err instanceof OpenRouterError)) {
        setStatus('ready');
        throw err;
      }

      const message = describeOpenRouterError(err);
      setError(message);
      if (err.kind === 'unauthorized') {
        // A revoked key will refuse every later turn too. Forgetting it sends
        // the page back to the connect card, which shows the message.
        disconnectOpenRouter();
        setStatus('idle');
      } else {
        setStatus('ready');
      }
      throw new Error(message, { cause: err });
    } finally {
      if (cloudAbortController === controller) {
        cloudAbortController = null;
      }
    }
  }, [preset.modelId]);

  // ------------------------------------------------------------------
  // generate
  // ------------------------------------------------------------------
  const generate = useCallback(
    async (
      messages: ChatMessage[],
      onChunk?: (chunk: string) => void,
    ): Promise<string> => {
      if (preset.engine === 'openrouter') {
        return generateInCloud(messages, onChunk);
      }

      if (loadedModelId !== preset.modelId) {
        throw new Error('Model not loaded. Call loadModel() first.');
      }

      setStatus('generating');
      setError(null);

      try {
        const response = await sendRequest(
          preset.engine,
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
    [generateInCloud, preset.engine, preset.modelId],
  );

  // ------------------------------------------------------------------
  // connect / disconnect
  // ------------------------------------------------------------------
  const connect = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const url = await prepareOpenRouterConnect(getOpenRouterCallbackUrl());
      captureEvent('assistant_provider_connect_started', {
        provider: 'openrouter',
        model_id: preset.modelId,
      });
      window.location.assign(url);
    } catch (err) {
      console.error('Failed to start the OpenRouter sign-in:', err);
      setError(
        i18n.t('assistant.cloud.errors.connectFailed', {
          defaultValue: 'Could not start the OpenRouter sign-in. Try again.',
        }),
      );
    }
  }, [preset.modelId]);

  const disconnect = useCallback((): void => {
    cloudAbortController?.abort();
    disconnectOpenRouter();
    captureEvent('assistant_provider_disconnected', { provider: 'openrouter' });
  }, []);

  // ------------------------------------------------------------------
  // interrupt
  // ------------------------------------------------------------------
  const interrupt = useCallback((): void => {
    // The cloud answer resolves with what already arrived, like a local one.
    cloudAbortController?.abort();
    if (workerInstance === null) return;
    workerInstance.postMessage({ type: 'interrupt' } satisfies LLMWorkerRequest);
  }, []);

  // ------------------------------------------------------------------
  // unload
  // ------------------------------------------------------------------
  const unload = useCallback(async (): Promise<void> => {
    if (preset.engine === 'openrouter') {
      // Nothing is held on the device. Stopping the answer in flight is all
      // there is; the connection stays, so switching between two cloud models
      // does not sign the user out.
      cloudAbortController?.abort();
      return;
    }

    const generation = loadGenerationRef.current;
    if (workerInstance !== null) {
      try {
        await sendRequest(preset.engine, {
          type: 'unload',
          requestId: nextRequestId(),
        });
      } catch (unloadError) {
        // A replaced worker took its model with it, which is what the unload
        // asked for. Logging it sent PostHog an unhandled error for every
        // quick switch between engines (issue 01a0ddd3-88f1).
        if (!isWorkerReplacedError(unloadError)) {
          console.error('Failed to unload assistant model:', unloadError);
        }
      }
    }

    // A load started while the worker was unloading owns the status and the
    // loaded model now. Resetting them here would show "idle" over a download.
    if (loadGenerationRef.current !== generation) {
      return;
    }

    // The page switched preset while the worker was unloading, and the new
    // preset's effect already set the status and the cache flag. Writing this
    // preset's over them would show a connected cloud model as idle, or the
    // old model's cache state under the new one's name.
    if (activeModelIdRef.current !== preset.modelId) {
      loadedModelId = null;
      return;
    }

    loadedModelId = null;
    activeModelIdRef.current = preset.modelId;
    setStatus('idle');
    setLoadProgress(null);
    setError(null);
    setIsCached(null);
    refreshCacheStatus(preset.modelId, preset.cacheName);
  }, [preset.cacheName, preset.engine, preset.modelId, refreshCacheStatus]);

  return {
    status,
    loadProgress,
    error,
    isCached,
    loadModel,
    cancelLoad,
    generate,
    interrupt,
    unload,
    connect,
    disconnect,
  };
}
