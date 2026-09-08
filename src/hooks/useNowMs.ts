/**
 * @fileoverview The app's minute clock — one reference instant, refreshed.
 *
 * `TransportContext` grew this because three transport surfaces each derived
 * their own `new Date()` and then disagreed: a pickup could be past on the list
 * and upcoming in the alert panel at the same moment. The fix was a single
 * `nowMs` published by the provider, and this module is that implementation
 * pulled out so there is exactly one of it.
 *
 * Two refresh triggers, and both are load-bearing:
 *
 * - **Every minute**, so the UI ages without a reload. A pickup that has just
 *   happened drops out of the upcoming list on its own tick.
 * - **On resume** (`visibilitychange` and `focus`), because a backgrounded PWA
 *   has its timers throttled or frozen outright. Without the resume handler a
 *   user coming back after lunch reads an hours-stale clock until the next tick
 *   lands — which, on a phone that was asleep, may be whenever they next
 *   scroll.
 *
 * A component that needs "now" *and* already has a provider publishing it
 * should read the provider's value rather than calling this a second time. Two
 * hooks means two intervals on two offsets, which is the same disagreement one
 * layer down.
 *
 * @module hooks/useNowMs
 */

import { useEffect, useRef, useState } from 'react';

// ============================================================================
// Constants
// ============================================================================

/**
 * How often the reference instant is resampled, in milliseconds.
 *
 * A minute, because every consumer renders wall-clock times to the minute:
 * a shorter interval would re-render the tree to redraw an identical string.
 */
export const NOW_REFRESH_INTERVAL_MS = 60_000;

// ============================================================================
// Hook
// ============================================================================

/**
 * Returns the current instant in epoch milliseconds, refreshed as it ages.
 *
 * Epoch milliseconds rather than a `Date` or an ISO string on purpose:
 * comparing ISO strings only works while every stored datetime shares one
 * exact formatting, and nothing guarantees that for rows arriving over Yjs.
 *
 * @returns The reference instant, epoch ms
 *
 * @example
 * ```tsx
 * const nowMs = useNowMs();
 * const isDue = leaveAtMs !== null && nowMs >= leaveAtMs;
 * ```
 */
export function useNowMs(): number {
  const [nowMs, setNowMs] = useState<number>(() => Date.now()),
    // Set on setup, not only in cleanup: the cleanup-only form latches false
    // forever under StrictMode's mount → cleanup → mount cycle, and every
    // guarded update after it is a silent no-op.
    isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    const refresh = (): void => {
      if (isMountedRef.current) {
        setNowMs(Date.now());
      }
    };

    const handleResume = (): void => {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    };

    const intervalId = setInterval(refresh, NOW_REFRESH_INTERVAL_MS);

    document.addEventListener('visibilitychange', handleResume);
    // Some browsers do not fire `visibilitychange` reliably on window focus,
    // so both are registered and the handler is idempotent.
    window.addEventListener('focus', handleResume);

    return () => {
      isMountedRef.current = false;
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleResume);
      window.removeEventListener('focus', handleResume);
    };
  }, []);

  return nowMs;
}
