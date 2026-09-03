/**
 * @fileoverview Tests for MapOfflineIndicator component.
 * @module components/shared/__tests__/MapOfflineIndicator.test
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MapOfflineIndicator } from '../MapOfflineIndicator';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

const mockUseOnlineStatus = vi.fn();
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockUseOnlineStatus(),
}));

// ============================================================================
// Tests
// ============================================================================

describe('MapOfflineIndicator', () => {
  beforeEach(() => {
    mockUseOnlineStatus.mockReturnValue({
      isOnline: true,
      hasRecentlyChanged: false,
    });
  });

  it.each([undefined, false])(
    'renders nothing when online, with showCachedMode=%s',
    (showCachedMode) => {
      // One test, two inputs. There used to be two identically-asserting tests
      // here under different names; naming the input is what makes the pair
      // mean something.
      const { container } = render(
        <MapOfflineIndicator showCachedMode={showCachedMode} />,
      );
      expect(container.firstChild).toBeNull();
    },
  );

  it('renders offline indicator when not online', () => {
    mockUseOnlineStatus.mockReturnValue({
      isOnline: false,
      hasRecentlyChanged: false,
    });

    render(<MapOfflineIndicator />);
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  it('has correct role and aria-live attributes', () => {
    mockUseOnlineStatus.mockReturnValue({
      isOnline: false,
      hasRecentlyChanged: false,
    });

    render(<MapOfflineIndicator />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('shows "back online" when hasRecentlyChanged is true and online', () => {
    mockUseOnlineStatus.mockReturnValue({
      isOnline: true,
      hasRecentlyChanged: true,
    });

    render(<MapOfflineIndicator />);
    expect(screen.getByText('Back online')).toBeInTheDocument();
  });

  it('shows cached tiles text when showCachedMode is true and online', () => {
    mockUseOnlineStatus.mockReturnValue({
      isOnline: true,
      hasRecentlyChanged: false,
    });

    render(<MapOfflineIndicator showCachedMode />);
    expect(screen.getByText('Using cached tiles')).toBeInTheDocument();
  });

  it('prioritizes offline over recently changed', () => {
    mockUseOnlineStatus.mockReturnValue({
      isOnline: false,
      hasRecentlyChanged: true,
    });

    render(<MapOfflineIndicator />);
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.queryByText('Back online')).not.toBeInTheDocument();
  });

  it('applies default bottom-left position', () => {
    mockUseOnlineStatus.mockReturnValue({
      isOnline: false,
      hasRecentlyChanged: false,
    });

    render(<MapOfflineIndicator />);
    const el = screen.getByRole('status');
    expect(el.className).toContain('bottom-2');
    expect(el.className).toContain('left-2');
  });

  it('applies custom position', () => {
    mockUseOnlineStatus.mockReturnValue({
      isOnline: false,
      hasRecentlyChanged: false,
    });

    render(<MapOfflineIndicator position="top-right" />);
    const el = screen.getByRole('status');
    expect(el.className).toContain('top-2');
    expect(el.className).toContain('right-2');
  });

  it('applies additional className', () => {
    mockUseOnlineStatus.mockReturnValue({
      isOnline: false,
      hasRecentlyChanged: false,
    });

    render(<MapOfflineIndicator className="my-custom-class" />);
    const el = screen.getByRole('status');
    expect(el.className).toContain('my-custom-class');
  });
});
