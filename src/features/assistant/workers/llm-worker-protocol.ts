/**
 * @fileoverview Message protocol shared by the assistant LLM worker and its
 * main-thread client. Type-only on purpose: importing this file must never pull
 * the Transformers.js runtime into the main bundle.
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
 * Runtime options needed to instantiate a text-generation pipeline.
 */
export interface WorkerModelConfig {
  readonly modelId: string;
  readonly dtype: 'fp32' | 'q4' | 'q4f16';
  readonly device?: 'webgpu';
}

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
