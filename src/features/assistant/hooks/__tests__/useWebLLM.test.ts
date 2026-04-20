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
