/**
 * @fileoverview The worker protocol side of useWebLLM.
 *
 * The sibling file covers the cache probe and the load failure that had a
 * regression. This one walks the rest of the conversation with the worker: the
 * download progress it folds into one figure, the chunks it forwards while a
 * turn streams, and what it does with each way a request can end.
 *
 * Nothing here needs WebGPU. The worker is replaced by a fake that answers
 * postMessage with whatever the test decides, which is the whole protocol.
 *
 * @module features/assistant/hooks/__tests__/useWebLLM.protocol.test
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ASSISTANT_MODEL_PRESETS } from '@/features/assistant/models';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@/lib/i18n', () => ({
  default: {
    t: (key: string, options?: { readonly defaultValue?: string }) =>
      options?.defaultValue ?? key,
  },
}));

vi.mock('@/lib/posthog', () => ({
  reportError: vi.fn(),
  captureEvent: vi.fn(),
  default: { capture: vi.fn(), captureException: vi.fn() },
}));

// ============================================================================
// Test doubles
// ============================================================================

class FakeWorker {
  static instances: FakeWorker[] = [];

  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(handler);
    this.listeners.set(type, existing);
  }

  removeEventListener(): void {}

  /** Delivers a message as the real worker would. */
  reply(data: unknown): void {
    for (const handler of this.listeners.get('message') ?? []) {
      handler({ data });
    }
  }

  /** Fires the worker's own `error` event, as a failed module import does. */
  emitError(message: string): void {
    for (const handler of this.listeners.get('error') ?? []) {
      handler({ message });
    }
  }

  requestIdAt(index: number): string {
    const call = this.postMessage.mock.calls[index]?.[0] as
      | { readonly requestId?: string }
      | undefined;
    return call?.requestId ?? '';
  }

  /** The request of the given type this worker was sent most recently. */
  lastRequestOfType(type: string): { requestId: string } | undefined {
    return [...this.postMessage.mock.calls]
      .reverse()
      .map(([message]) => message as { type?: string; requestId: string })
      .find((message) => message.type === type);
  }
}

function installFakeWorker(): void {
  FakeWorker.instances = [];
  Object.defineProperty(globalThis, 'Worker', {
    value: FakeWorker,
    configurable: true,
    writable: true,
  });
}

function installCaches(cachedFiles: readonly string[] = []): void {
  Object.defineProperty(globalThis, 'caches', {
    value: {
      open: vi.fn().mockResolvedValue({
        keys: vi.fn().mockResolvedValue(cachedFiles.map((url) => ({ url }))),
      }),
      delete: vi.fn().mockResolvedValue(true),
      has: vi.fn().mockResolvedValue(false),
      keys: vi.fn().mockResolvedValue([]),
      match: vi.fn().mockResolvedValue(undefined),
    },
    configurable: true,
  });
}

const preset = ASSISTANT_MODEL_PRESETS[0]!;

/** A hook on a fresh module copy: the worker handle lives in module state. */
async function renderFreshHook() {
  vi.resetModules();
  const { useWebLLM } = await import('../useWebLLM');
  return renderHook(() => useWebLLM(preset));
}

/** Renders the hook and answers its load request, leaving the model ready. */
async function renderLoaded() {
  const view = await renderFreshHook();

  await waitFor(() => {
    expect(view.result.current.isCached).not.toBeNull();
  });

  act(() => {
    void view.result.current.loadModel();
  });

  const worker = FakeWorker.instances.at(-1)!;
  await waitFor(() => {
    expect(worker.postMessage).toHaveBeenCalled();
  });

  await act(async () => {
    worker.reply({ type: 'loaded', requestId: worker.lastRequestOfType('load')!.requestId });
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(view.result.current.status).toBe('ready');
  });

  return { ...view, worker };
}

let originalCaches: typeof globalThis.caches;
let originalWorker: typeof globalThis.Worker;

beforeEach(() => {
  originalCaches = globalThis.caches;
  originalWorker = globalThis.Worker;
  vi.clearAllMocks();
  installFakeWorker();
  installCaches();
});

afterEach(() => {
  Object.defineProperty(globalThis, 'caches', {
    value: originalCaches,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'Worker', {
    value: originalWorker,
    configurable: true,
    writable: true,
  });
  vi.restoreAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('useWebLLM — the download progress', () => {
  it('folds the per-file events into one figure', async () => {
    const { result } = await renderFreshHook();
    await waitFor(() => {
      expect(result.current.isCached).not.toBeNull();
    });

    act(() => {
      void result.current.loadModel();
    });
    const worker = FakeWorker.instances.at(-1)!;
    await waitFor(() => {
      expect(worker.postMessage).toHaveBeenCalled();
    });
    const requestId = worker.lastRequestOfType('load')!.requestId;

    // Nothing announced yet: the card still has to say something.
    await act(async () => {
      worker.reply({ type: 'progress', requestId, event: { status: 'initiate', file: 'a.onnx' } });
      await Promise.resolve();
    });
    expect(result.current.loadProgress?.files.map((file) => file.fileName)).toEqual(['a.onnx']);

    await act(async () => {
      worker.reply({
        type: 'progress',
        requestId,
        event: {
          status: 'progress',
          file: 'a.onnx',
          progress: 50,
          loaded: 5_000_000,
          total: 10_000_000,
        },
      });
      worker.reply({ type: 'progress', requestId, event: { status: 'initiate', file: 'b.bin' } });
      await Promise.resolve();
    });

    const files = result.current.loadProgress?.files ?? [];
    expect(files).toHaveLength(2);
    expect(files[0]?.progress).toBeCloseTo(0.5, 2);
    expect(files[0]?.bytesHint).toBeDefined();
    // Halfway through one of two files.
    expect(result.current.loadProgress?.progress).toBeCloseTo(0.25, 2);

    await act(async () => {
      worker.reply({ type: 'progress', requestId, event: { status: 'done', file: 'a.onnx' } });
      await Promise.resolve();
    });
    expect(result.current.loadProgress?.files[0]?.done).toBe(true);
  });

  it('ignores a progress event that names no file', async () => {
    const { result } = await renderFreshHook();
    await waitFor(() => {
      expect(result.current.isCached).not.toBeNull();
    });

    act(() => {
      void result.current.loadModel();
    });
    const worker = FakeWorker.instances.at(-1)!;
    await waitFor(() => {
      expect(worker.postMessage).toHaveBeenCalled();
    });

    await act(async () => {
      worker.reply({
        type: 'progress',
        requestId: worker.lastRequestOfType('load')!.requestId,
        event: { status: 'progress', progress: 50, loaded: 1, total: 2 },
      });
      await Promise.resolve();
    });

    expect(result.current.loadProgress?.files ?? []).toHaveLength(0);
  });

  it('ignores a reply to a request it does not recognise', async () => {
    const { result, worker } = await renderLoaded();

    await act(async () => {
      worker.reply({ type: 'done', requestId: 'not-a-request', text: 'ghost' });
      await Promise.resolve();
    });

    expect(result.current.status).toBe('ready');
  });
});

describe('useWebLLM — generating', () => {
  it('refuses before a model is loaded', async () => {
    const { result } = await renderFreshHook();
    await waitFor(() => {
      expect(result.current.isCached).not.toBeNull();
    });

    await expect(result.current.generate([{ role: 'user', content: 'Hi' }])).rejects.toThrow(
      'Model not loaded',
    );
  });

  it('forwards each chunk and resolves with the finished answer', async () => {
    const { result, worker } = await renderLoaded();
    const chunks: string[] = [];

    let answer: Promise<string> | undefined;
    act(() => {
      answer = result.current.generate([{ role: 'user', content: 'Hi' }], (chunk) => {
        chunks.push(chunk);
      });
    });

    await waitFor(() => {
      expect(worker.lastRequestOfType('generate')).toBeDefined();
    });
    const requestId = worker.lastRequestOfType('generate')!.requestId;

    await act(async () => {
      worker.reply({ type: 'chunk', requestId, text: 'Hel' });
      worker.reply({ type: 'chunk', requestId, text: 'Hello' });
      worker.reply({ type: 'done', requestId, text: 'Hello', interrupted: false });
      await Promise.resolve();
    });

    await expect(answer).resolves.toBe('Hello');
    expect(chunks).toEqual(['Hel', 'Hello']);
    expect(result.current.status).toBe('ready');
  });

  it('stays ready after an ordinary generation failure', async () => {
    const { result, worker } = await renderLoaded();

    let answer: Promise<string> | undefined;
    act(() => {
      answer = result.current.generate([{ role: 'user', content: 'Hi' }]);
      // Attached now, not at the assertion: the rejection lands inside the
      // `act` below, and an unhandled one there fails the run.
      answer.catch(() => {});
    });
    await waitFor(() => {
      expect(worker.lastRequestOfType('generate')).toBeDefined();
    });

    await act(async () => {
      worker.reply({
        type: 'error',
        requestId: worker.lastRequestOfType('generate')!.requestId,
        message: 'the prompt was rejected',
        fatal: false,
      });
      await Promise.resolve();
    });

    await expect(answer).rejects.toThrow('the prompt was rejected');
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.error).toBe('the prompt was rejected');
  });

  it('goes back to idle when the failure took the engine with it', async () => {
    const { result, worker } = await renderLoaded();

    let answer: Promise<string> | undefined;
    act(() => {
      answer = result.current.generate([{ role: 'user', content: 'Hi' }]);
      // Attached now, not at the assertion: the rejection lands inside the
      // `act` below, and an unhandled one there fails the run.
      answer.catch(() => {});
    });
    await waitFor(() => {
      expect(worker.lastRequestOfType('generate')).toBeDefined();
    });

    await act(async () => {
      worker.reply({
        type: 'error',
        requestId: worker.lastRequestOfType('generate')!.requestId,
        message: 'OrtRun failed: device lost',
        fatal: true,
      });
      await Promise.resolve();
    });

    await expect(answer).rejects.toThrow('OrtRun failed');
    // Idle rather than error: the files are still cached, so the page reloads
    // the model on its own.
    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });
  });

  it('asks the worker to stop, but only once there is one', async () => {
    const { result, worker } = await renderLoaded();

    act(() => {
      result.current.interrupt();
    });

    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'interrupt' });
  });
});

describe('useWebLLM — unloading', () => {
  it('drops the model and goes back to idle', async () => {
    const { result, worker } = await renderLoaded();

    let unloading: Promise<void> | undefined;
    act(() => {
      unloading = result.current.unload();
    });

    await waitFor(() => {
      expect(worker.lastRequestOfType('unload')).toBeDefined();
    });

    await act(async () => {
      worker.reply({
        type: 'unloaded',
        requestId: worker.lastRequestOfType('unload')!.requestId,
      });
      await unloading;
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.loadProgress).toBeNull();
  });

  it('still goes back to idle when the unload itself failed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, worker } = await renderLoaded();

    let unloading: Promise<void> | undefined;
    act(() => {
      unloading = result.current.unload();
    });
    await waitFor(() => {
      expect(worker.lastRequestOfType('unload')).toBeDefined();
    });

    await act(async () => {
      worker.reply({
        type: 'error',
        requestId: worker.lastRequestOfType('unload')!.requestId,
        message: 'could not unload',
        fatal: false,
      });
      await unloading;
    });

    expect(consoleError).toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
    consoleError.mockRestore();
  });
});

describe('useWebLLM — when the worker itself fails', () => {
  it('reports the worker error against the request in flight', async () => {
    const { result } = await renderFreshHook();
    await waitFor(() => {
      expect(result.current.isCached).not.toBeNull();
    });

    act(() => {
      void result.current.loadModel();
    });
    const worker = FakeWorker.instances.at(-1)!;
    await waitFor(() => {
      expect(worker.postMessage).toHaveBeenCalled();
    });

    await act(async () => {
      worker.emitError('the worker script would not load');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.error).toContain('the worker script would not load');
  });

  it('says so when the browser has no workers at all', async () => {
    Object.defineProperty(globalThis, 'Worker', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const { result } = await renderFreshHook();
    await waitFor(() => {
      expect(result.current.isCached).not.toBeNull();
    });

    await act(async () => {
      await result.current.loadModel();
    });

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.error).toContain('Web Workers');
  });
});

describe('useWebLLM — the cache probe', () => {
  it('reports no cache when the browser exposes none', async () => {
    Object.defineProperty(globalThis, 'caches', { value: undefined, configurable: true });

    const { result } = await renderFreshHook();

    await waitFor(() => {
      expect(result.current.isCached).toBe(false);
    });
  });

  it('reports no cache when the probe itself fails', async () => {
    Object.defineProperty(globalThis, 'caches', {
      value: { open: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });

    const { result } = await renderFreshHook();

    await waitFor(() => {
      expect(result.current.isCached).toBe(false);
    });
  });
});
