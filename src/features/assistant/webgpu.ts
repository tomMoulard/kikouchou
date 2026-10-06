/**
 * @fileoverview WebGPU availability probe for the on-device assistant.
 *
 * Every model preset in `models.ts` runs with `device: 'webgpu'`, which makes
 * onnxruntime-web register that execution provider and no other. When the
 * device cannot supply an adapter there is nothing to fall back to and the
 * pipeline throws `no available backend found. ERR: [webgpu] Error: Failed to
 * get GPU adapter.` — a string that used to reach the user verbatim, complete
 * with onnxruntime's advice to pass `--enable-unsafe-webgpu`, a desktop-Chrome
 * flag that means nothing on the Android phones this actually happens on.
 *
 * So the support question is answered *before* the assistant offers to
 * download 2.5 GB of weights, not after.
 *
 * **`'gpu' in navigator` is not the test.** Android Chrome exposes
 * `navigator.gpu` on every device and still resolves `requestAdapter()` to
 * `null` unless the GPU and driver are on Chrome's allowlist — which is exactly
 * the case this module exists for. Only an awaited `requestAdapter()` separates
 * a browser that has the API from a device that can use it.
 *
 * @module features/assistant/webgpu
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * The outcome of a probe, kept as four values rather than a boolean because
 * they are four different problems: a browser too old for WebGPU, a driver
 * Chrome refuses to use, and a probe that threw need different answers, and
 * the value rides along as the `reason` on the PostHog capture.
 */
export type WebGPUSupport =
  | 'supported'
  | 'no-api'
  | 'no-adapter'
  | 'probe-failed';

/**
 * The one member of the WebGPU API this module touches.
 *
 * Declared structurally on purpose: `lib.dom` ships no WebGPU types and
 * `@webgpu/types` is not a dependency, so a whole type package would be pulled
 * in for a single method that is only ever called for its null-ness.
 */
interface GPULike {
  requestAdapter(): Promise<object | null>;
}

// ============================================================================
// Probe
// ============================================================================

/**
 * Asks the browser whether this device can actually run a WebGPU workload.
 *
 * Never rejects — a probe that throws is itself an unsupported device, and a
 * rejection here would land in the load path it is meant to protect.
 *
 * @returns Why WebGPU is unusable, or `'supported'`
 */
export async function probeWebGPUSupport(): Promise<WebGPUSupport> {
  if (typeof navigator === 'undefined') {
    return 'no-api';
  }

  const { gpu } = navigator as Navigator & { readonly gpu?: GPULike };
  if (!gpu || typeof gpu.requestAdapter !== 'function') {
    return 'no-api';
  }

  try {
    const adapter = await gpu.requestAdapter();
    return adapter ? 'supported' : 'no-adapter';
  } catch {
    // Seen on locked-down or virtualised GPUs, where the call rejects rather
    // than resolving null. Same outcome for the user either way.
    return 'probe-failed';
  }
}
