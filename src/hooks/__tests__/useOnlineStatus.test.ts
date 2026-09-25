/**
 * useOnlineStatus Hook Tests
 *
 * @module hooks/__tests__/useOnlineStatus.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { renderHook, act } from '@testing-library/react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';

// ============================================================================
// Tests
// ============================================================================

describe('useOnlineStatus', () => {
  let originalOnLine: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    originalOnLine = navigator.onLine;
  });

  afterEach(() => {
    vi.useRealTimers();
    // Restore navigator.onLine
    Object.defineProperty(navigator, 'onLine', {
      value: originalOnLine,
      writable: true,
      configurable: true,
    });
  });

  it('returns current online status', () => {
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useOnlineStatus());

    expect(result.current.isOnline).toBe(true);
    expect(result.current.hasRecentlyChanged).toBe(false);
  });

  it('returns offline when navigator.onLine is false', () => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useOnlineStatus());

    expect(result.current.isOnline).toBe(false);
  });

  it('detects going offline via event', () => {
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useOnlineStatus());

    expect(result.current.isOnline).toBe(true);

    // Simulate going offline
    act(() => {
      Object.defineProperty(navigator, 'onLine', {
        value: false,
        writable: true,
        configurable: true,
      });
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current.isOnline).toBe(false);
  });

  it('detects going back online via event', () => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useOnlineStatus());

    expect(result.current.isOnline).toBe(false);

    // Simulate going online
    act(() => {
      Object.defineProperty(navigator, 'onLine', {
        value: true,
        writable: true,
        configurable: true,
      });
      window.dispatchEvent(new Event('online'));
    });

    expect(result.current.isOnline).toBe(true);
    expect(result.current.hasRecentlyChanged).toBe(true);
  });

  it('resets hasRecentlyChanged after 3 seconds', () => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useOnlineStatus());

    // Go online
    act(() => {
      Object.defineProperty(navigator, 'onLine', {
        value: true,
        writable: true,
        configurable: true,
      });
      window.dispatchEvent(new Event('online'));
    });

    expect(result.current.hasRecentlyChanged).toBe(true);

    // Advance past the 3s duration
    act(() => {
      vi.advanceTimersByTime(3100);
    });

    expect(result.current.hasRecentlyChanged).toBe(false);
  });

  it('clears hasRecentlyChanged when going offline again', () => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useOnlineStatus());

    // Go online
    act(() => {
      Object.defineProperty(navigator, 'onLine', {
        value: true,
        writable: true,
        configurable: true,
      });
      window.dispatchEvent(new Event('online'));
    });

    expect(result.current.hasRecentlyChanged).toBe(true);

    // Go offline again before the timer expires
    act(() => {
      Object.defineProperty(navigator, 'onLine', {
        value: false,
        writable: true,
        configurable: true,
      });
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current.isOnline).toBe(false);
    expect(result.current.hasRecentlyChanged).toBe(false);
  });

  it('cleans up timers on unmount', () => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      writable: true,
      configurable: true,
    });

    const { result, unmount } = renderHook(() => useOnlineStatus());

    // Go online to start timer
    act(() => {
      Object.defineProperty(navigator, 'onLine', {
        value: true,
        writable: true,
        configurable: true,
      });
      window.dispatchEvent(new Event('online'));
    });

    expect(result.current.hasRecentlyChanged).toBe(true);

    // Unmount should not throw
    unmount();

    // Advancing timers after unmount should not cause issues
    act(() => {
      vi.advanceTimersByTime(5000);
    });
  });

  it('cleans up without errors when no timer is running', () => {
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      writable: true,
      configurable: true,
    });

    const { result, unmount } = renderHook(() => useOnlineStatus());

    // Nothing went offline, so no recent-change timer was ever started.
    expect(result.current.hasRecentlyChanged).toBe(false);

    unmount();

    // Advancing past the recent-change window must produce no work at all: a
    // cleanup that cleared the wrong handle, or none, would let a stray
    // setState fire here and React would warn about updating an unmounted
    // component. Asserting on a global clearTimeout spy instead would fail the
    // day React or RTL clears a timer of their own during teardown.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  /**
   * `isMountedRef` guards the `setHasRecentlyChanged` inside the recent-change
   * timeout, and has to be set true on effect *setup*, not only reset to false
   * in cleanup.
   *
   * StrictMode runs setup -> cleanup -> setup on one component instance, so a
   * ref written only in cleanup latches false on the first pass and stays false.
   * The guarded setState then silently no-ops for the life of the component: the
   * "back online" banner never goes away, and nothing throws to say so. The
   * tests above cannot see it, because none of them runs a cleanup before the
   * update it checks.
   */
  it('still clears hasRecentlyChanged under StrictMode, after the double-invoked effect', () => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useOnlineStatus(), {
      wrapper: StrictMode,
    });

    act(() => {
      Object.defineProperty(navigator, 'onLine', {
        value: true,
        writable: true,
        configurable: true,
      });
      window.dispatchEvent(new Event('online'));
    });

    expect(result.current.hasRecentlyChanged).toBe(true);

    act(() => {
      vi.advanceTimersByTime(3100);
    });

    expect(result.current.hasRecentlyChanged).toBe(false);
  });

  it('handles rapid online/offline/online transitions', () => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useOnlineStatus());

    // Go online
    act(() => {
      Object.defineProperty(navigator, 'onLine', {
        value: true,
        writable: true,
        configurable: true,
      });
      window.dispatchEvent(new Event('online'));
    });

    expect(result.current.hasRecentlyChanged).toBe(true);

    // Go offline
    act(() => {
      Object.defineProperty(navigator, 'onLine', {
        value: false,
        writable: true,
        configurable: true,
      });
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current.hasRecentlyChanged).toBe(false);

    // Go online again — should restart the "recently changed" timer
    act(() => {
      Object.defineProperty(navigator, 'onLine', {
        value: true,
        writable: true,
        configurable: true,
      });
      window.dispatchEvent(new Event('online'));
    });

    expect(result.current.hasRecentlyChanged).toBe(true);
  });
});
