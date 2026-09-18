/**
 * @fileoverview Dedicated worker that owns the Needle WASM runtime.
 *
 * Needle is a tool-calling router, not a chat model: it takes one request plus
 * a tool catalogue and returns one JSON call. It cannot write prose, so this
 * worker does not stream an answer — it runs the router, converts the call into
 * the ```action block the rest of the feature already executes, and puts what
 * the model said around that call into a `<reasoning>` block the UI shows.
 *
 * It speaks the same protocol as `llm.worker.ts`, so `useWebLLM` swaps between
 * the two on a preset change without a second client.
 *
 * @module features/assistant/workers/needle.worker
 */

import init, { NeedleV2Wasm } from 'needle-rs';

import {
  buildNeedleToolDescriptionsJson,
  buildNeedleToolsJson,
  extractNeedleReasoning,
  needleToolCallsToActionBlocks,
  parseNeedleToolCalls,
  parseRetrievedActions,
} from '../needle-tools';
import { ACTION_SCHEMAS } from '../action-schema';
import type {
  LLMWorkerRequest,
  LLMWorkerResponse,
  WorkerChatMessage,
  WorkerModelConfig,
} from './llm-worker-protocol';

// ============================================================================
// Constants
// ============================================================================

/**
 * Actions offered to the model for one request.
 *
 * The catalogue is ranked against the request first and cut to this many, which
 * is what `retrieve_tools` exists for: the constrained decoder walks every tool
 * name it was given, so a short, on-topic list is both faster and more accurate
 * than the full set. Ten leaves room for the near-misses a 121M router needs to
 * choose between.
 */
const MAX_TOOLS_PER_REQUEST = 10;

/**
 * Below this retrieval score a tool is treated as unrelated to the request.
 * Zero would keep the whole ranked list, which defeats the narrowing.
 */
const MIN_RETRIEVAL_SCORE = 0.1;

/** Tokens one call may produce. A tool call is short; a runaway one is a bug. */
const MAX_NEW_TOKENS = 128;

/**
 * Confidence below which the call is reported but not emitted as an action.
 *
 * Needle's confidence head scores the judgement it just made, and the model is
 * trained to abstain rather than guess. Acting on a call it doubts would write
 * to the user's trip on a coin flip, so a low-confidence call is shown as
 * reasoning and nothing else.
 */
const MIN_ACTION_CONFIDENCE = 0.5;

// ============================================================================
// Worker State
// ============================================================================

/** Loaded engine, or `null` when nothing is loaded. */
let engine: NeedleV2Wasm | null = null;

/** Model ID backing {@link engine}. */
let loadedModelId: string | null = null;

/** Resolves once the WASM module has been instantiated, so it happens once. */
let wasmReady: Promise<unknown> | null = null;

/** Set by an `interrupt` message; the result of the run in flight is dropped. */
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

function disposeEngine(): void {
  const instance = engine;
  engine = null;
  loadedModelId = null;

  try {
    instance?.free();
  } catch (error) {
    // Freeing a handle twice throws; the reference is dropped either way.
    console.error('Failed to free the Needle engine:', error);
  }
}

/**
 * Fetches the `.cact` image, serving it from Cache Storage when it is already
 * there and putting it there when it is not.
 *
 * The bucket is the app's own rather than the HTTP cache, for the same reason
 * Transformers.js keeps one: the "already downloaded" badge in the model picker
 * has to be able to ask whether the file is present, and only Cache Storage
 * answers that.
 */
async function fetchWeights(
  config: Extract<WorkerModelConfig, { engine: 'needle' }>,
  onProgress: (loaded: number, total: number) => void,
): Promise<Uint8Array> {
  const cache =
    typeof caches === 'undefined' ? null : await caches.open(config.cacheName);

  const cached = await cache?.match(config.weightsUrl);
  if (cached) {
    const buffer = await cached.arrayBuffer();
    onProgress(buffer.byteLength, buffer.byteLength);
    return new Uint8Array(buffer);
  }

  const response = await fetch(config.weightsUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to load model file: ${response.status} ${response.statusText}`,
    );
  }

  // Cache the untouched response before the body is consumed for progress.
  const forCache = response.clone();
  const total = Number(response.headers.get('content-length') ?? 0);
  const reader = response.body?.getReader();

  let bytes: Uint8Array;
  if (reader) {
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress(loaded, total || loaded);
    }
    bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    const buffer = await response.arrayBuffer();
    bytes = new Uint8Array(buffer);
    onProgress(bytes.byteLength, bytes.byteLength);
  }

  try {
    await cache?.put(config.weightsUrl, forCache);
  } catch (error) {
    // A full or blocked cache costs the next load a re-download, nothing more.
    console.error('Failed to cache the Needle weights:', error);
  }

  return bytes;
}

/**
 * The request Needle routes: the last thing the user said.
 *
 * Needle v2 has no system channel — `run` takes one query and the tools — so
 * the trip context that the prose presets get in their system prompt is not
 * available here. That is the preset's standing limit: it fills arguments from
 * the words in the request, and an action needing an id the user did not say
 * is one it cannot complete.
 */
function toQuery(messages: readonly WorkerChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user') return message.content;
  }
  return '';
}

/**
 * Ranks the action catalogue against the request and keeps the top slice.
 *
 * Retrieval needs the contrastive head, which the published v2 checkpoint
 * carries and v1 does not. Without it — or when the ranking returns nothing
 * usable — the whole catalogue is offered rather than an arbitrary slice of it.
 */
function selectTools(instance: NeedleV2Wasm, query: string): string {
  if (instance.contrastive_dim() <= 0) return buildNeedleToolsJson();

  try {
    const ranked = instance.retrieve_tools(
      query,
      buildNeedleToolDescriptionsJson(),
      MAX_TOOLS_PER_REQUEST,
    );
    const picked = parseRetrievedActions(
      ranked,
      ACTION_SCHEMAS,
      MIN_RETRIEVAL_SCORE,
    );
    return picked.length > 0 ? buildNeedleToolsJson(picked) : buildNeedleToolsJson();
  } catch (error) {
    console.error('Needle tool retrieval failed:', error);
    return buildNeedleToolsJson();
  }
}

/**
 * Assembles the worker's answer: a reasoning block, then the action blocks.
 *
 * The reasoning block is how a model with no chat channel still says something
 * to the user — `reasoning.ts` splits it back out for display, and the caller
 * keeps it out of the history it replays.
 */
function composeAnswer(reasoning: string, actionBlocks: string): string {
  const parts: string[] = [];
  if (reasoning.length > 0) parts.push(`<reasoning>${reasoning}</reasoning>`);
  if (actionBlocks.length > 0) parts.push(actionBlocks);
  return parts.join('\n\n');
}

// ============================================================================
// Handlers
// ============================================================================

async function handleLoad(
  requestId: string,
  config: WorkerModelConfig,
): Promise<void> {
  if (config.engine !== 'needle') {
    post({
      type: 'error',
      requestId,
      message: 'The Needle worker was handed a configuration it cannot run.',
      fatal: true,
    });
    return;
  }

  if (engine !== null && loadedModelId === config.modelId) {
    post({ type: 'loaded', requestId });
    return;
  }

  try {
    disposeEngine();

    // One `.cact` file, so one progress entry — the shape the download UI
    // already renders for the per-file Hub events.
    const fileKey = config.weightsUrl;
    post({ type: 'progress', requestId, event: { status: 'initiate', file: fileKey } });

    wasmReady ??= init();
    await wasmReady;

    const weights = await fetchWeights(config, (loaded, total) => {
      post({
        type: 'progress',
        requestId,
        event: {
          status: 'progress',
          file: fileKey,
          progress: total > 0 ? (loaded / total) * 100 : 0,
          loaded,
          total,
        },
      });
    });

    post({ type: 'progress', requestId, event: { status: 'done', file: fileKey } });

    const instance = NeedleV2Wasm.load(weights);
    if (instance === undefined) {
      // `load` returns null rather than throwing, so an image the runtime does
      // not understand arrives here as a silent failure unless it is checked.
      throw new Error(
        'The Needle runtime could not read this model file. It may be a newer format than this engine supports.',
      );
    }

    engine = instance;
    loadedModelId = config.modelId;
    post({ type: 'loaded', requestId });
  } catch (error) {
    disposeEngine();
    post({
      type: 'error',
      requestId,
      message: toErrorMessage(error, 'Failed to load model'),
      fatal: true,
    });
  }
}

function handleGenerate(
  requestId: string,
  modelId: string,
  messages: readonly WorkerChatMessage[],
): void {
  const instance = engine;
  if (instance === null || loadedModelId !== modelId) {
    post({
      type: 'error',
      requestId,
      message: 'Model not loaded. Call loadModel() first.',
      fatal: true,
    });
    return;
  }

  shouldStop = false;

  try {
    const query = toQuery(messages);
    const toolsJson = selectTools(instance, query);

    // Greedy and schema-constrained: an action that goes to the database should
    // not vary between two identical requests, and the grammar is what keeps
    // every argument in the shape `validateAction` will demand.
    const fullOutput = instance.generate(
      query,
      toolsJson,
      MAX_NEW_TOKENS,
      0,
      0,
      true,
    );

    // The run is synchronous, so an interrupt can only arrive before it starts
    // or after it ends. Either way the result is the user's to discard.
    if (shouldStop) {
      post({ type: 'done', requestId, text: '', interrupted: true });
      return;
    }

    const calls = parseNeedleToolCalls(instance.run_json(query, toolsJson));
    const confidence = instance.confidence_for(query, toolsJson, fullOutput);
    const confident =
      confidence === undefined || confidence >= MIN_ACTION_CONFIDENCE;

    const reasoningParts = [extractNeedleReasoning(fullOutput)];
    if (confidence !== undefined) {
      reasoningParts.push(`Confidence: ${(confidence * 100).toFixed(0)}%`);
    }
    if (!confident && calls.length > 0) {
      reasoningParts.push(
        `Too unsure to apply ${calls.map((call) => call.name).join(', ')}.`,
      );
    }

    post({
      type: 'done',
      requestId,
      text: composeAnswer(
        reasoningParts.filter((part) => part.length > 0).join(' · '),
        confident ? needleToolCallsToActionBlocks(calls) : '',
      ),
      interrupted: false,
    });
  } catch (error) {
    post({
      type: 'error',
      requestId,
      message: toErrorMessage(error, 'Generation failed'),
      // The engine is a plain WASM handle with no session to invalidate: a
      // failed run says nothing about the next one.
      fatal: false,
    });
  } finally {
    shouldStop = false;
  }
}

function handleUnload(requestId: string): void {
  shouldStop = true;
  try {
    disposeEngine();
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
      handleGenerate(request.requestId, request.modelId, request.messages);
      break;
    case 'interrupt':
      shouldStop = true;
      break;
    case 'unload':
      handleUnload(request.requestId);
      break;
  }
});
