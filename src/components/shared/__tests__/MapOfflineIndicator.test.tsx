/**
 * @fileoverview Tests for MapOfflineIndicator component.
 * @module components/shared/__tests__/MapOfflineIndicator.test
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MapOfflineIndicator } from '../MapOfflineIndicator';
import { statusVariants } from '@/components/ui/status.variants';

// ============================================================================
// Mocks
// ============================================================================

const { translate } = vi.hoisted(() => ({
  translate: vi.fn((key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key)),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
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

// ============================================================================
// Each state's look
// ============================================================================

describe('MapOfflineIndicator looks', () => {
  function status(isOnline: boolean, hasRecentlyChanged: boolean): void {
    mockUseOnlineStatus.mockReturnValue({ isOnline, hasRecentlyChanged });
  }

  function toneClasses(tone: 'warning' | 'success' | 'neutral'): string[] {
    return statusVariants({ tone }).split(/\s+/).filter(Boolean);
  }

  function badge(): HTMLElement {
    return screen.getByRole('status').firstElementChild as HTMLElement;
  }

  it('shows offline in the warning tone, fully in view', () => {
    status(false, false);
    render(<MapOfflineIndicator />);

    expect(screen.getByRole('status')).toHaveClass('absolute', 'z-[1000]', 'pointer-events-none');
    expect(badge()).toHaveClass(
      'flex', 'items-center', 'gap-1.5', 'px-2', 'py-1', 'rounded-md', 'text-xs', 'font-medium',
      'transition-all', 'duration-300', 'ease-in-out', 'opacity-100', 'translate-y-0', ...toneClasses('warning'),
    );
    expect(badge().querySelector('svg')).toHaveClass('size-3.5');
    expect(translate).toHaveBeenCalledWith('pwa.offline', 'Offline');
  });

  it('shows "back online" in the success tone, fully in view', () => {
    status(true, true);
    render(<MapOfflineIndicator />);

    expect(screen.getByText('Back online')).toBeInTheDocument();
    expect(badge()).toHaveClass('opacity-100', 'translate-y-0', ...toneClasses('success'));
    expect(badge().querySelector('svg')).toHaveClass('size-3.5');
    expect(translate).toHaveBeenCalledWith('pwa.backOnline', 'Back online');
  });

  it('shows cached tiles in the neutral tone, faded back', () => {
    status(true, false);
    render(<MapOfflineIndicator showCachedMode />);

    expect(screen.getByText('Using cached tiles')).toBeInTheDocument();
    expect(badge()).toHaveClass('opacity-0', '-translate-y-2', ...toneClasses('neutral'));
    expect(badge()).not.toHaveClass('opacity-100');
    expect(badge().querySelector('svg')).toHaveClass('size-3.5');
    expect(translate).toHaveBeenCalledWith('map.cachedTiles', 'Using cached tiles');
  });

  it.each([
    ['top-left', ['top-2', 'left-2']],
    ['top-right', ['top-2', 'right-2']],
    ['bottom-left', ['bottom-2', 'left-2']],
    ['bottom-right', ['bottom-2', 'right-2']],
  ] as const)('sits in the %s corner', (position, classes) => {
    status(false, false);
    render(<MapOfflineIndicator position={position} />);

    expect(screen.getByRole('status')).toHaveClass(...classes);
  });

  it('follows the connection as it changes', () => {
    status(false, false);
    const { rerender } = render(<MapOfflineIndicator className="a" />);
    status(true, true);
    rerender(<MapOfflineIndicator className="b" />);

    expect(screen.getByText('Back online')).toBeInTheDocument();
    expect(badge()).toHaveClass('opacity-100', ...toneClasses('success'));

    status(true, false);
    rerender(<MapOfflineIndicator className="c" showCachedMode />);
    expect(badge()).toHaveClass('opacity-0');
  });
});
