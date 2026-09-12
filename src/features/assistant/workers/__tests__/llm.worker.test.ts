/**
 * @fileoverview Tests for the assistant's inference worker.
 *
 * The worker is the only module in the app that talks to transformers.js, and
 * it had no tests at all — which matters because its whole job is error
 * classification: deciding whether a failed run killed the session (so the next
 * load must rebuild it) or was merely a bad turn (so the loaded model is kept).
 * That decision is made by matching the error message, never by asking a
 * device, so it is exactly as testable in jsdom as in a browser.
 *
 * Two substitutions make that work. transformers.js is replaced by a fake
 * `pipeline`, so onnxruntime is never loaded. `postMessage` is stubbed, because
 * jsdom's `window.postMessage` demands a second argument and would throw on
 * every reply the worker sends.
 *
 * The module registers its listener at import time and keeps state at module
 * scope, so each test re-imports it and drives the captured handler directly
 * rather than dispatching an event — a dispatched event would also reach the
 * listeners left behind by previous imports.
 *
 * @module features/assistant/workers/__tests__/llm.worker.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Test doubles
// ============================================================================

/** The pipeline the fake `pipeline()` resolves to, set per test. */
let fakePipeline: unknown = null;
/** What `pipeline()` should do when called. */
let pipelineBehaviour: () => Promise<unknown> = async () => fakePipeline;
/** The progress callback the worker handed to `pipeline()`. */
let progressCallback: ((event: unknown) => void) | undefined;
/** Every call `pipeline()` received. */
const pipelineCalls: unknown[][] = [];

vi.mock('@huggingface/transformers', () => ({
  env: {},
  pipeline: vi.fn(async (...args: unknown[]) => {
    pipelineCalls.push(args);
    const options = args[2] as { progress_callback?: (event: unknown) => void } | undefined;
    progressCallback = options?.progress_callback;
    return pipelineBehaviour();
  }),
  TextStreamer: class {
    public readonly options: { callback_function: (text: string) => void };

    constructor(_tokenizer: unknown, options: { callback_function: (text: string) => void }) {
      this.options = options;
    }
  },
}));

// ============================================================================
// Helpers
// ============================================================================

type MessageHandler = (event: { data: unknown }) => void;

const posted: unknown[] = [];

/**
 * Imports a fresh copy of the worker and returns the handler it registered.
 *
 * The module keeps its pipeline in module state, so a fresh import per test is
 * what keeps one test's loaded model out of the next one's.
 */
async function loadWorker(): Promise<MessageHandler> {
  const addEventListener = vi.spyOn(globalThis, 'addEventListener');

  vi.resetModules();
  await import('../llm.worker');

  const registration = addEventListener.mock.calls
    .filter(([type]) => type === 'message')
    .at(-1);

  expect(registration, 'the worker registered no message listener').toBeDefined();
  addEventListener.mockRestore();

  return registration![1] as unknown as MessageHandler;
}

/** Sends one request and lets the handler's promises settle. */
async function send(handler: MessageHandler, data: unknown): Promise<void> {
  handler({ data });
  // Two turns: the handlers await the fake pipeline, then post.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** A loaded pipeline: callable, with a tokenizer so the streamer is built. */
function makeLoadedPipeline(
  run: (messages: unknown, options: PipelineRunOptions) => Promise<unknown>,
  { withTokenizer = true }: { withTokenizer?: boolean } = {},
): unknown {
  const instance = vi.fn(run) as unknown as {
    tokenizer?: unknown;
    dispose: ReturnType<typeof vi.fn>;
  };
  if (withTokenizer) {
    instance.tokenizer = {};
  }
  instance.dispose = vi.fn().mockResolvedValue(undefined);
  return instance;
}

interface PipelineRunOptions {
  readonly streamer?: { options: { callback_function: (text: string) => void } };
  readonly callback_function: () => void;
}

const LOAD = {
  type: 'load',
  requestId: 'r-load',
  config: { modelId: 'model-a', dtype: 'q4', device: 'webgpu' },
};

function lastOfType(type: string): Record<string, unknown> | undefined {
  return [...posted]
    .reverse()
    .find((message) => (message as { type?: string }).type === type) as
    | Record<string, unknown>
    | undefined;
}

beforeEach(() => {
  posted.length = 0;
  pipelineCalls.length = 0;
  progressCallback = undefined;
  fakePipeline = null;
  pipelineBehaviour = async () => fakePipeline;
  vi.stubGlobal('postMessage', (message: unknown) => {
    posted.push(message);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('llm worker — loading a model', () => {
  it('builds the pipeline and says it is loaded', async () => {
    fakePipeline = makeLoadedPipeline(async () => []);
    const handler = await loadWorker();

    await send(handler, LOAD);

    expect(pipelineCalls).toHaveLength(1);
    expect(pipelineCalls[0]?.[1]).toBe('model-a');
    expect(pipelineCalls[0]?.[2]).toMatchObject({ dtype: 'q4', device: 'webgpu' });
    expect(lastOfType('loaded')).toMatchObject({ requestId: 'r-load' });
  });

  it('forwards the hub download progress as it arrives', async () => {
    fakePipeline = makeLoadedPipeline(async () => []);
    const handler = await loadWorker();
    await send(handler, LOAD);

    progressCallback?.({ status: 'progress', file: 'model.onnx', loaded: 5, total: 10 });

    expect(lastOfType('progress')).toMatchObject({
      requestId: 'r-load',
      event: { file: 'model.onnx' },
    });
  });

  it('does not rebuild a model that is already loaded', async () => {
    fakePipeline = makeLoadedPipeline(async () => []);
    const handler = await loadWorker();

    await send(handler, LOAD);
    await send(handler, { ...LOAD, requestId: 'r-load-2' });

    expect(pipelineCalls).toHaveLength(1);
    expect(lastOfType('loaded')).toMatchObject({ requestId: 'r-load-2' });
  });

  it('drops the old model before building a different one', async () => {
    const first = makeLoadedPipeline(async () => []) as { dispose: ReturnType<typeof vi.fn> };
    fakePipeline = first;
    const handler = await loadWorker();
    await send(handler, LOAD);

    fakePipeline = makeLoadedPipeline(async () => []);
    await send(handler, {
      type: 'load',
      requestId: 'r-load-b',
      config: { modelId: 'model-b', dtype: 'q4' },
    });

    expect(first.dispose).toHaveBeenCalled();
    expect(pipelineCalls).toHaveLength(2);
    // No device asked for, so none is passed on.
    expect(pipelineCalls[1]?.[2]).not.toHaveProperty('device');
  });

  it('reports a load that failed as fatal', async () => {
    pipelineBehaviour = async () => {
      throw new Error('no such model');
    };
    const handler = await loadWorker();

    await send(handler, LOAD);

    expect(lastOfType('error')).toMatchObject({
      requestId: 'r-load',
      message: 'no such model',
      fatal: true,
    });
  });
});

describe('llm worker — generating', () => {
  const GENERATE = {
    type: 'generate',
    requestId: 'r-gen',
    modelId: 'model-a',
    messages: [{ role: 'user', content: 'Hello' }],
  };

  it('refuses to generate before a model is loaded', async () => {
    const handler = await loadWorker();

    await send(handler, GENERATE);

    expect(lastOfType('error')).toMatchObject({
      message: 'Model not loaded. Call loadModel() first.',
      fatal: true,
    });
  });

  it('refuses to generate for a model other than the loaded one', async () => {
    fakePipeline = makeLoadedPipeline(async () => []);
    const handler = await loadWorker();
    await send(handler, LOAD);

    await send(handler, { ...GENERATE, modelId: 'model-z' });

    expect(lastOfType('error')).toMatchObject({ fatal: true });
  });

  it('streams the answer as it grows, then says it is done', async () => {
    fakePipeline = makeLoadedPipeline(async (_messages, options: PipelineRunOptions) => {
      options.streamer?.options.callback_function('Hel');
      options.streamer?.options.callback_function('lo');
      return [{ generated_text: 'ignored' }];
    });
    const handler = await loadWorker();
    await send(handler, LOAD);

    await send(handler, GENERATE);

    // Each chunk carries the whole answer so far, not the delta.
    const chunks = posted.filter((m) => (m as { type?: string }).type === 'chunk');
    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toMatchObject({ text: 'Hello' });
    expect(lastOfType('done')).toMatchObject({ text: 'Hello', interrupted: false });
  });

  it('reads the answer off the output when no streamer could be built', async () => {
    fakePipeline = makeLoadedPipeline(async () => [{ generated_text: 'Plain answer' }], {
      withTokenizer: false,
    });
    const handler = await loadWorker();
    await send(handler, LOAD);

    await send(handler, GENERATE);

    expect(lastOfType('done')).toMatchObject({ text: 'Plain answer' });
  });

  it('reads the last turn when the output is a conversation', async () => {
    fakePipeline = makeLoadedPipeline(
      async () => [
        {
          generated_text: [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there' },
          ],
        },
      ],
      { withTokenizer: false },
    );
    const handler = await loadWorker();
    await send(handler, LOAD);

    await send(handler, GENERATE);

    expect(lastOfType('done')).toMatchObject({ text: 'Hi there' });
  });

  it('hands back what it had when the run is interrupted', async () => {
    fakePipeline = makeLoadedPipeline(async (_messages, options: PipelineRunOptions) => {
      options.streamer?.options.callback_function('Half ');
      // The interrupt lands between two generation steps, as it does in life.
      handlerRef?.({ data: { type: 'interrupt' } });
      options.callback_function();
      return [];
    });
    const handler = await loadWorker();
    handlerRef = handler;
    await send(handler, LOAD);

    await send(handler, GENERATE);

    expect(lastOfType('done')).toMatchObject({ text: 'Half ', interrupted: true });
  });

  it('keeps the session after an ordinary failure', async () => {
    const instance = makeLoadedPipeline(async () => {
      throw new Error('the prompt was rejected');
    }) as { dispose: ReturnType<typeof vi.fn> };
    fakePipeline = instance;
    const handler = await loadWorker();
    await send(handler, LOAD);

    await send(handler, GENERATE);

    expect(lastOfType('error')).toMatchObject({
      message: 'the prompt was rejected',
      fatal: false,
    });
    expect(instance.dispose).not.toHaveBeenCalled();
  });

  it('throws the session away when the failure killed it', async () => {
    const instance = makeLoadedPipeline(async () => {
      throw new Error('OrtRun failed: buffer is invalid due to a previous error');
    }) as { dispose: ReturnType<typeof vi.fn> };
    fakePipeline = instance;
    const handler = await loadWorker();
    await send(handler, LOAD);

    await send(handler, GENERATE);

    expect(lastOfType('error')).toMatchObject({ fatal: true });
    expect(instance.dispose).toHaveBeenCalled();
  });

  it('reports a thrown non-Error under a plain message', async () => {
    fakePipeline = makeLoadedPipeline(async () => {
      throw 'just a string';
    });
    const handler = await loadWorker();
    await send(handler, LOAD);

    await send(handler, GENERATE);

    expect(lastOfType('error')).toMatchObject({
      message: 'Generation failed',
      fatal: false,
    });
  });
});

describe('llm worker — unloading', () => {
  it('drops the pipeline and says so', async () => {
    const instance = makeLoadedPipeline(async () => []) as {
      dispose: ReturnType<typeof vi.fn>;
    };
    fakePipeline = instance;
    const handler = await loadWorker();
    await send(handler, LOAD);

    await send(handler, { type: 'unload', requestId: 'r-unload' });

    expect(instance.dispose).toHaveBeenCalled();
    expect(lastOfType('unloaded')).toMatchObject({ requestId: 'r-unload' });
  });

  it('still reports the unload when the pipeline throws on teardown', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const instance = makeLoadedPipeline(async () => []) as {
      dispose: ReturnType<typeof vi.fn>;
    };
    instance.dispose = vi.fn().mockRejectedValue(new Error('already dead'));
    fakePipeline = instance;
    const handler = await loadWorker();
    await send(handler, LOAD);

    await send(handler, { type: 'unload', requestId: 'r-unload' });

    // A session that already crashed often throws again on teardown; the
    // references are dropped either way.
    expect(consoleError).toHaveBeenCalled();
    expect(lastOfType('unloaded')).toBeDefined();
    consoleError.mockRestore();
  });

  it('needs a fresh load after an unload', async () => {
    fakePipeline = makeLoadedPipeline(async () => []);
    const handler = await loadWorker();
    await send(handler, LOAD);
    await send(handler, { type: 'unload', requestId: 'r-unload' });

    await send(handler, {
      type: 'generate',
      requestId: 'r-gen',
      modelId: 'model-a',
      messages: [],
    });

    expect(lastOfType('error')).toMatchObject({
      message: 'Model not loaded. Call loadModel() first.',
    });
  });
});

/** Set inside the interrupt test so the fake run can send a second message. */
let handlerRef: MessageHandler | undefined;
