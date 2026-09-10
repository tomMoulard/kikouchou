/**
 * @fileoverview A PostHog feature flag, as one boolean the UI can render from.
 *
 * Flags arrive asynchronously, after PostHog has loaded them for this person,
 * so the hook has three answers: `undefined` while the decision is pending,
 * then `true` or `false`. A screen that switches between two experiences waits
 * on `undefined` rather than flashing the control arm at everybody.
 *
 * Without analytics — no key in the build, the localhost guard, an e2e run —
 * there is nothing to ask and the answer is `false`, at once. A local override
 * in `localStorage` (`kikouchou-flag:<key>` = `on` | `off`) wins over both, so
 * a developer or an end-to-end test can force an arm without a PostHog project.
 *
 * @module hooks/useFeatureFlag
 */

import { useEffect, useState } from 'react';

import posthog from '@/lib/posthog';

// ============================================================================
// Constants
// ============================================================================

/** `localStorage` key prefix for a forced flag value. */
export const FLAG_OVERRIDE_PREFIX = 'kikouchou-flag:';

/**
 * How long to wait for PostHog before treating the flag as off.
 *
 * PostHog answers in well under a second on a normal connection; a device that
 * cannot reach it gets the control experience rather than a spinner for life.
 */
const FLAG_TIMEOUT_MS = 2_500;

// ============================================================================
// Helpers
// ============================================================================

/**
 * A forced value for one flag, or `undefined` when none is set.
 *
 * @param key - The flag key
 * @returns The forced boolean, or undefined
 */
export function readFlagOverride(key: string): boolean | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  try {
    const value = window.localStorage.getItem(`${FLAG_OVERRIDE_PREFIX}${key}`);
    if (value === 'on') {
      return true;
    }
    if (value === 'off') {
      return false;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function initialValue(key: string): boolean | undefined {
  const override = readFlagOverride(key);
  if (override !== undefined) {
    return override;
  }
  // No client: nothing will ever answer, so the answer is no.
  return posthog ? undefined : false;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Whether a PostHog feature flag is on for this person.
 *
 * @param key - The flag key as created in PostHog
 * @returns `true` or `false` once known; `undefined` while PostHog is asked
 *
 * @example
 * ```tsx
 * const wizard = useFeatureFlag('first-trip-wizard');
 * if (wizard === undefined) return <LoadingState />;
 * return wizard ? <Wizard /> : <Form />;
 * ```
 */
export function useFeatureFlag(key: string): boolean | undefined {
  const [value, setValue] = useState<boolean | undefined>(() => initialValue(key));

  useEffect(() => {
    if (value !== undefined || !posthog) {
      return undefined;
    }
    const client = posthog;
    let settled = false;

    // Called at once when the flags are already loaded, and again whenever
    // they reload; the first call is the one this hook waits for.
    const unsubscribe: unknown = client.onFeatureFlags(() => {
      settled = true;
      setValue(client.isFeatureEnabled(key) === true);
    });

    const timer = setTimeout(() => {
      if (!settled) {
        setValue(false);
      }
    }, FLAG_TIMEOUT_MS);

    return () => {
      clearTimeout(timer);
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [key, value]);

  return value;
}
