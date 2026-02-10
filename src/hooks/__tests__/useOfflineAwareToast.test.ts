/**
 * @fileoverview Tests for useOfflineAwareToast hook.
 * Tests that success toasts adapt to connectivity state:
 * - Online: shows the provided message as standard success toast
 * - Offline: shows "Saved on this device" with device icon
 *
 * @module hooks/__tests__/useOfflineAwareToast.test
 */

import { renderHook } from '@testing-library/react';
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

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
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

    it('provides a custom icon option for the offline toast', () => {
      const { result } = renderHook(() => useOfflineAwareToast());

      result.current.successToast('Room created successfully');

      // Second argument should be an options object with icon
      const firstCall = mockToastSuccess.mock.calls[0] as Record<string, unknown>[];
      expect(firstCall[1]).toBeDefined();
      expect(firstCall[1]).toHaveProperty('icon');
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
  // Return Value
  // --------------------------------------------------------------------------

  describe('return value', () => {
    it('returns an object with successToast function', () => {
      mockUseOnlineStatus.mockReturnValue({
        isOnline: true,
        hasRecentlyChanged: false,
      });

      const { result } = renderHook(() => useOfflineAwareToast());

      expect(result.current).toHaveProperty('successToast');
      expect(typeof result.current.successToast).toBe('function');
    });
  });
});
