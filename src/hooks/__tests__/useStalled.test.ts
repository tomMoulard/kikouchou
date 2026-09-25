/**
 * @fileoverview Tests for the dialog escape hatch.
 *
 * The behaviour under test is the one that stops a hung write from reading as a
 * frozen app: a dialog may refuse to close while it saves, but not forever.
 *
 * @module hooks/__tests__/useStalled.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { STALL_TIMEOUT_MS, useStalled } from '@/hooks/useStalled';

describe('useStalled', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is not stalled while nothing is in flight', () => {
    const { result } = renderHook(() => useStalled(false));

    act(() => {
      vi.advanceTimersByTime(STALL_TIMEOUT_MS * 10);
    });

    expect(result.current).toBe(false);
  });

  it('holds the lock for the whole grace period', () => {
    const { result } = renderHook(() => useStalled(true));

    act(() => {
      vi.advanceTimersByTime(STALL_TIMEOUT_MS - 1);
    });

    // A save that is merely slow must not have its dialog closed underneath it.
    expect(result.current).toBe(false);
  });

  it('lets go once the work has outlived any plausible save', () => {
    const { result } = renderHook(() => useStalled(true));

    act(() => {
      vi.advanceTimersByTime(STALL_TIMEOUT_MS);
    });

    expect(result.current).toBe(true);
  });

  it('clears when the work finishes', () => {
    const { result, rerender } = renderHook(({ busy }) => useStalled(busy), {
      initialProps: { busy: true },
    });

    act(() => {
      vi.advanceTimersByTime(STALL_TIMEOUT_MS);
    });
    expect(result.current).toBe(true);

    rerender({ busy: false });
    expect(result.current).toBe(false);
  });

  it('gives a second attempt the full grace period again', () => {
    const { result, rerender } = renderHook(({ busy }) => useStalled(busy), {
      initialProps: { busy: true },
    });

    act(() => {
      vi.advanceTimersByTime(STALL_TIMEOUT_MS);
    });
    rerender({ busy: false });
    rerender({ busy: true });

    act(() => {
      vi.advanceTimersByTime(STALL_TIMEOUT_MS - 1);
    });
    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(true);
  });

  it('honours a caller-supplied timeout', () => {
    const { result } = renderHook(() => useStalled(true, 100));

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current).toBe(true);
  });

  it('does not fire after the work is torn down', () => {
    const { result, unmount } = renderHook(() => useStalled(true));

    unmount();
    act(() => {
      vi.advanceTimersByTime(STALL_TIMEOUT_MS * 2);
    });

    expect(result.current).toBe(false);
  });
});
