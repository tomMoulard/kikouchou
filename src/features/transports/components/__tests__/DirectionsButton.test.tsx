/**
 * Component tests for DirectionsButton
 *
 * Tests rendering, click behavior, platform detection, and accessibility.
 *
 * @module features/transports/components/__tests__/DirectionsButton.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  DirectionsButton,
  getDirectionsUrl,
  getAlternativeDirectionsUrl,
  isIOS,
  isMobile,
  type DirectionsCoordinates,
} from '@/features/transports/components/DirectionsButton';

// ============================================================================
// Mocks
// ============================================================================

// Store original navigator
const originalNavigator = globalThis.navigator;

/**
 * Helper to mock navigator.userAgent
 */
function mockUserAgent(userAgent: string): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent },
    configurable: true,
  });
}

/**
 * Helper to restore navigator
 */
function restoreNavigator(): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: originalNavigator,
    configurable: true,
  });
}

// ============================================================================
// Test Data
// ============================================================================

const defaultCoordinates: DirectionsCoordinates = {
  lat: 48.8566,
  lon: 2.3522,
};

const defaultProps = {
  coordinates: defaultCoordinates,
  locationName: 'Paris Charles de Gaulle Airport',
};

// ============================================================================
// Basic Rendering Tests
// ============================================================================

describe('DirectionsButton Basic Rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a button', () => {
    render(<DirectionsButton {...defaultProps} />);

    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('renders with label by default', () => {
    render(<DirectionsButton {...defaultProps} />);

    expect(screen.getByText('map.getDirections')).toBeInTheDocument();
  });

  it('renders without label when showLabel is false', () => {
    render(<DirectionsButton {...defaultProps} showLabel={false} />);

    expect(screen.queryByText('map.getDirections')).not.toBeInTheDocument();
  });

  it('has aria-label when showLabel is false', () => {
    render(<DirectionsButton {...defaultProps} showLabel={false} />);

    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'map.getDirections');
  });

  it('has title when showLabel is false', () => {
    render(<DirectionsButton {...defaultProps} showLabel={false} />);

    expect(screen.getByRole('button')).toHaveAttribute('title', 'map.getDirections');
  });

  it('renders navigation icon', () => {
    render(<DirectionsButton {...defaultProps} />);

    // The Navigation icon from lucide-react should be present
    const button = screen.getByRole('button');
    const icon = button.querySelector('svg');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('applies custom className', () => {
    render(<DirectionsButton {...defaultProps} className="custom-class" />);

    expect(screen.getByRole('button')).toHaveClass('custom-class');
  });

  it('renders with different variants', () => {
    const { rerender } = render(<DirectionsButton {...defaultProps} variant="default" />);
    expect(screen.getByRole('button')).toBeInTheDocument();

    rerender(<DirectionsButton {...defaultProps} variant="outline" />);
    expect(screen.getByRole('button')).toBeInTheDocument();

    rerender(<DirectionsButton {...defaultProps} variant="secondary" />);
    expect(screen.getByRole('button')).toBeInTheDocument();

    rerender(<DirectionsButton {...defaultProps} variant="ghost" />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('renders with different sizes', () => {
    const { rerender } = render(<DirectionsButton {...defaultProps} size="default" />);
    expect(screen.getByRole('button')).toBeInTheDocument();

    rerender(<DirectionsButton {...defaultProps} size="sm" />);
    expect(screen.getByRole('button')).toBeInTheDocument();

    rerender(<DirectionsButton {...defaultProps} size="lg" />);
    expect(screen.getByRole('button')).toBeInTheDocument();

    rerender(<DirectionsButton {...defaultProps} size="icon" />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});

// ============================================================================
// Disabled State Tests
// ============================================================================

describe('DirectionsButton Disabled State', () => {
  it('is not disabled by default', () => {
    render(<DirectionsButton {...defaultProps} />);

    expect(screen.getByRole('button')).not.toBeDisabled();
  });

  it('is disabled when disabled prop is true', () => {
    render(<DirectionsButton {...defaultProps} disabled />);

    expect(screen.getByRole('button')).toBeDisabled();
  });
});

// ============================================================================
// Click Behavior Tests
// ============================================================================

describe('DirectionsButton Click Behavior', () => {
  let windowOpenSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    windowOpenSpy.mockRestore();
    restoreNavigator();
  });

  it('opens directions URL when clicked', async () => {
    const user = userEvent.setup();
    render(<DirectionsButton {...defaultProps} />);

    await user.click(screen.getByRole('button'));

    expect(windowOpenSpy).toHaveBeenCalledTimes(1);
    expect(windowOpenSpy).toHaveBeenCalledWith(
      expect.any(String),
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('does not open URL when disabled', async () => {
    const user = userEvent.setup();
    render(<DirectionsButton {...defaultProps} disabled />);

    await user.click(screen.getByRole('button'));

    expect(windowOpenSpy).not.toHaveBeenCalled();
  });

  it('opens Google Maps URL on desktop (non-iOS)', async () => {
    mockUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0');
    const user = userEvent.setup();
    render(<DirectionsButton coordinates={defaultCoordinates} />);

    await user.click(screen.getByRole('button'));

    expect(windowOpenSpy).toHaveBeenCalledWith(
      expect.stringContaining('google.com/maps'),
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('opens Apple Maps URL on iOS', async () => {
    mockUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    const user = userEvent.setup();
    render(<DirectionsButton coordinates={defaultCoordinates} />);

    await user.click(screen.getByRole('button'));

    expect(windowOpenSpy).toHaveBeenCalledWith(
      expect.stringContaining('maps://'),
      '_blank',
      'noopener,noreferrer'
    );
  });
});

// ============================================================================
// URL Generation Tests
// ============================================================================

describe('getDirectionsUrl', () => {
  afterEach(() => {
    restoreNavigator();
  });

  it('returns Google Maps URL for desktop', () => {
    mockUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');

    const url = getDirectionsUrl(48.8566, 2.3522);

    expect(url).toContain('google.com/maps');
    // URL params are encoded, so comma becomes %2C
    expect(url).toMatch(/destination=48\.8566(%2C|,)2\.3522/);
  });

  it('returns Apple Maps URL for iOS', () => {
    mockUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');

    const url = getDirectionsUrl(48.8566, 2.3522);

    expect(url).toContain('maps://');
    // URL params are encoded, so comma becomes %2C
    expect(url).toMatch(/daddr=48\.8566(%2C|,)2\.3522/);
  });

  it('returns Apple Maps URL for iPad', () => {
    mockUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)');

    const url = getDirectionsUrl(48.8566, 2.3522);

    expect(url).toContain('maps://');
  });

  it('returns Google Maps URL for Android', () => {
    mockUserAgent('Mozilla/5.0 (Linux; Android 14)');

    const url = getDirectionsUrl(48.8566, 2.3522);

    expect(url).toContain('google.com/maps');
  });

  it('includes location name in Apple Maps URL', () => {
    mockUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');

    const url = getDirectionsUrl(48.8566, 2.3522, 'Paris CDG');

    // URL params encode spaces as + and @ as %40
    expect(url).toMatch(/Paris(\+|%20)CDG/);
  });
});

describe('getAlternativeDirectionsUrl', () => {
  it('returns OpenStreetMap URL', () => {
    const url = getAlternativeDirectionsUrl(48.8566, 2.3522);

    expect(url).toContain('openstreetmap.org/directions');
    expect(url).toContain('to=48.8566,2.3522');
  });
});

// ============================================================================
// Platform Detection Tests
// ============================================================================

describe('isIOS', () => {
  afterEach(() => {
    restoreNavigator();
  });

  it('returns true for iPhone', () => {
    mockUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    expect(isIOS()).toBe(true);
  });

  it('returns true for iPad', () => {
    mockUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)');
    expect(isIOS()).toBe(true);
  });

  it('returns true for iPod', () => {
    mockUserAgent('Mozilla/5.0 (iPod touch; CPU iPhone OS 17_0 like Mac OS X)');
    expect(isIOS()).toBe(true);
  });

  it('returns false for Android', () => {
    mockUserAgent('Mozilla/5.0 (Linux; Android 14)');
    expect(isIOS()).toBe(false);
  });

  it('returns false for Windows', () => {
    mockUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    expect(isIOS()).toBe(false);
  });

  it('returns false for macOS (non-mobile)', () => {
    mockUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    expect(isIOS()).toBe(false);
  });
});

describe('isMobile', () => {
  afterEach(() => {
    restoreNavigator();
  });

  it('returns true for iPhone', () => {
    mockUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    expect(isMobile()).toBe(true);
  });

  it('returns true for Android', () => {
    mockUserAgent('Mozilla/5.0 (Linux; Android 14)');
    expect(isMobile()).toBe(true);
  });

  it('returns true for iPad', () => {
    mockUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)');
    expect(isMobile()).toBe(true);
  });

  it('returns true for BlackBerry', () => {
    mockUserAgent('Mozilla/5.0 (BlackBerry; U; BlackBerry 9900)');
    expect(isMobile()).toBe(true);
  });

  it('returns false for desktop Windows', () => {
    mockUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    expect(isMobile()).toBe(false);
  });

  it('returns false for desktop macOS', () => {
    mockUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    expect(isMobile()).toBe(false);
  });

  it('returns false for desktop Linux', () => {
    mockUserAgent('Mozilla/5.0 (X11; Linux x86_64)');
    expect(isMobile()).toBe(false);
  });
});

// ============================================================================
// Accessibility Tests
// ============================================================================

describe('DirectionsButton Accessibility', () => {
  it('has type="button"', () => {
    render(<DirectionsButton {...defaultProps} />);

    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('has accessible name via visible label', () => {
    render(<DirectionsButton {...defaultProps} />);

    expect(screen.getByRole('button', { name: /map\.getDirections/i })).toBeInTheDocument();
  });

  it('has accessible name via aria-label when showLabel is false', () => {
    render(<DirectionsButton {...defaultProps} showLabel={false} />);

    expect(screen.getByRole('button', { name: 'map.getDirections' })).toBeInTheDocument();
  });

  it('icon is hidden from screen readers', () => {
    render(<DirectionsButton {...defaultProps} />);

    const icon = screen.getByRole('button').querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});

// ============================================================================
// Memoization Tests
// ============================================================================

describe('DirectionsButton Memoization', () => {
  it('is memoized with React.memo', () => {
    // memo() returns a component with a $$typeof property
    // We can verify the component is wrapped by checking it exists and renders
    expect(DirectionsButton).toBeDefined();
    expect(typeof DirectionsButton).toBe('object'); // memo() returns an object, not a function
  });
});
