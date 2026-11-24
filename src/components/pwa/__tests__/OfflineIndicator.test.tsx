/**
 * @fileoverview Tests for the offline indicator, an icon in the header.
 *
 * It replaced a two-line amber pill that floated over the top of every page
 * while offline. What it must keep: offline reads as expected (warning tone,
 * never destructive), the full sentence stays available to screen readers and
 * as a tooltip, coming back online gets a brief tick, and it draws nothing the
 * rest of the time.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { OfflineIndicator } from '@/components/pwa/OfflineIndicator';
import { statusVariants } from '@/components/ui/status.variants';

// ============================================================================
// Mocks
// ============================================================================

const mockUseOnlineStatus = vi.fn();
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockUseOnlineStatus(),
}));

const { translate } = vi.hoisted(() => ({
  translate: vi.fn((key: string, fallback?: string) => fallback ?? key),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

const OFFLINE_SENTENCE =
  'You are offline. Your changes are saved locally and the app works normally';

// ============================================================================
// Tests
// ============================================================================

describe('OfflineIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('draws nothing while online', () => {
    mockUseOnlineStatus.mockReturnValue({ isOnline: true, hasRecentlyChanged: false });
    const { container } = render(<OfflineIndicator />);

    expect(container).toBeEmptyDOMElement();
  });

  it('is one icon while offline, its sentence for screen readers and as a tooltip', () => {
    mockUseOnlineStatus.mockReturnValue({ isOnline: false, hasRecentlyChanged: false });
    render(<OfflineIndicator />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('title', OFFLINE_SENTENCE);
    expect(status).toHaveTextContent(OFFLINE_SENTENCE);
    // The sentence is for assistive technology only: the icon is what shows.
    expect(screen.getByText(OFFLINE_SENTENCE)).toHaveClass('sr-only');
    expect(status.querySelector('svg.lucide-wifi-off')).not.toBeNull();
    expect(translate).toHaveBeenCalledWith('pwa.offline', 'You are offline');
    expect(translate).toHaveBeenCalledWith('pwa.offlineDescription', expect.any(String));
  });

  it('reads as expected rather than as an error: warning tone, never destructive', () => {
    mockUseOnlineStatus.mockReturnValue({ isOnline: false, hasRecentlyChanged: false });
    render(<OfflineIndicator />);

    const status = screen.getByRole('status');
    for (const className of statusVariants({ tone: 'warning' }).split(' ').filter(Boolean)) {
      expect(status).toHaveClass(className);
    }
    expect(status.className).not.toMatch(/destructive/);
  });

  it('pulses only for a viewer who allows motion', () => {
    mockUseOnlineStatus.mockReturnValue({ isOnline: false, hasRecentlyChanged: false });
    render(<OfflineIndicator />);

    const icon = screen.getByRole('status').querySelector('svg');
    expect(icon).toHaveClass('motion-safe:animate-pulse');
    expect(icon?.getAttribute('class')).not.toMatch(/(^|\s)animate-pulse/);
  });

  it('shows a tick in the success tone for a moment once the connection is back', () => {
    mockUseOnlineStatus.mockReturnValue({ isOnline: true, hasRecentlyChanged: true });
    render(<OfflineIndicator />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('title', 'Connection restored');
    expect(status.querySelector('svg.lucide-circle-check-big, svg.lucide-check-circle-2, svg.lucide-circle-check')).not.toBeNull();
    expect(status.querySelector('svg.lucide-wifi-off')).toBeNull();
    for (const className of statusVariants({ tone: 'success' }).split(' ').filter(Boolean)) {
      expect(status).toHaveClass(className);
    }
  });

  it('announces each change politely, as a whole', () => {
    mockUseOnlineStatus.mockReturnValue({ isOnline: false, hasRecentlyChanged: false });
    render(<OfflineIndicator />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
  });
});
