/**
 * @fileoverview Regression tests for the useWebLLM hook.
 *
 * @module features/assistant/hooks/__tests__/useWebLLM
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ASSISTANT_MODEL_PRESETS } from '@/features/assistant/models';

import { useWebLLM } from '../useWebLLM';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@/lib/i18n', () => ({
  default: {
    t: (
      key: string,
      options?: { readonly defaultValue?: string },
    ) => options?.defaultValue ?? key,
  },
}));

const mockCapture = vi.fn();
const mockCaptureException = vi.fn();
vi.mock('@/lib/posthog', () => ({
  // The real module exports `undefined` with no PostHog env vars, which is the
  // case in every test — so without this the assertions below would pass
  // against a hook that captured nothing at all.
  default: {
    capture: (...args: unknown[]) => mockCapture(...args),
    captureException: (...args: unknown[]) => mockCaptureException(...args),
  },
}));

// ============================================================================
// Test Helpers
// ============================================================================

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function createCacheStorageMock() {
  const keys = vi.fn();
  const cachesMock = {
    open: vi.fn().mockResolvedValue({ keys }),
    delete: vi.fn().mockResolvedValue(true),
    has: vi.fn().mockResolvedValue(false),
    keys: vi.fn().mockResolvedValue([]),
    match: vi.fn().mockResolvedValue(undefined),
  };

  Object.defineProperty(globalThis, 'caches', {
    value: cachesMock,
    configurable: true,
  });

  return { cachesMock, keys };
}

/**
 * Stand-in for the LLM worker, so a test can answer a `load` request with the
 * failure the real worker posts back when onnxruntime finds no backend.
 */
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

  /** The `requestId` of the nth request this worker was sent. */
  requestIdAt(index: number): string {
    const call = this.postMessage.mock.calls[index]?.[0] as
      | { readonly requestId?: string }
      | undefined;
    return call?.requestId ?? '';
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

// ============================================================================
// Tests
// ============================================================================

describe('useWebLLM', () => {
  let originalCaches: typeof globalThis.caches;

  beforeEach(() => {
    originalCaches = globalThis.caches;
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'caches', {
      value: originalCaches,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it('ignores stale cache probes after the selected preset changes', async () => {
    const firstProbe = createDeferred<readonly Request[]>();
    const secondProbe = createDeferred<readonly Request[]>();
    const { cachesMock, keys } = createCacheStorageMock();
    const firstPreset = ASSISTANT_MODEL_PRESETS[1]!;
    const secondPreset = ASSISTANT_MODEL_PRESETS[2]!;

    keys
      .mockReturnValueOnce(firstProbe.promise)
      .mockReturnValueOnce(secondProbe.promise);

    const { result, rerender } = renderHook(
      ({ preset }) => useWebLLM(preset),
      {
        initialProps: {
          preset: firstPreset,
        },
      },
    );

    await waitFor(() => {
      expect(cachesMock.open).toHaveBeenCalledTimes(1);
    });

    rerender({ preset: secondPreset });

    await waitFor(() => {
      expect(cachesMock.open).toHaveBeenCalledTimes(2);
    });

    expect(result.current.isCached).toBeNull();

    await act(async () => {
      secondProbe.resolve([]);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.isCached).toBe(false);
    });

    await act(async () => {
      firstProbe.resolve([
        new Request(
          `https://example.test/${encodeURIComponent(firstPreset.modelId)}`,
        ),
      ]);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.isCached).toBe(false);
    });
  });
});

describe('useWebLLM model load failures', () => {
  let originalCaches: typeof globalThis.caches;
  let originalWorker: typeof globalThis.Worker;

  beforeEach(() => {
    originalCaches = globalThis.caches;
    originalWorker = globalThis.Worker;
    vi.clearAllMocks();
    installFakeWorker();
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

  /**
   * The hook keeps its worker and "which model is loaded" in module scope, so a
   * fresh copy per test is what stops one test's loaded model short-circuiting
   * the next one's `loadModel`.
   */
  async function renderFreshHook(
    preset: (typeof ASSISTANT_MODEL_PRESETS)[number],
  ) {
    vi.resetModules();
    const { useWebLLM: freshUseWebLLM } = await import('../useWebLLM');
    return renderHook(() => freshUseWebLLM(preset));
  }

  it('captures the caught load failure to PostHog', async () => {
    const { keys } = createCacheStorageMock();
    keys.mockResolvedValue([]);
    const preset = ASSISTANT_MODEL_PRESETS[0]!;

    const { result } = await renderFreshHook(preset);
    await waitFor(() => {
      expect(result.current.isCached).toBe(false);
    });

    act(() => {
      void result.current.loadModel();
    });

    const worker = FakeWorker.instances[0]!;
    await waitFor(() => {
      expect(worker.postMessage).toHaveBeenCalled();
    });

    // Exactly what the worker posts back for this failure: caught there, so it
    // is never an unhandled error and posthog-js's autocapture never sees it.
    await act(async () => {
      worker.reply({
        type: 'error',
        requestId: worker.requestIdAt(0),
        message:
          'no available backend found. ERR: [webgpu] Error: Failed to get GPU adapter.',
        fatal: true,
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });

    // By event name, not by position — a second capture firing alongside this
    // one must not silently move the assertion onto the wrong call.
    const failure = mockCapture.mock.calls.find(
      ([event]) => event === 'assistant_model_load_failed',
    );
    expect(failure).toBeDefined();
    expect(failure?.[1]).toMatchObject({
      reason: 'webgpu-unavailable',
      model_id: preset.modelId,
      dtype: preset.dtype,
      device: 'webgpu',
      from_cache: false,
    });

    // And as an exception, so Error tracking groups it into an issue.
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Failed to get GPU adapter'),
      }),
      expect.objectContaining({ model_id: preset.modelId }),
    );
  });

  it('captures nothing when the model loads', async () => {
    const { keys } = createCacheStorageMock();
    keys.mockResolvedValue([]);
    const preset = ASSISTANT_MODEL_PRESETS[0]!;

    const { result } = await renderFreshHook(preset);
    await waitFor(() => {
      expect(result.current.isCached).toBe(false);
    });

    act(() => {
      void result.current.loadModel();
    });

    const worker = FakeWorker.instances[0]!;
    await waitFor(() => {
      expect(worker.postMessage).toHaveBeenCalled();
    });

    await act(async () => {
      worker.reply({ type: 'loaded', requestId: worker.requestIdAt(0) });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    expect(
      mockCapture.mock.calls.filter(
        ([event]) => event === 'assistant_model_load_failed',
      ),
    ).toHaveLength(0);
    expect(mockCaptureException).not.toHaveBeenCalled();
  });
});

describe('classifyModelLoadFailure', () => {
  it.each([
    [
      'no available backend found. ERR: [webgpu] Error: Failed to get GPU adapter.',
      'webgpu-unavailable',
    ],
    // Both words appear; the memory is the half somebody can act on.
    ['Failed to allocate memory for buffer mapping (webgpu)', 'out-of-memory'],
    ['Failed to fetch model file', 'network'],
    ['Something nobody has seen before', 'unknown'],
  ])('files %j as %s', async (message, expected) => {
    const { classifyModelLoadFailure } = await import('../useWebLLM');

    expect(classifyModelLoadFailure(message)).toBe(expected);
  });
});
