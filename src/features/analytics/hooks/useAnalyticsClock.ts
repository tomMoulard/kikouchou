/**
 * @fileoverview A once-a-minute timestamp, plus a retry token, for the
 * analytics pages' live queries.
 *
 * "Pickups needing a driver" only counts *upcoming* pickups, so the number goes
 * stale on a page left open. `TransportContext` refreshes its own clock every
 * minute for the same reason; the analytics pages read Dexie directly, so they
 * need their own.
 *
 * The retry token is here too because both belong to the same `useLiveQuery`
 * dependency list: bumping it re-runs the read, which is what the error state's
 * Retry button does instead of reloading the whole page.
 *
 * @module features/analytics/hooks/useAnalyticsClock
 */

import { useCallback, useEffect, useState } from 'react';

import type { ISODateTimeString } from '@/types';

// ============================================================================
// Types
// ============================================================================

export interface AnalyticsClockOptions {
  /**
   * Keep `now` moving.
   *
   * Only a page showing a time-dependent figure wants this: every tick changes
   * a dependency and so re-runs the live query it feeds. The all-trips page
   * renders nothing that depends on the time, and with twenty trips a ticking
   * clock would re-read every one of them once a minute for no change on
   * screen.
   *
   * @default false
   */
  readonly live?: boolean;
}

export interface AnalyticsClock {
  /** Current time. Refreshed every minute only when `live` is set. */
  readonly now: ISODateTimeString;
  /** Changes on every {@link AnalyticsClock.retry}; include it in query deps. */
  readonly retryToken: number;
  /** Re-runs the queries that depend on this clock. */
  readonly retry: () => void;
}

// ============================================================================
// Constants
// ============================================================================

/** Matches `TransportContext`'s own refresh cadence. */
const REFRESH_INTERVAL_MS = 60_000;

// ============================================================================
// Hook
// ============================================================================

/**
 * Provides the clock and retry token the analytics live queries depend on.
 *
 * @param options - Whether the clock should keep ticking.
 * @returns The current timestamp, a retry token, and the retry callback.
 *
 * @example
 * ```tsx
 * const { now, retryToken, retry } = useAnalyticsClock({ live: true });
 * const result = useLiveQuery(() => read(now), [tripId, now, retryToken]);
 * ```
 */
export function useAnalyticsClock(
  options: AnalyticsClockOptions = {},
): AnalyticsClock {
  const { live = false } = options;
  const [now, setNow] = useState<ISODateTimeString>(() =>
    new Date().toISOString(),
  );
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!live) {
      return;
    }

    const intervalId = setInterval(() => {
      setNow(new Date().toISOString());
    }, REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [live]);

  const retry = useCallback((): void => {
    setNow(new Date().toISOString());
    setRetryToken((previous) => previous + 1);
  }, []);

  return { now, retryToken, retry };
}
