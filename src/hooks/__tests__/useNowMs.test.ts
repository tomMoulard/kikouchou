/**
 * @fileoverview Tests for the app's minute clock.
 *
 * Three things are asserted, and each one exists because its absence is a real
 * failure mode rather than a style preference:
 *
 * - the value ages on its own, so a view left open does not freeze;
 * - it catches up on resume, because a backgrounded PWA has its timers
 *   throttled or frozen and the interval alone would not fire;
 * - it survives StrictMode's mount → cleanup → mount cycle, which is what a
 *   cleanup-only unmount guard latches `false` forever.
 *
 * @module hooks/__tests__/useNowMs.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { renderHook, act } from '@testing-library/react';

import { NOW_REFRESH_INTERVAL_MS, useNowMs } from '../useNowMs';

// ============================================================================
// Helpers
// ============================================================================

/** A fixed wall clock to start from; the offsets below are what matter. */
const START = new Date('2026-07-15T10:00:00').getTime();

// ============================================================================
// Tests
// ============================================================================

describe('useNowMs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts at the current instant', () => {
    const { result } = renderHook(() => useNowMs());

    expect(result.current).toBe(START);
  });

  it('ages by itself once the interval elapses', () => {
    const { result } = renderHook(() => useNowMs());

    // `advanceTimersByTime` moves the fake clock as well as firing the timer,
    // so nothing here sets the system time by hand — doing both would land a
    // minute further on than the interval that is under test.
    act(() => {
      vi.advanceTimersByTime(NOW_REFRESH_INTERVAL_MS);
    });

    expect(result.current).toBe(START + NOW_REFRESH_INTERVAL_MS);
  });

  it('catches up on resume, without waiting for the next tick', () => {
    const { result } = renderHook(() => useNowMs());

    // A backgrounded PWA: two hours of wall clock, no timers fired.
    const AFTER_LUNCH = START + 2 * 60 * 60_000;
    act(() => {
      vi.setSystemTime(AFTER_LUNCH);
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(result.current).toBe(AFTER_LUNCH);
  });

  it('catches up on window focus too', () => {
    const { result } = renderHook(() => useNowMs());

    const LATER = START + 45 * 60_000;
    act(() => {
      vi.setSystemTime(LATER);
      window.dispatchEvent(new Event('focus'));
    });

    expect(result.current).toBe(LATER);
  });

  it('keeps ticking under StrictMode, whose remount would latch a bad guard', () => {
    const { result } = renderHook(() => useNowMs(), { wrapper: StrictMode });

    // `advanceTimersByTime` moves the fake clock as well as firing the timer,
    // so nothing here sets the system time by hand — doing both would land a
    // minute further on than the interval that is under test.
    act(() => {
      vi.advanceTimersByTime(NOW_REFRESH_INTERVAL_MS);
    });

    expect(result.current).toBe(START + NOW_REFRESH_INTERVAL_MS);
  });

  it('stops its interval and its listeners on unmount', () => {
    const { unmount } = renderHook(() => useNowMs());

    unmount();

    // No pending timer is left to fire into an unmounted tree; React would warn
    // on the resulting update, and vitest fails the run on an unhandled one.
    expect(vi.getTimerCount()).toBe(0);
  });
});
