/**
 * @fileoverview Narrows the action catalogue to one request, using Needle's
 * retrieval head.
 *
 * The prose presets document every action in their system prompt, and that
 * prompt is the part of the turn the device pays for: prefill memory grows with
 * its length, and on the lightest preset a long prompt is what fails to
 * allocate. Most of it is a catalogue of actions the request could not possibly
 * need — nobody asking to add a room needs the twelve verbs about rides.
 *
 * Needle ranks tool descriptions against a query in one pass of its contrastive
 * head, so this module keeps a Needle engine of its own next to whichever model
 * is answering, asks it which actions the request is about, and hands the short
 * list to `generateActionPrompt`. It costs 13.7 MB of weights beside a preset
 * measured in gigabytes.
 *
 * Every failure here falls back to the full catalogue. A narrowing that cannot
 * run must cost the user a longer prompt, never a missing action.
 *
 * @module features/assistant/action-retrieval
 */

import { ACTION_SCHEMAS, type ActionDef } from './action-schema';
import { getAssistantModelPreset } from './models';
import type {
  LLMWorkerRequest,
  LLMWorkerResponse,
} from './workers/llm-worker-protocol';

// ============================================================================
// Constants
// ============================================================================

/**
 * Actions kept for one request.
 *
 * Wide enough that a request touching two areas — "put Ana in the attic and in
 * my car" — still finds both families, and far short of the full catalogue.
 */
const MAX_ACTIONS_PER_REQUEST = 12;

/**
 * How long the ranking may take before the turn goes ahead without it.
 *
 * The user is waiting on the answer, not on the prompt being short. A ranking
 * that has not come back by now has already cost more than the prompt it would
 * have saved.
 */
const RETRIEVAL_TIMEOUT_MS = 2000;

/** The preset whose weights back the retrieval engine. */
const RETRIEVAL_PRESET = getAssistantModelPreset('needle-v2');

// ============================================================================
// Worker Client
// ============================================================================

let workerInstance: Worker | null = null;
let loadPromise: Promise<void> | null = null;
/** Whether the engine has finished loading and can be asked to rank. */
let isLoaded = false;
let requestCounter = 0;

interface PendingRequest {
  readonly resolve: (value: string) => void;
  readonly reject: (error: Error) => void;
}

const pendingRequests = new Map<string, PendingRequest>();

function nextRequestId(): string {
  requestCounter += 1;
  return `retrieval-${requestCounter}`;
}

function handleWorkerMessage(event: MessageEvent<LLMWorkerResponse>): void {
  const response = event.data;
  const pending = pendingRequests.get(response.requestId);
  if (!pending) return;

  switch (response.type) {
    case 'loaded':
      pendingRequests.delete(response.requestId);
      pending.resolve('');
      break;
    case 'done':
      pendingRequests.delete(response.requestId);
      pending.resolve(response.text);
      break;
    case 'error':
      pendingRequests.delete(response.requestId);
      pending.reject(new Error(response.message));
      break;
    default:
      // Progress events are not interesting here: this download is a background
      // detail of a turn, not something the user asked for.
      break;
  }
}

function handleWorkerError(event: ErrorEvent): void {
  const pending = Array.from(pendingRequests.values());
  pendingRequests.clear();
  const error = new Error(event.message || 'The retrieval worker stopped.');
  for (const request of pending) request.reject(error);
}

function getWorker(): Worker {
  if (workerInstance !== null) return workerInstance;

  if (typeof Worker === 'undefined') {
    throw new Error('Web Workers are not supported in this browser.');
  }

  const worker = new Worker(
    new URL('./workers/needle.worker.ts', import.meta.url),
    { type: 'module' },
  );
  worker.addEventListener('message', handleWorkerMessage);
  worker.addEventListener('error', handleWorkerError);
  workerInstance = worker;
  return worker;
}

function sendRequest(
  request: Extract<LLMWorkerRequest, { requestId: string }>,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = getWorker();
    } catch (error) {
      reject(error instanceof Error ? error : new Error('No worker'));
      return;
    }

    pendingRequests.set(request.requestId, { resolve, reject });
    worker.postMessage(request);
  });
}

/**
 * Loads the retrieval engine once per tab, reusing the attempt in flight.
 *
 * A failed load is not cached: the weights may simply have been unreachable,
 * and the next turn is a fair place to try again.
 */
function ensureLoaded(): Promise<void> {
  loadPromise ??= sendRequest({
    type: 'load',
    requestId: nextRequestId(),
    config: {
      engine: 'needle',
      modelId: RETRIEVAL_PRESET.modelId,
      weightsUrl: RETRIEVAL_PRESET.weightsUrl!,
      cacheName: RETRIEVAL_PRESET.cacheName,
    },
  })
    .then(() => {
      isLoaded = true;
    })
    .catch((error: unknown) => {
      loadPromise = null;
      throw error;
    });

  return loadPromise;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * The actions a request could plausibly need, or all of them.
 *
 * @param query - What the user just asked for
 * @returns The narrowed catalogue, or `ACTION_SCHEMAS` when it could not narrow
 *
 * @example
 * ```ts
 * const actions = await narrowActionsForRequest('add an attic room');
 * const prompt = buildSystemPrompt(actions);
 * ```
 */
export async function narrowActionsForRequest(
  query: string,
): Promise<readonly ActionDef[]> {
  if (query.trim().length === 0) return ACTION_SCHEMAS;

  // The first turn does not wait for the weights. Blocking somebody's first
  // answer on a 13.7 MB download in order to make the prompt shorter spends
  // more than the prompt was costing; the load starts here and the turn after
  // it is the first one to be narrowed.
  if (!isLoaded) {
    void ensureLoaded().catch((error: unknown) => {
      console.error('Action retrieval could not load its engine:', error);
    });
    return ACTION_SCHEMAS;
  }

  try {
    const names = await withTimeout(rankActionNames(query));
    const picked = ACTION_SCHEMAS.filter((def) => names.includes(def.action));

    // An empty or total result is not a narrowing, and a catalogue trimmed to
    // one action is a prompt that cannot answer the next question in the same
    // turn — both fall back to the full list.
    return picked.length > 1 && picked.length < ACTION_SCHEMAS.length
      ? picked
      : ACTION_SCHEMAS;
  } catch (error) {
    console.error('Action retrieval failed; using the full catalogue:', error);
    return ACTION_SCHEMAS;
  }
}

/**
 * Drops the retrieval engine and its weights from memory.
 *
 * Called when the assistant page unmounts: the engine is a convenience for the
 * next turn, not something worth 23 MB of WASM memory in a tab that has moved
 * on.
 */
export async function releaseActionRetrieval(): Promise<void> {
  const worker = workerInstance;
  workerInstance = null;
  loadPromise = null;
  isLoaded = false;
  pendingRequests.clear();
  worker?.terminate();
}

// ============================================================================
// Helpers
// ============================================================================

async function rankActionNames(query: string): Promise<readonly string[]> {
  await ensureLoaded();

  const payload = await sendRequest({
    type: 'retrieve',
    requestId: nextRequestId(),
    modelId: RETRIEVAL_PRESET.modelId,
    query,
    topK: MAX_ACTIONS_PER_REQUEST,
  });

  const parsed: unknown = JSON.parse(payload);
  return Array.isArray(parsed)
    ? parsed.filter((name): name is string => typeof name === 'string')
    : [];
}

/**
 * Rejects rather than letting the turn wait on a ranking that has stalled.
 */
function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(
        () => reject(new Error('Action retrieval timed out.')),
        RETRIEVAL_TIMEOUT_MS,
      );
    }),
  ]);
}
