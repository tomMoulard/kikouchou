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
 * An experiment's flag is multivariate, and `isFeatureEnabled` answers `true`
 * for its control arm as well as its test arm, so {@link useFeatureFlag} cannot
 * tell them apart. {@link useFeatureFlagVariant} returns the variant key.
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

/**
 * A forced variant for one flag, or `undefined` when none is set.
 *
 * `on` forces the `test` arm and `off` the `control` arm, the keys every
 * experiment here uses; any other stored value is taken as a variant key
 * (`wizard` reaches the third arm of `onboarding-planning-view`).
 *
 * @param key - The flag key
 * @returns The forced variant key, or undefined
 */
export function readVariantOverride(key: string): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  try {
    const value = window.localStorage.getItem(`${FLAG_OVERRIDE_PREFIX}${key}`);
    if (value === 'on') {
      return 'test';
    }
    if (value === 'off') {
      return 'control';
    }
    return value || undefined;
  } catch {
    return undefined;
  }
}

type Client = NonNullable<typeof posthog>;

/**
 * Waits for PostHog's answer to one flag, read through `read`.
 *
 * @param key - The flag key
 * @param readOverride - Reads the forced answer, if any
 * @param read - Reads the answer once the flags are loaded
 * @param off - The answer when nothing will ever come
 * @returns The answer once known; `undefined` while PostHog is asked
 */
function useFlagAnswer<T>(
  key: string,
  readOverride: (key: string) => T | undefined,
  read: (client: Client, key: string) => T,
  off: T,
): T | undefined {
  const [value, setValue] = useState<T | undefined>(() => {
    const override = readOverride(key);
    if (override !== undefined) {
      return override;
    }
    // No client: nothing will ever answer, so the answer is no.
    return posthog ? undefined : off;
  });

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
      setValue(read(client, key));
    });

    const timer = setTimeout(() => {
      if (!settled) {
        setValue(off);
      }
    }, FLAG_TIMEOUT_MS);

    return () => {
      clearTimeout(timer);
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [key, value, read, off]);

  return value;
}

function readEnabled(client: Client, key: string): boolean {
  return client.isFeatureEnabled(key) === true;
}

function readVariant(client: Client, key: string): string | false {
  const variant = client.getFeatureFlag(key);
  return typeof variant === 'string' ? variant : false;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Whether a PostHog feature flag is on for this person.
 *
 * @param key - The flag key as created in PostHog
 * @returns `true` or `false` once known; `undefined` while PostHog is asked
 *
 * @example
 * ```tsx
 * const publish = useFeatureFlag('ent-trip-templates');
 * if (publish === undefined) return <LoadingState />;
 * return publish ? <PublishControls /> : <UpgradeOffer />;
 * ```
 */
export function useFeatureFlag(key: string): boolean | undefined {
  return useFlagAnswer(key, readFlagOverride, readEnabled, false);
}

/**
 * Which arm of a multivariate flag this person is in.
 *
 * Reading the variant is what makes posthog-js send `$feature_flag_called`,
 * the exposure an experiment counts. Call it only where the person actually
 * meets the experiment, or the experiment counts people it never showed.
 *
 * @param key - The flag key as created in PostHog
 * @returns The variant key once known, `false` when the person is in no arm
 *   (or PostHog never answered); `undefined` while PostHog is asked
 *
 * @example
 * ```tsx
 * const variant = useFeatureFlagVariant('onboarding-planning-view');
 * if (variant === undefined) return <LoadingState />;
 * return variant === 'test' ? <PlanningView /> : <TripList />;
 * ```
 */
export function useFeatureFlagVariant(key: string): string | false | undefined {
  return useFlagAnswer(key, readVariantOverride, readVariant, false);
}
