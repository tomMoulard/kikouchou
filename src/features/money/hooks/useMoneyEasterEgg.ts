/**
 * @fileoverview Ten taps on the money page's title, and the emoji fall.
 *
 * The counter is deliberately impatient: taps more than {@link TAP_WINDOW_MS}
 * apart do not add up, so the tenth ordinary click of an afternoon never sets
 * it off by accident.
 *
 * @module features/money/hooks/useMoneyEasterEgg
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================================
// Constants
// ============================================================================

/** Taps needed. */
const TAPS_TO_TRIGGER = 10;

/** How long one tap counts for. */
const TAP_WINDOW_MS = 1200;

/** How long the shower lasts, matching the longest piece plus its delay. */
const RUN_DURATION_MS = 4200;

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * What {@link useMoneyEasterEgg} hands back.
 */
export interface MoneyEasterEgg {
  /** The current run, or `null` while nothing is falling. */
  readonly runId: number | null;
  /** Counts one tap on the title. */
  readonly registerTap: () => void;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Counts taps and reports when the shower should run.
 *
 * @returns The current run and the tap handler
 *
 * @example
 * ```tsx
 * const { runId, registerTap } = useMoneyEasterEgg();
 * <PageHeader title={t('money.title')} onTitleClick={registerTap} />
 * {runId === null ? null : <MoneyConfetti runId={runId} />}
 * ```
 */
export function useMoneyEasterEgg(): MoneyEasterEgg {
  const [runId, setRunId] = useState<number | null>(null);
  const tapsRef = useRef(0);
  const lastTapRef = useRef(0);
  const isMountedRef = useRef(false);

  // Set on setup as well as cleared on cleanup: `useEffect(() => () => …, [])`
  // latches `false` forever under StrictMode's mount → cleanup → mount cycle.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const registerTap = useCallback((): void => {
    const now = Date.now();
    tapsRef.current = now - lastTapRef.current > TAP_WINDOW_MS ? 1 : tapsRef.current + 1;
    lastTapRef.current = now;

    if (tapsRef.current < TAPS_TO_TRIGGER) {
      return;
    }

    tapsRef.current = 0;

    // An animation whose whole content is movement is not shown to a viewer who
    // asked for less of it.
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    setRunId(now);
    window.setTimeout(() => {
      if (isMountedRef.current) {
        setRunId(null);
      }
    }, RUN_DURATION_MS);
  }, []);

  return { runId, registerTap };
}
