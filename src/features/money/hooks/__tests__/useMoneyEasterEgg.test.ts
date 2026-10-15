/**
 * @fileoverview Ten taps on the money title, and what stops it firing early.
 * @module features/money/hooks/__tests__/useMoneyEasterEgg.test
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMoneyEasterEgg } from '@/features/money/hooks/useMoneyEasterEgg';

// ============================================================================
// Helpers
// ============================================================================

/** Answers the reduced-motion query the hook asks. */
function mockReducedMotion(reduce: boolean): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        onchange: null,
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  );
}

function tap(result: { current: { registerTap: () => void } }, times: number): void {
  for (let index = 0; index < times; index += 1) {
    act(() => {
      result.current.registerTap();
    });
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('useMoneyEasterEgg', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockReducedMotion(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays quiet for nine taps', () => {
    const { result } = renderHook(() => useMoneyEasterEgg());

    tap(result, 9);

    expect(result.current.runId).toBeNull();
  });

  it('runs on the tenth', () => {
    const { result } = renderHook(() => useMoneyEasterEgg());

    tap(result, 10);

    expect(result.current.runId).not.toBeNull();
  });

  it('stops on its own', () => {
    const { result } = renderHook(() => useMoneyEasterEgg());

    tap(result, 10);
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(result.current.runId).toBeNull();
  });

  it('does not add up taps a second apart, so an ordinary click never sets it off', () => {
    const { result } = renderHook(() => useMoneyEasterEgg());

    for (let index = 0; index < 20; index += 1) {
      act(() => {
        result.current.registerTap();
        vi.advanceTimersByTime(2000);
      });
    }

    expect(result.current.runId).toBeNull();
  });

  it('shows nothing at all to a viewer who asked for reduced motion', () => {
    mockReducedMotion(true);
    const { result } = renderHook(() => useMoneyEasterEgg());

    tap(result, 10);

    expect(result.current.runId).toBeNull();
  });

  it('runs again on the next ten taps', () => {
    const { result } = renderHook(() => useMoneyEasterEgg());

    tap(result, 10);
    const first = result.current.runId;
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // A tap window later, so the counter starts from scratch rather than
    // carrying the previous run's taps.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    tap(result, 10);

    expect(result.current.runId).not.toBeNull();
    expect(result.current.runId).not.toBe(first);
  });
});
