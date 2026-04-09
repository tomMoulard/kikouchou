/**
 * useOnlineStatus Hook Tests
 *
 * @module hooks/__tests__/useOnlineStatus.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

    const { unmount } = renderHook(() => useOnlineStatus());

    // Unmount immediately — no timer should be running
    unmount();
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
