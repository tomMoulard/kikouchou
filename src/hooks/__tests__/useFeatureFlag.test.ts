/**
 * @fileoverview A feature flag: pending, then on or off; forced when asked.
 *
 * @module hooks/__tests__/useFeatureFlag.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// ============================================================================
// Test doubles
// ============================================================================

type FlagsCallback = () => void;

const client = {
  callbacks: [] as FlagsCallback[],
  enabled: false,
  present: true,
  onFeatureFlags(callback: FlagsCallback): () => void {
    client.callbacks.push(callback);
    return () => {
      client.callbacks = client.callbacks.filter((entry) => entry !== callback);
    };
  },
  isFeatureEnabled(): boolean {
    return client.enabled;
  },
};

vi.mock('@/lib/posthog', () => ({
  get default() {
    return client.present ? client : null;
  },
}));

const stored = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      stored.set(key, value);
    },
    removeItem: (key: string) => {
      stored.delete(key);
    },
    clear: () => stored.clear(),
    key: () => null,
    length: 0,
  },
});

const { useFeatureFlag, readFlagOverride } = await import('@/hooks/useFeatureFlag');

beforeEach(() => {
  stored.clear();
  client.callbacks = [];
  client.enabled = false;
  client.present = true;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================================
// Tests
// ============================================================================

describe('useFeatureFlag', () => {
  it('is undecided until PostHog has answered, then follows the flag', () => {
    client.enabled = true;
    const { result } = renderHook(() => useFeatureFlag('first-trip-wizard'));

    // No flash of either arm while the flags load.
    expect(result.current).toBeUndefined();

    act(() => {
      client.callbacks.forEach((callback) => callback());
    });

    expect(result.current).toBe(true);
  });

  it('reads off when PostHog says so', () => {
    const { result } = renderHook(() => useFeatureFlag('first-trip-wizard'));

    act(() => {
      client.callbacks.forEach((callback) => callback());
    });

    expect(result.current).toBe(false);
  });

  it('gives up on PostHog after a while and shows the control arm', () => {
    const { result } = renderHook(() => useFeatureFlag('first-trip-wizard'));

    act(() => {
      vi.advanceTimersByTime(2_500);
    });

    expect(result.current).toBe(false);
  });

  it('is off at once when there is no analytics client', () => {
    client.present = false;

    const { result } = renderHook(() => useFeatureFlag('first-trip-wizard'));

    expect(result.current).toBe(false);
  });

  it('lets a local override force either arm without PostHog', () => {
    stored.set('kikouchou-flag:first-trip-wizard', 'on');
    expect(readFlagOverride('first-trip-wizard')).toBe(true);
    expect(renderHook(() => useFeatureFlag('first-trip-wizard')).result.current).toBe(true);

    stored.set('kikouchou-flag:first-trip-wizard', 'off');
    client.enabled = true;
    expect(renderHook(() => useFeatureFlag('first-trip-wizard')).result.current).toBe(false);

    // Nothing was asked of PostHog either time.
    expect(client.callbacks).toHaveLength(0);
  });

  it('ignores an override it does not understand', () => {
    stored.set('kikouchou-flag:first-trip-wizard', 'maybe');

    expect(readFlagOverride('first-trip-wizard')).toBeUndefined();
  });

  it('stops listening when the component goes away', () => {
    const { unmount } = renderHook(() => useFeatureFlag('first-trip-wizard'));
    expect(client.callbacks).toHaveLength(1);

    unmount();

    expect(client.callbacks).toHaveLength(0);
  });
});
