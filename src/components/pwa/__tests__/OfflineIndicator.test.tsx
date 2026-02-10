/**
 * @fileoverview Tests for OfflineIndicator component.
 * Tests rendering states, ARIA accessibility, motion-safe compliance,
 * and visual styling for offline/online transitions.
 *
 * @module components/pwa/__tests__/OfflineIndicator.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

import { OfflineIndicator } from '@/components/pwa/OfflineIndicator';

// ============================================================================
// Mocks
// ============================================================================

// Mock useOnlineStatus hook
const mockUseOnlineStatus = vi.fn();
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockUseOnlineStatus(),
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

describe('OfflineIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Rendering States
  // --------------------------------------------------------------------------

  describe('rendering states', () => {
    it('renders nothing when fully online (isOnline: true, hasRecentlyChanged: false)', () => {
      mockUseOnlineStatus.mockReturnValue({
        isOnline: true,
        hasRecentlyChanged: false,
      });

      const { container } = render(<OfflineIndicator />);
      // Should render null
      expect(container.firstChild).toBeNull();
    });

    it('renders offline indicator when isOnline is false', () => {
      mockUseOnlineStatus.mockReturnValue({
        isOnline: false,
        hasRecentlyChanged: false,
      });

      render(<OfflineIndicator />);

      // Run the setTimeout(0) to trigger visibility
      act(() => {
        vi.advanceTimersByTime(1);
      });

      expect(screen.getByText('You are offline')).toBeInTheDocument();
    });

    it('renders offline description text when offline', () => {
      mockUseOnlineStatus.mockReturnValue({
        isOnline: false,
        hasRecentlyChanged: false,
      });

      render(<OfflineIndicator />);

      act(() => {
        vi.advanceTimersByTime(1);
      });

      expect(
        screen.getByText('Your changes are saved locally and the app works normally'),
      ).toBeInTheDocument();
    });

    it('renders "back online" message when hasRecentlyChanged is true and isOnline is true', () => {
      mockUseOnlineStatus.mockReturnValue({
        isOnline: true,
        hasRecentlyChanged: true,
      });

      render(<OfflineIndicator />);

      act(() => {
        vi.advanceTimersByTime(1);
      });

      expect(screen.getByText('Connection restored')).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // ARIA Accessibility
  // --------------------------------------------------------------------------

  describe('accessibility', () => {
    it('uses ARIA live region with role="status"', () => {
      mockUseOnlineStatus.mockReturnValue({
        isOnline: false,
        hasRecentlyChanged: false,
      });

      render(<OfflineIndicator />);

      const statusRegion = screen.getByRole('status');
      expect(statusRegion).toBeInTheDocument();
    });

    it('has aria-live="polite"', () => {
      mockUseOnlineStatus.mockReturnValue({
        isOnline: false,
        hasRecentlyChanged: false,
      });

      render(<OfflineIndicator />);

      const statusRegion = screen.getByRole('status');
      expect(statusRegion).toHaveAttribute('aria-live', 'polite');
    });

    it('has aria-atomic="true"', () => {
      mockUseOnlineStatus.mockReturnValue({
        isOnline: false,
        hasRecentlyChanged: false,
      });

      render(<OfflineIndicator />);

      const statusRegion = screen.getByRole('status');
      expect(statusRegion).toHaveAttribute('aria-atomic', 'true');
    });
  });

  // --------------------------------------------------------------------------
  // Motion-safe Compliance (NFR12)
  // --------------------------------------------------------------------------

  describe('motion-safe compliance', () => {
    it('uses motion-safe: prefix on transition classes', () => {
      mockUseOnlineStatus.mockReturnValue({
        isOnline: false,
        hasRecentlyChanged: false,
      });

      render(<OfflineIndicator />);

      const statusRegion = screen.getByRole('status');
      const className = statusRegion.className;

      // Check that transition classes use motion-safe prefix
      expect(className).toContain('motion-safe:transition');
      expect(className).toContain('motion-safe:duration-300');
    });

    it('uses motion-safe: prefix on pulse animation for WifiOff icon', () => {
      mockUseOnlineStatus.mockReturnValue({
        isOnline: false,
        hasRecentlyChanged: false,
      });

      render(<OfflineIndicator />);

      act(() => {
        vi.advanceTimersByTime(1);
      });

      // The WifiOff icon should have motion-safe:animate-pulse
      const container = screen.getByRole('status');
      const svgs = container.querySelectorAll('svg');
      // Find the WifiOff icon (first svg in offline state)
      const wifiOffIcon = svgs[0];
      expect(wifiOffIcon).toBeDefined();
      expect(wifiOffIcon?.className.baseVal || wifiOffIcon?.getAttribute('class') || '').toContain('motion-safe:animate-pulse');
    });
  });

  // --------------------------------------------------------------------------
  // Visual Styling
  // --------------------------------------------------------------------------

  describe('visual styling', () => {
    it('does NOT use variant="destructive" or destructive red for offline state', () => {
      mockUseOnlineStatus.mockReturnValue({
        isOnline: false,
        hasRecentlyChanged: false,
      });

      render(<OfflineIndicator />);

      act(() => {
        vi.advanceTimersByTime(1);
      });

      const statusRegion = screen.getByRole('status');
      const html = statusRegion.innerHTML;

      // Should NOT contain destructive variant
      expect(html).not.toContain('destructive');
    });

    it('uses warm amber styling for offline state', () => {
      mockUseOnlineStatus.mockReturnValue({
        isOnline: false,
        hasRecentlyChanged: false,
      });

      render(<OfflineIndicator />);

      act(() => {
        vi.advanceTimersByTime(1);
      });

      const statusRegion = screen.getByRole('status');
      const innerBanner = statusRegion.querySelector('div > div');

      expect(innerBanner?.className).toContain('amber');
    });

    it('positions below the header at top-14', () => {
      mockUseOnlineStatus.mockReturnValue({
        isOnline: false,
        hasRecentlyChanged: false,
      });

      render(<OfflineIndicator />);

      const statusRegion = screen.getByRole('status');
      expect(statusRegion.className).toContain('top-14');
    });
  });
});
