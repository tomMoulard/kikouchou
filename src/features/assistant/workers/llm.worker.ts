/**
 * @fileoverview Dedicated worker that owns the Transformers.js text-generation
 * pipeline. Model download, session creation and token generation all run here
 * so the main thread stays free to paint, scroll and accept new input while the
 * assistant is answering.
 *
 * @module features/assistant/workers/llm.worker
 */

import { env, pipeline, TextStreamer } from '@huggingface/transformers';

import type {
  HubProgressEvent,
  LLMWorkerRequest,
  LLMWorkerResponse,
  WorkerChatMessage,
  WorkerModelConfig,
} from './llm-worker-protocol';

// ============================================================================
// Constants
// ============================================================================

/**
 * Sentinel thrown from the generation callbacks to unwind out of the token loop
 * when the user asks to stop. Never surfaces to the UI as an error.
 */
const INTERRUPT_SENTINEL = '__interrupted__';

/**
 * Failures that leave the inference session unusable rather than just failing
 * one run. Once WebGPU invalidates a buffer ("is invalid due to a previous
 * error") or the device is lost, every later `OrtRun` against that session
 * fails identically — the only way out is to build a new pipeline.
 */
const FATAL_SESSION_ERROR_PATTERN =
  /ortrun|onnxruntime|webgpu|gpubuffer|mapasync|device.*lost|out of memory|invalid due to a previous error/i;

/**
 * Whether an error killed the session rather than just this generation.
 */
function isFatalSessionError(error: unknown): boolean {
  return (
    error instanceof Error && FATAL_SESSION_ERROR_PATTERN.test(error.message)
  );
}

// Always resolve weights from the Hub / browser cache — there are no local models.
env.allowLocalModels = false;

// ============================================================================
// Worker State
// ============================================================================

/** Loaded text-generation pipeline, or `null` when nothing is loaded. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- transformers.js exports no type for a loaded pipeline: `pipeline()` returns a union of task-specific classes with no shared interface.
let pipelineInstance: any = null;

/** Hugging Face model ID backing {@link pipelineInstance}. */
let loadedModelId: string | null = null;

/** Set by an `interrupt` message; cleared at the start of every generation. */
let shouldStop = false;

// ============================================================================
// Helpers
// ============================================================================

function post(message: LLMWorkerResponse): void {
  self.postMessage(message);
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function disposeLoadedPipeline(): Promise<void> {
  const instance = pipelineInstance;
  pipelineInstance = null;
  loadedModelId = null;

  if (instance !== null) {
    try {
      await instance.dispose?.();
    } catch (error) {
      // A session that already crashed often throws again on teardown; the
      // references are dropped either way, so this must not mask the original.
      console.error('Failed to dispose the assistant pipeline:', error);
    }
  }
}

// ============================================================================
// Handlers
// ============================================================================

async function handleLoad(
  requestId: string,
  config: WorkerModelConfig,
): Promise<void> {
  if (pipelineInstance !== null && loadedModelId === config.modelId) {
    post({ type: 'loaded', requestId });
    return;
  }

  try {
    if (pipelineInstance !== null) {
      await disposeLoadedPipeline();
    }

    pipelineInstance = await pipeline('text-generation', config.modelId, {
      dtype: config.dtype,
      ...(config.device ? { device: config.device } : {}),
      progress_callback: (event: HubProgressEvent) => {
        post({ type: 'progress', requestId, event });
      },
    });
    loadedModelId = config.modelId;

    post({ type: 'loaded', requestId });
  } catch (error) {
    await disposeLoadedPipeline();
    post({
      type: 'error',
      requestId,
      message: toErrorMessage(error, 'Failed to load model'),
      fatal: true,
    });
  }
}

async function handleGenerate(
  requestId: string,
  modelId: string,
  messages: readonly WorkerChatMessage[],
): Promise<void> {
  if (pipelineInstance === null || loadedModelId !== modelId) {
    post({
      type: 'error',
      requestId,
      message: 'Model not loaded. Call loadModel() first.',
      fatal: true,
    });
    return;
  }

  shouldStop = false;
  let fullResponse = '';

  try {
    // Decode token IDs into text as they come; the pipeline exposes the
    // tokenizer the streamer needs.
    const streamer = pipelineInstance.tokenizer
      ? new TextStreamer(pipelineInstance.tokenizer, {
          skip_prompt: true,
          skip_special_tokens: true,
          callback_function: (text: string) => {
            if (shouldStop) return;
            fullResponse += text;
            post({ type: 'chunk', requestId, text: fullResponse });
          },
        })
      : undefined;

    const output = await pipelineInstance(messages, {
      max_new_tokens: 1024,
      temperature: 0.7,
      do_sample: true,
      return_full_text: false,
      ...(streamer ? { streamer } : {}),
      // Called per generation step; throwing aborts the loop early.
      callback_function: () => {
        if (shouldStop) {
          throw new Error(INTERRUPT_SENTINEL);
        }
      },
    });

    // Fallback for builds where the streamer could not be constructed.
    if (!fullResponse && Array.isArray(output) && output.length > 0) {
      const generated = output[0]?.generated_text;
      if (typeof generated === 'string') {
        fullResponse = generated;
      } else if (Array.isArray(generated)) {
        const last = generated[generated.length - 1];
        fullResponse =
          typeof last === 'object' && last?.content ? String(last.content) : '';
      }
    }

    post({ type: 'done', requestId, text: fullResponse, interrupted: false });
  } catch (error) {
    if (error instanceof Error && error.message === INTERRUPT_SENTINEL) {
      post({ type: 'done', requestId, text: fullResponse, interrupted: true });
      return;
    }
    const fatal = isFatalSessionError(error);
    // Drop the dead session now so the next `load` rebuilds it instead of
    // short-circuiting on a pipeline that can no longer run.
    if (fatal) {
      await disposeLoadedPipeline();
    }
    post({
      type: 'error',
      requestId,
      message: toErrorMessage(error, 'Generation failed'),
      fatal,
    });
  } finally {
    shouldStop = false;
  }
}

async function handleUnload(requestId: string): Promise<void> {
  shouldStop = true;
  try {
    await disposeLoadedPipeline();
    post({ type: 'unloaded', requestId });
  } catch (error) {
    post({
      type: 'error',
      requestId,
      message: toErrorMessage(error, 'Failed to unload model'),
      fatal: true,
    });
  }
}

// ============================================================================
// Message Loop
// ============================================================================

self.addEventListener('message', (event: MessageEvent<LLMWorkerRequest>) => {
  const request = event.data;

  switch (request.type) {
    case 'load':
      void handleLoad(request.requestId, request.config);
      break;
    case 'generate':
      void handleGenerate(request.requestId, request.modelId, request.messages);
      break;
    case 'interrupt':
      shouldStop = true;
      break;
    case 'unload':
      void handleUnload(request.requestId);
      break;
  }
});
