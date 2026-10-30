/**
 * @fileoverview Tests for OfflineIndicator component.
 * Tests rendering states, ARIA accessibility, motion-safe compliance,
 * and visual styling for offline/online transitions.
 *
 * @module components/pwa/__tests__/OfflineIndicator.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

import { CheckCircle2, WifiOff } from 'lucide-react';

import { OfflineIndicator } from '@/components/pwa/OfflineIndicator';
import { statusVariants } from '@/components/ui/status.variants';

// ============================================================================
// Mocks
// ============================================================================

// Mock useOnlineStatus hook
const mockUseOnlineStatus = vi.fn();
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockUseOnlineStatus(),
}));

// Mock react-i18next
const { translate } = vi.hoisted(() => ({
  translate: vi.fn((key: string, fallback?: string) => fallback ?? key),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
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
  // Iconography
  // --------------------------------------------------------------------------

  describe('iconography', () => {
    /** The paths a lucide icon draws, so a rendered glyph can be identified. */
    function shapeOf(Icon: typeof WifiOff): string {
      const { container, unmount } = render(<Icon />);
      const markup = container.querySelector('svg')?.innerHTML ?? '';
      unmount();
      return markup;
    }

    it('draws a struck-through wifi glyph while offline', () => {
      mockUseOnlineStatus.mockReturnValue({
        isOnline: false,
        hasRecentlyChanged: false,
      });

      render(<OfflineIndicator />);

      act(() => {
        vi.advanceTimersByTime(1);
      });

      // The tests above only asked that *an* svg was there with the right
      // animation class, which a tick, a cross or a blank box would satisfy.
      expect(screen.getByRole('status').querySelector('svg')?.innerHTML).toBe(
        shapeOf(WifiOff),
      );
    });

    it('draws a tick, not a wifi glyph, once the connection is back', () => {
      mockUseOnlineStatus.mockReturnValue({
        isOnline: true,
        hasRecentlyChanged: true,
      });

      render(<OfflineIndicator />);

      act(() => {
        vi.advanceTimersByTime(1);
      });

      // "Connection restored" beside a struck-through wifi icon says two
      // opposite things at once.
      const drawn = screen.getByRole('status').querySelector('svg')?.innerHTML;
      expect(drawn).toBe(shapeOf(CheckCircle2));
      expect(drawn).not.toBe(shapeOf(WifiOff));
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

    it('uses the warning tone for offline state', () => {
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

      // The brief's amber, named rather than spelled: offline is a warning, not
      // an error. Asserting the token survives a re-theme; `amber-50` did not.
      expect(innerBanner?.className).toContain('bg-warning-surface');
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

    /**
     * The wrapper is `inset-x-0` and `z-50` but only paints a centred pill, so
     * it used to intercept clicks along a full-width strip of the page. Offline,
     * that strip covers the trip list's "New trip" button, which could not be
     * clicked at all while the banner was up.
     */
    it('does not intercept pointer events across its full-bleed wrapper', () => {
      mockUseOnlineStatus.mockReturnValue({
        isOnline: false,
        hasRecentlyChanged: false,
      });

      render(<OfflineIndicator />);

      const statusRegion = screen.getByRole('status');
      expect(statusRegion.className).toContain('pointer-events-none');
    });
  });
});

// ============================================================================
// Visibility over time
// ============================================================================

describe('OfflineIndicator over time', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function status(isOnline: boolean, hasRecentlyChanged: boolean): void {
    mockUseOnlineStatus.mockReturnValue({ isOnline, hasRecentlyChanged });
  }

  it('is in place from the first frame when the page opens offline', () => {
    status(false, false);

    render(<OfflineIndicator />);

    expect(screen.getByRole('status')).toHaveClass('translate-y-0', 'opacity-100');
  });

  it('is in place from the first frame while saying the connection is back', () => {
    status(true, true);

    render(<OfflineIndicator />);

    expect(screen.getByRole('status')).toHaveClass('translate-y-0', 'opacity-100');
  });

  it('slides in from above when the connection drops', () => {
    status(true, false);
    const { rerender } = render(<OfflineIndicator className="a" />);

    status(false, false);
    rerender(<OfflineIndicator className="b" />);
    expect(screen.getByRole('status')).toHaveClass('-translate-y-full', 'opacity-0');

    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByRole('status')).toHaveClass('translate-y-0', 'opacity-100');
  });

  it('goes away once the "back online" note has had its moment', () => {
    status(true, true);
    const { rerender } = render(<OfflineIndicator className="a" />);

    status(true, false);
    rerender(<OfflineIndicator className="b" />);
    expect(screen.getByRole('status')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('draws the pill and its words', () => {
    status(false, false);
    render(<OfflineIndicator />);

    const pill = screen.getByRole('status').firstElementChild as HTMLElement;
    expect(pill).toHaveClass(
      'flex', 'items-center', 'gap-2', 'rounded-lg', 'px-4', 'py-2', 'text-sm', 'font-medium', 'shadow-lg',
      'motion-safe:transition-colors', 'motion-safe:duration-300',
    );
    expect(pill.querySelector('svg')).toHaveClass('size-4', 'shrink-0', 'motion-safe:animate-pulse');
    expect(screen.getByText('You are offline')).toBeInTheDocument();
    expect(screen.getByText('Your changes are saved locally and the app works normally').parentElement).toHaveClass('flex', 'flex-col');
    expect(translate).toHaveBeenCalledWith('pwa.offline', 'You are offline');
    expect(translate).toHaveBeenCalledWith('pwa.offlineDescription', expect.any(String));
  });

  it('draws "back online" in the success tone', () => {
    status(true, true);
    render(<OfflineIndicator />);

    const pill = screen.getByRole('status').firstElementChild as HTMLElement;
    for (const cls of statusVariants({ tone: 'success' }).split(/\s+/).filter(Boolean)) {
      expect(pill).toHaveClass(cls);
    }
    expect(pill.querySelector('svg')).toHaveClass('size-4', 'shrink-0');
    expect(screen.getByText('Connection restored')).toBeInTheDocument();
    expect(translate).toHaveBeenCalledWith('pwa.connectionRestored', 'Connection restored');
  });

  it('acts only on the latest status when it changes twice within a tick', () => {
    status(true, true);
    const { rerender } = render(<OfflineIndicator className="a" />);

    status(true, false);
    rerender(<OfflineIndicator className="b" />);
    status(true, true);
    rerender(<OfflineIndicator className="c" />);

    // The superseded updates are dropped: no timer, fired one at a time, ever
    // takes the note out of view.
    for (let i = 0; i < 3; i += 1) {
      act(() => {
        vi.advanceTimersToNextTimer();
      });
      expect(screen.getByRole('status')).toHaveClass('translate-y-0', 'opacity-100');
    }
  });
});

