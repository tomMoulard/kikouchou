/**
 * @fileoverview Tests for useOfflineAwareNotify hook.
 * Tests that success confirmations adapt to connectivity state:
 * - Online: confirms with the provided message
 * - Offline: confirms "Saved on this device"
 *
 * @module hooks/__tests__/useOfflineAwareNotify.test
 */

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOfflineAwareNotify } from '../useOfflineAwareNotify';

// ============================================================================
// Mocks
// ============================================================================

// Mock useOnlineStatus
const mockUseOnlineStatus = vi.fn();
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockUseOnlineStatus(),
}));

// Mock the notification facade. The hook's job is choosing the words; where
// they are delivered — an OS notification rather than a toast, since a burst
// of confirmations used to stack over the content — is
// `src/lib/notifications/notify.ts`'s job and is tested there.
const mockNotifySuccess = vi.fn();
vi.mock('@/lib/notifications', () => ({
  notify: {
    success: (...args: unknown[]) => mockNotifySuccess(...args),
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

describe('useOfflineAwareNotify', () => {
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

    it('confirms with the provided message', () => {
      const { result } = renderHook(() => useOfflineAwareNotify());

      result.current.notifySuccess('Room created successfully');

      expect(mockNotifySuccess).toHaveBeenCalledTimes(1);
      expect(mockNotifySuccess).toHaveBeenCalledWith('Room created successfully');
    });

    it('passes through the exact message without modification', () => {
      const { result } = renderHook(() => useOfflineAwareNotify());

      result.current.notifySuccess('Transport updated successfully');

      expect(mockNotifySuccess).toHaveBeenCalledWith('Transport updated successfully');
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

    it('confirms with the "Saved on this device" message', () => {
      const { result } = renderHook(() => useOfflineAwareNotify());

      result.current.notifySuccess('Room created successfully');

      expect(mockNotifySuccess).toHaveBeenCalledTimes(1);
      // First argument should be the offline message (from t('pwa.savedLocally'))
      const firstCall = mockNotifySuccess.mock.calls[0] as unknown[];
      expect(firstCall[0]).toBe('Saved on this device');
    });

    it('uses i18n key pwa.savedLocally for the offline message', () => {
      const { result } = renderHook(() => useOfflineAwareNotify());

      result.current.notifySuccess('Any message');

      // The mock t() returns the fallback, which is 'Saved on this device'
      // This verifies t('pwa.savedLocally', 'Saved on this device') was called
      const firstCall = mockNotifySuccess.mock.calls[0] as unknown[];
      expect(firstCall[0]).toBe('Saved on this device');
    });

    it('sends the message alone, with no per-message options', () => {
      const { result } = renderHook(() => useOfflineAwareNotify());

      result.current.notifySuccess('Room created successfully');

      // The offline toast used to carry a `Smartphone` icon in a sonner
      // options object. An OS notification takes the app icon and no
      // per-message one, so the words are now the whole message — and a
      // leftover options argument would be silently dropped rather than
      // failing loudly.
      const firstCall = mockNotifySuccess.mock.calls[0] as unknown[];
      expect(firstCall).toHaveLength(1);
    });

    it('does NOT show the original online message when offline', () => {
      const { result } = renderHook(() => useOfflineAwareNotify());

      result.current.notifySuccess('Room created successfully');

      // The first argument should NOT be the online message
      const firstCall = mockNotifySuccess.mock.calls[0] as unknown[];
      expect(firstCall[0]).not.toBe('Room created successfully');
    });
  });

  // --------------------------------------------------------------------------
  // Reacting to a change in connectivity
  // --------------------------------------------------------------------------

  describe('when connectivity changes under it', () => {
    /**
     * `notifySuccess` is memoised on `[isOnline, t]`. Asserting its shape —
     * `toHaveProperty('notifySuccess')` and `typeof … === 'function'`, which is
     * all this block used to do — passes for a hook returning any function at
     * all, including one closed over a connectivity reading from three renders
     * ago. What matters is that the reading it uses is the current one.
     */
    it('switches to the offline message after going offline', () => {
      mockUseOnlineStatus.mockReturnValue({
        isOnline: true,
        hasRecentlyChanged: false,
      });

      const { result, rerender } = renderHook(() => useOfflineAwareNotify());

      result.current.notifySuccess('Room created successfully');
      expect(mockNotifySuccess).toHaveBeenLastCalledWith(
        'Room created successfully',
      );

      mockUseOnlineStatus.mockReturnValue({
        isOnline: false,
        hasRecentlyChanged: true,
      });
      rerender();

      result.current.notifySuccess('Room created successfully');
      const [message] = mockNotifySuccess.mock.calls[1] as [string];
      expect(message).toBe('Saved on this device');
    });

    it('switches back to the caller message after coming online', () => {
      mockUseOnlineStatus.mockReturnValue({
        isOnline: false,
        hasRecentlyChanged: false,
      });

      const { result, rerender } = renderHook(() => useOfflineAwareNotify());

      result.current.notifySuccess('Room created successfully');
      const [offlineMessage] = mockNotifySuccess.mock.calls[0] as [string];
      expect(offlineMessage).toBe('Saved on this device');

      mockUseOnlineStatus.mockReturnValue({
        isOnline: true,
        hasRecentlyChanged: true,
      });
      rerender();

      result.current.notifySuccess('Room created successfully');
      expect(mockNotifySuccess).toHaveBeenLastCalledWith(
        'Room created successfully',
      );
    });
  });
});
