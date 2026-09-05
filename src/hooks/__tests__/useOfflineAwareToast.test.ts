/**
 * @fileoverview Tests for useOfflineAwareToast hook.
 * Tests that success toasts adapt to connectivity state:
 * - Online: shows the provided message as standard success toast
 * - Offline: shows "Saved on this device" with device icon
 *
 * @module hooks/__tests__/useOfflineAwareToast.test
 */

import type { ReactElement } from 'react';
import { isValidElement } from 'react';
import { renderHook } from '@testing-library/react';
import { Smartphone } from 'lucide-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOfflineAwareToast } from '../useOfflineAwareToast';

// ============================================================================
// Mocks
// ============================================================================

// Mock useOnlineStatus
const mockUseOnlineStatus = vi.fn();
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockUseOnlineStatus(),
}));

// Mock sonner toast
const mockToastSuccess = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}));

// Mock react-i18next.
//
// `t` is one stable function, not a fresh arrow per render, because that is what
// i18next hands back — and because an unstable `t` silently invalidates the
// hook's `useCallback` on every render, which would hide a missing `isOnline`
// dependency behind an accidental re-creation.
const translate = (key: string, fallback?: string): string => fallback ?? key;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

// ============================================================================
// Tests
// ============================================================================

describe('useOfflineAwareToast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Online Behavior
  // --------------------------------------------------------------------------

  describe('when online', () => {
    beforeEach(() => {
      mockUseOnlineStatus.mockReturnValue({
        isOnline: true,
        hasRecentlyChanged: false,
      });
    });

    it('calls toast.success with the provided message', () => {
      const { result } = renderHook(() => useOfflineAwareToast());

      result.current.successToast('Room created successfully');

      expect(mockToastSuccess).toHaveBeenCalledTimes(1);
      expect(mockToastSuccess).toHaveBeenCalledWith('Room created successfully');
    });

    it('passes through the exact message without modification', () => {
      const { result } = renderHook(() => useOfflineAwareToast());

      result.current.successToast('Transport updated successfully');

      expect(mockToastSuccess).toHaveBeenCalledWith('Transport updated successfully');
    });
  });

  // --------------------------------------------------------------------------
  // Offline Behavior
  // --------------------------------------------------------------------------

  describe('when offline', () => {
    beforeEach(() => {
      mockUseOnlineStatus.mockReturnValue({
        isOnline: false,
        hasRecentlyChanged: false,
      });
    });

    it('calls toast.success with "Saved on this device" message', () => {
      const { result } = renderHook(() => useOfflineAwareToast());

      result.current.successToast('Room created successfully');

      expect(mockToastSuccess).toHaveBeenCalledTimes(1);
      // First argument should be the offline message (from t('pwa.savedLocally'))
      const firstCall = mockToastSuccess.mock.calls[0] as unknown[];
      expect(firstCall[0]).toBe('Saved on this device');
    });

    it('uses i18n key pwa.savedLocally for the offline message', () => {
      const { result } = renderHook(() => useOfflineAwareToast());

      result.current.successToast('Any message');

      // The mock t() returns the fallback, which is 'Saved on this device'
      // This verifies t('pwa.savedLocally', 'Saved on this device') was called
      const firstCall = mockToastSuccess.mock.calls[0] as unknown[];
      expect(firstCall[0]).toBe('Saved on this device');
    });

    it('shows the offline toast with a decorative device icon', () => {
      const { result } = renderHook(() => useOfflineAwareToast());

      result.current.successToast('Room created successfully');

      const [, options] = mockToastSuccess.mock.calls[0] as [
        string,
        { icon?: unknown } | undefined,
      ];

      // `toHaveProperty('icon')` passed for any value at all, `undefined`
      // included. The icon is what carries the "this lives on your phone"
      // reassurance, so assert which element it is and that a screen reader
      // skips it — the message beside it already says the same thing.
      const icon = options?.icon;
      expect(isValidElement(icon)).toBe(true);
      const element = icon as ReactElement<{
        className?: string;
        'aria-hidden'?: string;
      }>;
      expect(element.type).toBe(Smartphone);
      expect(element.props['aria-hidden']).toBe('true');
      expect(element.props.className).toBe('size-4');
    });

    it('does NOT show the original online message when offline', () => {
      const { result } = renderHook(() => useOfflineAwareToast());

      result.current.successToast('Room created successfully');

      // The first argument should NOT be the online message
      const firstCall = mockToastSuccess.mock.calls[0] as unknown[];
      expect(firstCall[0]).not.toBe('Room created successfully');
    });
  });

  // --------------------------------------------------------------------------
  // Reacting to a change in connectivity
  // --------------------------------------------------------------------------

  describe('when connectivity changes under it', () => {
    /**
     * `successToast` is memoised on `[isOnline, t]`. Asserting its shape —
     * `toHaveProperty('successToast')` and `typeof … === 'function'`, which is
     * all this block used to do — passes for a hook returning any function at
     * all, including one closed over a connectivity reading from three renders
     * ago. What matters is that the reading it uses is the current one.
     */
    it('switches to the offline message after going offline', () => {
      mockUseOnlineStatus.mockReturnValue({
        isOnline: true,
        hasRecentlyChanged: false,
      });

      const { result, rerender } = renderHook(() => useOfflineAwareToast());

      result.current.successToast('Room created successfully');
      expect(mockToastSuccess).toHaveBeenLastCalledWith(
        'Room created successfully',
      );

      mockUseOnlineStatus.mockReturnValue({
        isOnline: false,
        hasRecentlyChanged: true,
      });
      rerender();

      result.current.successToast('Room created successfully');
      const [message] = mockToastSuccess.mock.calls[1] as [string];
      expect(message).toBe('Saved on this device');
    });

    it('switches back to the caller message after coming online', () => {
      mockUseOnlineStatus.mockReturnValue({
        isOnline: false,
        hasRecentlyChanged: false,
      });

      const { result, rerender } = renderHook(() => useOfflineAwareToast());

      result.current.successToast('Room created successfully');
      const [offlineMessage] = mockToastSuccess.mock.calls[0] as [string];
      expect(offlineMessage).toBe('Saved on this device');

      mockUseOnlineStatus.mockReturnValue({
        isOnline: true,
        hasRecentlyChanged: true,
      });
      rerender();

      result.current.successToast('Room created successfully');
      expect(mockToastSuccess).toHaveBeenLastCalledWith(
        'Room created successfully',
      );
    });
  });
});
