/**
 * @fileoverview Tests for the WebGPU availability probe.
 *
 * @module features/assistant/__tests__/webgpu
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { probeWebGPUSupport } from '../webgpu';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Installs a `navigator.gpu` for the duration of one test.
 *
 * `undefined` removes the property entirely, which is the pre-WebGPU browser —
 * distinct from a `gpu` object whose `requestAdapter` resolves `null`.
 */
function stubNavigatorGPU(gpu: unknown): void {
  Object.defineProperty(navigator, 'gpu', {
    value: gpu,
    configurable: true,
    writable: true,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('probeWebGPUSupport', () => {
  afterEach(() => {
    // `delete` rather than a saved value: jsdom's navigator has no `gpu`, and
    // leaving one behind would hand the next test a browser it never asked for.
    Reflect.deleteProperty(navigator, 'gpu');
    vi.restoreAllMocks();
  });

  it('reports no-api when the browser has no WebGPU at all', async () => {
    stubNavigatorGPU(undefined);

    await expect(probeWebGPUSupport()).resolves.toBe('no-api');
  });

  it('reports no-api when gpu exists but exposes no requestAdapter', async () => {
    stubNavigatorGPU({});

    await expect(probeWebGPUSupport()).resolves.toBe('no-api');
  });

  it('reports supported when an adapter comes back', async () => {
    stubNavigatorGPU({ requestAdapter: vi.fn().mockResolvedValue({}) });

    await expect(probeWebGPUSupport()).resolves.toBe('supported');
  });

  it('reports no-adapter when the API exists but resolves null', async () => {
    // The Android Chrome case this whole module exists for: `navigator.gpu` is
    // present on every device, and returns null off the driver allowlist. A
    // probe written as `'gpu' in navigator` would call this one supported.
    stubNavigatorGPU({ requestAdapter: vi.fn().mockResolvedValue(null) });

    await expect(probeWebGPUSupport()).resolves.toBe('no-adapter');
  });

  it('reports probe-failed instead of rejecting when requestAdapter throws', async () => {
    stubNavigatorGPU({
      requestAdapter: vi.fn().mockRejectedValue(new Error('GPU process crashed')),
    });

    // Must resolve: a rejection here would land in the load path the probe is
    // meant to keep clear.
    await expect(probeWebGPUSupport()).resolves.toBe('probe-failed');
  });
});
