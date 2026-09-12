/**
 * @fileoverview Runs the WebGPU probe once per mount and reports its result.
 *
 * @module features/assistant/hooks/useWebGPUSupport
 */

import { useEffect, useRef, useState } from 'react';

import { probeWebGPUSupport, type WebGPUSupport } from '../webgpu';

// ============================================================================
// Hook
// ============================================================================

/**
 * Probes WebGPU support on mount.
 *
 * @returns The probe result, or `null` while it is still in flight
 */
export function useWebGPUSupport(): WebGPUSupport | null {
  const [support, setSupport] = useState<WebGPUSupport | null>(null);
  const isMountedRef = useRef(false);

  useEffect(() => {
    // Set on setup, not only in cleanup: StrictMode's mount → cleanup → mount
    // would otherwise latch this `false` forever and the probe result would
    // never reach state, leaving the assistant permanently "probing".
    isMountedRef.current = true;

    void probeWebGPUSupport().then((result) => {
      if (isMountedRef.current) {
        setSupport(result);
      }
    });

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return support;
}
