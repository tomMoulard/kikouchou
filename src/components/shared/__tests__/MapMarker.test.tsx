/**
 * Component tests for MapMarker
 *
 * Tests rendering of markers, custom icons, popups, and accessibility.
 * Note: These tests mock react-leaflet to avoid complex map initialization.
 *
 * @module components/shared/__tests__/MapMarker.test
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { MapMarker, type MapMarkerData } from '@/components/shared/MapMarker';

// ============================================================================
// Mocks
// ============================================================================

// Mock react-leaflet components
vi.mock('react-leaflet', () => ({
  Marker: ({
    children,
    position,
    eventHandlers,
    'aria-label': ariaLabel,
    title,
  }: {
    children?: React.ReactNode;
    position: [number, number];
    eventHandlers?: { click?: () => void; keydown?: () => void };
    'aria-label'?: string;
    title?: string;
  }) => (
    <div
      data-testid="mock-marker"
      data-position={JSON.stringify(position)}
      aria-label={ariaLabel}
      title={title}
      onClick={eventHandlers?.click}
      role="button"
    >
      {children}
    </div>
  ),
  Popup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-popup">{children}</div>
  ),
}));

// Mock leaflet
vi.mock('leaflet', () => ({
  divIcon: vi.fn(() => ({})),
}));

// ============================================================================
// Test Data
// ============================================================================

const createTestMarker = (overrides: Partial<MapMarkerData> = {}): MapMarkerData => ({
  id: 'test-marker-1',
  position: [48.8566, 2.3522],
  label: 'Paris',
  type: 'trip',
  ...overrides,
});

// ============================================================================
// Basic Rendering Tests
// ============================================================================

describe('MapMarker Basic Rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a marker', () => {
    const marker = createTestMarker();
    render(<MapMarker marker={marker} />);

    expect(screen.getByTestId('mock-marker')).toBeInTheDocument();
  });

  it('renders marker with correct position', () => {
    const marker = createTestMarker({ position: [51.5074, -0.1278] });
    render(<MapMarker marker={marker} />);

    const element = screen.getByTestId('mock-marker');
    expect(element).toHaveAttribute('data-position', '[51.5074,-0.1278]');
  });

  it('renders marker with aria-label', () => {
    const marker = createTestMarker({ label: 'London' });
    render(<MapMarker marker={marker} />);

    expect(screen.getByLabelText('London')).toBeInTheDocument();
  });

  it('renders marker with title', () => {
    const marker = createTestMarker({ label: 'Berlin' });
    render(<MapMarker marker={marker} />);

    expect(screen.getByTitle('Berlin')).toBeInTheDocument();
  });
});

// ============================================================================
// Invalid Coordinates Tests
// ============================================================================

describe('MapMarker Invalid Coordinates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('returns null for invalid latitude (> 90)', () => {
    const marker = createTestMarker({ position: [91, 0] });
    const { container } = render(<MapMarker marker={marker} />);

    expect(container.firstChild).toBeNull();
  });

  it('returns null for invalid latitude (< -90)', () => {
    const marker = createTestMarker({ position: [-91, 0] });
    const { container } = render(<MapMarker marker={marker} />);

    expect(container.firstChild).toBeNull();
  });

  it('returns null for invalid longitude (> 180)', () => {
    const marker = createTestMarker({ position: [0, 181] });
    const { container } = render(<MapMarker marker={marker} />);

    expect(container.firstChild).toBeNull();
  });

  it('returns null for invalid longitude (< -180)', () => {
    const marker = createTestMarker({ position: [0, -181] });
    const { container } = render(<MapMarker marker={marker} />);

    expect(container.firstChild).toBeNull();
  });

  it('returns null for NaN coordinates', () => {
    const marker = createTestMarker({ position: [NaN, NaN] });
    const { container } = render(<MapMarker marker={marker} />);

    expect(container.firstChild).toBeNull();
  });

  it('renders marker with valid edge coordinates (90, 180)', () => {
    const marker = createTestMarker({ position: [90, 180] });
    render(<MapMarker marker={marker} />);

    expect(screen.getByTestId('mock-marker')).toBeInTheDocument();
  });

  it('renders marker with valid edge coordinates (-90, -180)', () => {
    const marker = createTestMarker({ position: [-90, -180] });
    render(<MapMarker marker={marker} />);

    expect(screen.getByTestId('mock-marker')).toBeInTheDocument();
  });
});

// ============================================================================
// Popup Tests
// ============================================================================

describe('MapMarker Popup', () => {
  it('renders popup when popupContent is provided', () => {
    const marker = createTestMarker({
      popupContent: <div>Popup content here</div>,
    });
    render(<MapMarker marker={marker} />);

    expect(screen.getByTestId('mock-popup')).toBeInTheDocument();
    expect(screen.getByText('Popup content here')).toBeInTheDocument();
  });

  it('does not render popup when popupContent is not provided', () => {
    const marker = createTestMarker();
    render(<MapMarker marker={marker} />);

    expect(screen.queryByTestId('mock-popup')).not.toBeInTheDocument();
  });

  it('popup has correct accessibility attributes', () => {
    const marker = createTestMarker({
      label: 'Test Location',
      popupContent: <p>Details</p>,
    });
    render(<MapMarker marker={marker} />);

    const popup = screen.getByRole('dialog');
    expect(popup).toHaveAttribute('aria-label', 'Details for Test Location');
  });
});

// ============================================================================
// Click Handler Tests
// ============================================================================

describe('MapMarker Click Handler', () => {
  it('calls onClick when marker is clicked', async () => {
    const onClick = vi.fn();
    const marker = createTestMarker();
    render(<MapMarker marker={marker} onClick={onClick} />);

    const element = screen.getByTestId('mock-marker');
    element.click();

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith(marker);
  });

  it('does not throw when onClick is not provided', () => {
    const marker = createTestMarker();
    render(<MapMarker marker={marker} />);

    const element = screen.getByTestId('mock-marker');
    expect(() => element.click()).not.toThrow();
  });
});

// ============================================================================
// Marker Types Tests
// ============================================================================

describe('MapMarker Types', () => {
  it('renders with trip type', () => {
    const marker = createTestMarker({ type: 'trip' });
    render(<MapMarker marker={marker} />);

    expect(screen.getByTestId('mock-marker')).toBeInTheDocument();
  });

  it('renders with transport type', () => {
    const marker = createTestMarker({ type: 'transport' });
    render(<MapMarker marker={marker} />);

    expect(screen.getByTestId('mock-marker')).toBeInTheDocument();
  });

  it('renders with pickup type', () => {
    const marker = createTestMarker({ type: 'pickup' });
    render(<MapMarker marker={marker} />);

    expect(screen.getByTestId('mock-marker')).toBeInTheDocument();
  });

  it('renders with default type', () => {
    const marker = createTestMarker({ type: 'default' });
    render(<MapMarker marker={marker} />);

    expect(screen.getByTestId('mock-marker')).toBeInTheDocument();
  });

  it('renders with custom color', () => {
    const marker = createTestMarker({ color: '#ff0000' });
    render(<MapMarker marker={marker} />);

    expect(screen.getByTestId('mock-marker')).toBeInTheDocument();
  });
});

// ============================================================================
// Memoization Tests
// ============================================================================

describe('MapMarker Memoization', () => {
  it('has displayName set', () => {
    expect(MapMarker.displayName).toBe('MapMarker');
  });
});
