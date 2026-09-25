/**
 * @fileoverview Message protocol shared by the assistant inference workers and
 * their main-thread client. Type-only on purpose: importing this file must
 * never pull the Transformers.js or the Needle runtime into the main bundle.
 *
 * Both workers speak this protocol, so `useWebLLM` swaps one for the other on a
 * preset change without a second client. What differs is inside `generate`:
 * a Transformers.js worker streams prose, and the Needle worker returns
 * reasoning plus action blocks it assembled itself.
 *
 * @module features/assistant/workers/llm-worker-protocol
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * A single chat turn exchanged with the model.
 */
export interface WorkerChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

/**
 * Raw Hugging Face Hub progress event, forwarded verbatim so the main thread
 * keeps ownership of translation and aggregation.
 */
export interface HubProgressEvent {
  readonly status: string;
  readonly file?: string;
  readonly progress?: number;
  readonly loaded?: number;
  readonly total?: number;
}

/**
 * Runtime options needed to build an inference session.
 *
 * A discriminated union rather than optional fields: the two workers need
 * disjoint configuration, and each one should fail to compile if it reaches for
 * the other's.
 */
export type WorkerModelConfig =
  | {
      readonly engine: 'transformers';
      readonly modelId: string;
      readonly dtype: 'fp32' | 'q4' | 'q4f16';
      readonly device?: 'webgpu';
      /**
       * Extra variables for the repository's Jinja chat template, carried on
       * `load` because that is where the preset is known, and applied on every
       * `generate` because that is where the template runs.
       */
      readonly chatTemplateOptions?: Readonly<Record<string, boolean>>;
    }
  | {
      readonly engine: 'needle';
      readonly modelId: string;
      /** Direct URL of the `.cact` image the worker fetches and caches. */
      readonly weightsUrl: string;
      /** Cache Storage bucket the image is read from and written to. */
      readonly cacheName: string;
    };

/**
 * Messages sent from the main thread to the worker.
 *
 * Every request carries a `requestId`; the worker echoes it on every reply so
 * the client can settle exactly the promise that asked for the work.
 */
export type LLMWorkerRequest =
  | {
      readonly type: 'load';
      readonly requestId: string;
      readonly config: WorkerModelConfig;
    }
  | {
      readonly type: 'generate';
      readonly requestId: string;
      readonly modelId: string;
      readonly messages: readonly WorkerChatMessage[];
    }
  /** Fire-and-forget: aborts the generation currently in flight, if any. */
  | { readonly type: 'interrupt' }
  | { readonly type: 'unload'; readonly requestId: string };

/**
 * Messages sent from the worker back to the main thread.
 */
export type LLMWorkerResponse =
  | {
      readonly type: 'progress';
      readonly requestId: string;
      readonly event: HubProgressEvent;
    }
  | { readonly type: 'loaded'; readonly requestId: string }
  | {
      readonly type: 'chunk';
      readonly requestId: string;
      /** Full response so far, not the incremental delta. */
      readonly text: string;
    }
  | {
      readonly type: 'done';
      readonly requestId: string;
      readonly text: string;
      readonly interrupted: boolean;
    }
  | { readonly type: 'unloaded'; readonly requestId: string }
  | {
      readonly type: 'error';
      readonly requestId: string;
      readonly message: string;
      /**
       * The ONNX/WebGPU session died and was torn down: every later run against
       * it would fail the same way, so the client must load the model again
       * before generating anything else.
       */
      readonly fatal: boolean;
    };
