/**
 * @fileoverview Tests for useToday hook.
 *
 * @module hooks/__tests__/useToday.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { isSameDay } from 'date-fns';

import { useToday, getMsUntilMidnight } from '../useToday';

describe('useToday', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial value', () => {
    it('returns today as start of day', () => {
      const now = new Date('2026-02-03T15:30:00');
      vi.setSystemTime(now);

      const { result } = renderHook(() => useToday());

      expect(isSameDay(result.current.today, now)).toBe(true);
      expect(result.current.today.getHours()).toBe(0);
      expect(result.current.today.getMinutes()).toBe(0);
      expect(result.current.today.getSeconds()).toBe(0);
    });

    it('returns current date at mount time', () => {
      const mountDate = new Date('2026-06-15T10:00:00');
      vi.setSystemTime(mountDate);

      const { result } = renderHook(() => useToday());

      expect(result.current.today.getFullYear()).toBe(2026);
      expect(result.current.today.getMonth()).toBe(5); // June (0-indexed)
      expect(result.current.today.getDate()).toBe(15);
    });
  });

  describe('midnight update', () => {
    it('updates when day changes after interval check', async () => {
      // Start at 11:59 PM
      const almostMidnight = new Date('2026-02-03T23:59:00');
      vi.setSystemTime(almostMidnight);

      const { result } = renderHook(() => useToday());

      // Initial value should be Feb 3
      expect(result.current.today.getDate()).toBe(3);

      // Advance time past midnight
      vi.setSystemTime(new Date('2026-02-04T00:01:00'));

      // Advance timers by 1 minute (the check interval)
      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });

      // Should now be Feb 4
      expect(result.current.today.getDate()).toBe(4);
    });

    it('does not update if still same day', async () => {
      const morning = new Date('2026-02-03T08:00:00');
      vi.setSystemTime(morning);

      const { result } = renderHook(() => useToday());
      const initialToday = result.current.today;

      // Advance time but stay on same day
      vi.setSystemTime(new Date('2026-02-03T20:00:00'));

      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });

      // Should be same reference (no re-render)
      expect(result.current.today).toBe(initialToday);
    });
  });

  describe('visibility change', () => {
    it('checks for day change when page becomes visible', async () => {
      const yesterday = new Date('2026-02-03T14:00:00');
      vi.setSystemTime(yesterday);

      const { result } = renderHook(() => useToday());
      expect(result.current.today.getDate()).toBe(3);

      // Simulate user leaving tab and coming back next day
      vi.setSystemTime(new Date('2026-02-04T10:00:00'));

      await act(async () => {
        // Simulate visibility change
        Object.defineProperty(document, 'visibilityState', {
          value: 'visible',
          writable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });

      expect(result.current.today.getDate()).toBe(4);
    });
  });

  describe('focus event', () => {
    it('checks for day change when window receives focus', async () => {
      const yesterday = new Date('2026-02-03T14:00:00');
      vi.setSystemTime(yesterday);

      const { result } = renderHook(() => useToday());
      expect(result.current.today.getDate()).toBe(3);

      // Simulate system sleep and wake on new day
      vi.setSystemTime(new Date('2026-02-04T09:00:00'));

      await act(async () => {
        window.dispatchEvent(new Event('focus'));
      });

      expect(result.current.today.getDate()).toBe(4);
    });
  });

  describe('cleanup', () => {
    it('clears interval on unmount', () => {
      const clearIntervalSpy = vi.spyOn(window, 'clearInterval');

      const { unmount } = renderHook(() => useToday());
      unmount();

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });

    it('removes event listeners on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
      const windowRemoveEventListenerSpy = vi.spyOn(
        window,
        'removeEventListener',
      );

      const { unmount } = renderHook(() => useToday());
      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'visibilitychange',
        expect.any(Function),
      );
      expect(windowRemoveEventListenerSpy).toHaveBeenCalledWith(
        'focus',
        expect.any(Function),
      );

      removeEventListenerSpy.mockRestore();
      windowRemoveEventListenerSpy.mockRestore();
    });
  });
});

describe('getMsUntilMidnight', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns correct milliseconds until midnight', () => {
    // Set time to 11:00 PM (1 hour before midnight)
    vi.setSystemTime(new Date('2026-02-03T23:00:00'));

    const ms = getMsUntilMidnight();

    // Should be 1 hour = 3600000 ms
    expect(ms).toBe(60 * 60 * 1000);
  });

  it('returns small value close to midnight', () => {
    // Set time to 11:59:30 PM (30 seconds before midnight)
    vi.setSystemTime(new Date('2026-02-03T23:59:30'));

    const ms = getMsUntilMidnight();

    // Should be 30 seconds = 30000 ms
    expect(ms).toBe(30 * 1000);
  });

  it('returns full day at start of day', () => {
    // Set time to midnight
    vi.setSystemTime(new Date('2026-02-03T00:00:00'));

    const ms = getMsUntilMidnight();

    // Should be 24 hours = 86400000 ms
    expect(ms).toBe(24 * 60 * 60 * 1000);
  });

  it('handles mid-day correctly', () => {
    // Set time to noon
    vi.setSystemTime(new Date('2026-02-03T12:00:00'));

    const ms = getMsUntilMidnight();

    // Should be 12 hours = 43200000 ms
    expect(ms).toBe(12 * 60 * 60 * 1000);
  });
});
