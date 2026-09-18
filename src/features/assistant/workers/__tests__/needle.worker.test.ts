/**
 * @fileoverview Tests for the Needle inference worker.
 *
 * The worker's job is not generation — that is one synchronous WASM call — but
 * everything around it: caching the weights, narrowing the catalogue, refusing
 * a call the model is not confident in, and turning a tool call into the block
 * the executor already understands. All of that is testable in jsdom with the
 * runtime replaced, which is what this file does.
 *
 * Same two substitutions as the Transformers.js worker test: the runtime is a
 * fake, and `postMessage` is stubbed because jsdom's demands a second argument.
 *
 * @module features/assistant/workers/__tests__/needle.worker.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================================
// Test doubles
// ============================================================================

interface FakeEngine {
  contrastive_dim: ReturnType<typeof vi.fn>;
  retrieve_tools: ReturnType<typeof vi.fn>;
  generate: ReturnType<typeof vi.fn>;
  run_json: ReturnType<typeof vi.fn>;
  confidence_for: ReturnType<typeof vi.fn>;
  free: ReturnType<typeof vi.fn>;
}

/** What `NeedleV2Wasm.load` hands back, set per test. */
let fakeEngine: FakeEngine | undefined;
/** Bytes the fake `load` was called with. */
let loadedBytes: Uint8Array | null = null;

function makeEngine(overrides: Partial<FakeEngine> = {}): FakeEngine {
  return {
    contrastive_dim: vi.fn(() => 128),
    retrieve_tools: vi.fn(() => '[[0,0.9]]'),
    generate: vi.fn(
      () => 'room it is <tool_call>[{"name":"addRoom","arguments":{"name":"Attic"}}]</tool_call>',
    ),
    run_json: vi.fn(() => '[{"name":"addRoom","arguments":{"name":"Attic"}}]'),
    confidence_for: vi.fn(() => 0.9),
    free: vi.fn(),
    ...overrides,
  };
}

vi.mock('needle-rs', () => ({
  default: vi.fn(async () => undefined),
  NeedleV2Wasm: {
    load: vi.fn((bytes: Uint8Array) => {
      loadedBytes = bytes;
      return fakeEngine;
    }),
  },
}));

// ============================================================================
// Helpers
// ============================================================================

type MessageHandler = (event: { data: unknown }) => void;

const posted: Record<string, unknown>[] = [];

const LOAD = {
  type: 'load',
  requestId: 'r-load',
  config: {
    engine: 'needle' as const,
    modelId: 'Cactus-Compute/needle2',
    weightsUrl: 'https://example.test/needle2.cact',
    cacheName: 'needle-cache',
  },
};

const GENERATE = {
  type: 'generate',
  requestId: 'r-generate',
  modelId: 'Cactus-Compute/needle2',
  messages: [
    { role: 'system' as const, content: 'You are helping with a trip.' },
    { role: 'user' as const, content: 'add an attic room' },
  ],
};

/** Imports a fresh worker — its engine lives in module state. */
async function loadWorker(): Promise<MessageHandler> {
  const addEventListener = vi.spyOn(globalThis, 'addEventListener');

  vi.resetModules();
  await import('../needle.worker');

  const registration = addEventListener.mock.calls
    .filter(([type]) => type === 'message')
    .at(-1);

  expect(registration, 'the worker registered no message listener').toBeDefined();
  addEventListener.mockRestore();

  return registration![1] as unknown as MessageHandler;
}

/**
 * Sends one request and lets the handler settle.
 *
 * Timer turns rather than microtask turns: loading streams the response body,
 * and each `reader.read()` resolves on its own tick.
 */
async function send(handler: MessageHandler, data: unknown): Promise<void> {
  handler({ data });
  for (let turn = 0; turn < 12; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function lastOfType(type: string): Record<string, unknown> | undefined {
  return [...posted].reverse().find((message) => message.type === type);
}

/** Every progress event the worker posted, oldest first. */
function progressEvents(): Record<string, unknown>[] {
  return posted
    .filter((message) => message.type === 'progress')
    .map((message) => message.event as Record<string, unknown>);
}

/** A Cache Storage double whose `match` answer is set per test. */
function mockCaches(cached: Response | undefined): {
  put: ReturnType<typeof vi.fn>;
} {
  const put = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('caches', {
    open: vi.fn().mockResolvedValue({
      match: vi.fn().mockResolvedValue(cached),
      put,
    }),
  });
  return { put };
}

/** A weights response the worker can stream. */
function weightsResponse(bytes: Uint8Array): Response {
  return new Response(bytes.buffer as ArrayBuffer, {
    status: 200,
    headers: { 'content-length': String(bytes.byteLength) },
  });
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  posted.length = 0;
  loadedBytes = null;
  fakeEngine = makeEngine();
  vi.stubGlobal(
    'postMessage',
    vi.fn((message: Record<string, unknown>) => {
      posted.push(message);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('needle worker — loading a model', () => {
  it('downloads the weights, caches them and says it is loaded', async () => {
    const { put } = mockCaches(undefined);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(weightsResponse(bytes)));

    const handler = await loadWorker();
    await send(handler, LOAD);

    expect(lastOfType('loaded')).toBeDefined();
    expect(loadedBytes).toEqual(bytes);
    expect(put).toHaveBeenCalled();
  });

  it('serves the weights from the cache without touching the network', async () => {
    const bytes = new Uint8Array([9, 9, 9]);
    mockCaches(weightsResponse(bytes));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const handler = await loadWorker();
    await send(handler, LOAD);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(loadedBytes).toEqual(bytes);
    expect(lastOfType('loaded')).toBeDefined();
  });

  it('reports the download as a single file the progress UI can render', async () => {
    mockCaches(undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(weightsResponse(new Uint8Array([1, 2, 3]))),
    );

    const handler = await loadWorker();
    await send(handler, LOAD);

    const events = progressEvents();
    expect(events[0]).toMatchObject({
      status: 'initiate',
      file: LOAD.config.weightsUrl,
    });
    expect(events.at(-1)).toMatchObject({ status: 'done' });
  });

  it('calls an unreadable image a fatal failure rather than loading nothing', async () => {
    // `load` answers with null instead of throwing, so an image this runtime
    // cannot read — a newer Needle, say — would otherwise pass silently.
    fakeEngine = undefined;
    mockCaches(undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(weightsResponse(new Uint8Array([1]))),
    );

    const handler = await loadWorker();
    await send(handler, LOAD);

    expect(lastOfType('loaded')).toBeUndefined();
    expect(lastOfType('error')).toMatchObject({ fatal: true });
  });

  it('reports a failed download as fatal', async () => {
    mockCaches(undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('nope', { status: 404 })),
    );

    const handler = await loadWorker();
    await send(handler, LOAD);

    expect(lastOfType('error')).toMatchObject({ fatal: true });
  });

  it('refuses a configuration meant for the other engine', async () => {
    const handler = await loadWorker();
    await send(handler, {
      ...LOAD,
      config: { engine: 'transformers', modelId: 'onnx/x', dtype: 'q4' },
    });

    expect(lastOfType('error')).toMatchObject({ fatal: true });
  });
});

describe('needle worker — generating', () => {
  async function loadedWorker(): Promise<MessageHandler> {
    mockCaches(undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(weightsResponse(new Uint8Array([1, 2, 3]))),
    );
    const handler = await loadWorker();
    await send(handler, LOAD);
    posted.length = 0;
    return handler;
  }

  it('answers with the action block the executor parses', async () => {
    const handler = await loadedWorker();
    await send(handler, GENERATE);

    const done = lastOfType('done');
    expect(done?.interrupted).toBe(false);
    expect(done?.text).toContain(
      '```action\n{"action":"addRoom","data":{"name":"Attic"}}\n```',
    );
  });

  it('shows what the model said around the call as reasoning', async () => {
    const handler = await loadedWorker();
    await send(handler, GENERATE);

    const text = String(lastOfType('done')?.text);
    expect(text).toMatch(/^<reasoning>room it is · Confidence: 90%<\/reasoning>/);
  });

  it('routes on the last thing the user said, not the system prompt', async () => {
    const handler = await loadedWorker();
    await send(handler, GENERATE);

    expect(fakeEngine?.generate).toHaveBeenCalledWith(
      'add an attic room',
      expect.any(String),
      expect.any(Number),
      0,
      0,
      true,
    );
  });

  it('narrows the catalogue to what retrieval ranked', async () => {
    const handler = await loadedWorker();
    await send(handler, GENERATE);

    const toolsJson = String(fakeEngine?.generate.mock.calls[0]?.[1]);
    expect(JSON.parse(toolsJson)).toHaveLength(1);
  });

  it('offers the whole catalogue when retrieval is unavailable', async () => {
    fakeEngine = makeEngine({ contrastive_dim: vi.fn(() => 0) });
    const handler = await loadedWorker();
    await send(handler, GENERATE);

    const toolsJson = String(fakeEngine.generate.mock.calls[0]?.[1]);
    expect(JSON.parse(toolsJson).length).toBeGreaterThan(1);
    expect(fakeEngine.retrieve_tools).not.toHaveBeenCalled();
  });

  it('offers the whole catalogue when retrieval matched nothing', async () => {
    fakeEngine = makeEngine({ retrieve_tools: vi.fn(() => '[[0,0.001]]') });
    const handler = await loadedWorker();
    await send(handler, GENERATE);

    const toolsJson = String(fakeEngine.generate.mock.calls[0]?.[1]);
    expect(JSON.parse(toolsJson).length).toBeGreaterThan(1);
  });

  it('withholds a call the model is not confident in', async () => {
    // Writing to somebody's trip on a coin flip is worse than doing nothing,
    // so a low score reports the call and emits no action.
    fakeEngine = makeEngine({ confidence_for: vi.fn(() => 0.2) });
    const handler = await loadedWorker();
    await send(handler, GENERATE);

    const text = String(lastOfType('done')?.text);
    expect(text).not.toContain('```action');
    expect(text).toContain('Too unsure to apply addRoom');
  });

  it('says nothing at all when the model abstained', async () => {
    fakeEngine = makeEngine({
      generate: vi.fn(() => ''),
      run_json: vi.fn(() => '[]'),
      confidence_for: vi.fn(() => undefined),
    });
    const handler = await loadedWorker();
    await send(handler, GENERATE);

    expect(lastOfType('done')).toMatchObject({ text: '', interrupted: false });
  });

  it('refuses to generate before a model is loaded', async () => {
    const handler = await loadWorker();
    await send(handler, GENERATE);

    expect(lastOfType('error')).toMatchObject({ fatal: true });
  });

  it('keeps the engine after a failed run', async () => {
    // The handle has no session to invalidate: one bad run says nothing about
    // the next, so the client must not be told to reload 13.7 MB.
    fakeEngine = makeEngine({
      generate: vi.fn(() => {
        throw new Error('decode failed');
      }),
    });
    const handler = await loadedWorker();
    await send(handler, GENERATE);

    expect(lastOfType('error')).toMatchObject({
      fatal: false,
      message: 'decode failed',
    });
  });
});

describe('needle worker — ranking for another engine', () => {
  async function loadedWorker(): Promise<MessageHandler> {
    mockCaches(undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(weightsResponse(new Uint8Array([1, 2, 3]))),
    );
    const handler = await loadWorker();
    await send(handler, LOAD);
    posted.length = 0;
    return handler;
  }

  const RETRIEVE = {
    type: 'retrieve',
    requestId: 'r-retrieve',
    modelId: 'Cactus-Compute/needle2',
    query: 'add an attic room',
    topK: 12,
  };

  it('answers with the action names it ranked', async () => {
    const handler = await loadedWorker();
    await send(handler, RETRIEVE);

    const text = String(lastOfType('done')?.text);
    expect(JSON.parse(text)).toEqual(['createTrip']);
  });

  it('asks for as many as the caller wanted', async () => {
    const handler = await loadedWorker();
    await send(handler, RETRIEVE);

    expect(fakeEngine?.retrieve_tools).toHaveBeenCalledWith(
      'add an attic room',
      expect.any(String),
      12,
    );
  });

  it('answers empty when there is no retrieval head to ask', async () => {
    // Empty means "could not narrow", which the caller reads as "offer
    // everything" — never as "offer nothing".
    fakeEngine = makeEngine({ contrastive_dim: vi.fn(() => 0) });
    const handler = await loadedWorker();
    await send(handler, RETRIEVE);

    expect(JSON.parse(String(lastOfType('done')?.text))).toEqual([]);
  });

  it('refuses to rank before a model is loaded', async () => {
    const handler = await loadWorker();
    await send(handler, RETRIEVE);

    expect(lastOfType('error')).toMatchObject({ fatal: true });
  });
});

describe('needle worker — unloading', () => {
  it('frees the engine and says so', async () => {
    mockCaches(undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(weightsResponse(new Uint8Array([1]))),
    );
    const engine = fakeEngine!;
    const handler = await loadWorker();
    await send(handler, LOAD);
    await send(handler, { type: 'unload', requestId: 'r-unload' });

    expect(engine.free).toHaveBeenCalled();
    expect(lastOfType('unloaded')).toBeDefined();
  });
});
