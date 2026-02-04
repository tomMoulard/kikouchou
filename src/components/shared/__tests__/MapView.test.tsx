/**
 * Component tests for MapView
 *
 * Tests rendering of map container, markers, and accessibility features.
 * Note: These tests mock react-leaflet to avoid complex map initialization.
 *
 * @module components/shared/__tests__/MapView.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createRef } from 'react';

import { MapView, type MapViewRef, type MapMarkerData } from '@/components/shared/MapView';

// ============================================================================
// Mocks
// ============================================================================

// Mock map instance
const mockMapInstance = {
  panTo: vi.fn(),
  setZoom: vi.fn(),
  fitBounds: vi.fn(),
  getContainer: vi.fn(() => document.createElement('div')),
};

// Mock react-leaflet
vi.mock('react-leaflet', () => ({
  MapContainer: ({
    children,
    center,
    zoom,
    className,
  }: {
    children: React.ReactNode;
    center: [number, number];
    zoom: number;
    className?: string;
  }) => (
    <div
      data-testid="mock-map-container"
      data-center={JSON.stringify(center)}
      data-zoom={zoom}
      className={className}
    >
      {children}
    </div>
  ),
  TileLayer: ({ url }: { url: string }) => (
    <div data-testid="mock-tile-layer" data-url={url} />
  ),
  useMap: () => mockMapInstance,
  useMapEvents: (handlers: { click?: (e: { latlng: { lat: number; lng: number } }) => void }) => {
    // Store click handler for testing
    if (handlers.click) {
      (window as unknown as Record<string, unknown>).__testMapClickHandler = handlers.click;
    }
    return null;
  },
}));

// Mock leaflet CSS
vi.mock('leaflet/dist/leaflet.css', () => ({}));

// Mock leaflet
vi.mock('leaflet', () => ({
  divIcon: vi.fn(() => ({})),
}));

// Mock the MapMarker component
vi.mock('@/components/shared/MapMarker', () => ({
  MapMarker: ({
    marker,
    onClick,
  }: {
    marker: MapMarkerData;
    onClick?: (m: MapMarkerData) => void;
  }) => (
    <div
      data-testid={`mock-marker-${marker.id}`}
      data-label={marker.label}
      onClick={() => onClick?.(marker)}
    />
  ),
}));

// ============================================================================
// Test Data
// ============================================================================

const createTestMarker = (overrides: Partial<MapMarkerData> = {}): MapMarkerData => ({
  id: 'test-1',
  position: [48.8566, 2.3522],
  label: 'Paris',
  type: 'trip',
  ...overrides,
});

// ============================================================================
// Basic Rendering Tests
// ============================================================================

describe('MapView Basic Rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__testMapClickHandler;
  });

  it('renders map container', () => {
    render(<MapView center={[48.8566, 2.3522]} />);

    expect(screen.getByTestId('mock-map-container')).toBeInTheDocument();
  });

  it('renders with correct center', () => {
    render(<MapView center={[51.5074, -0.1278]} />);

    const container = screen.getByTestId('mock-map-container');
    expect(container).toHaveAttribute('data-center', '[51.5074,-0.1278]');
  });

  it('renders with correct zoom', () => {
    render(<MapView center={[0, 0]} zoom={10} />);

    const container = screen.getByTestId('mock-map-container');
    expect(container).toHaveAttribute('data-zoom', '10');
  });

  it('renders with default zoom (13)', () => {
    render(<MapView center={[0, 0]} />);

    const container = screen.getByTestId('mock-map-container');
    expect(container).toHaveAttribute('data-zoom', '13');
  });

  it('renders tile layer', () => {
    render(<MapView center={[0, 0]} />);

    expect(screen.getByTestId('mock-tile-layer')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(<MapView center={[0, 0]} className="custom-class" />);

    const wrapper = screen.getByRole('application');
    expect(wrapper).toHaveClass('custom-class');
  });
});

// ============================================================================
// Markers Tests
// ============================================================================

describe('MapView Markers', () => {
  it('renders markers', () => {
    const markers = [
      createTestMarker({ id: 'm1', label: 'Paris' }),
      createTestMarker({ id: 'm2', label: 'London', position: [51.5074, -0.1278] }),
    ];
    render(<MapView center={[48.8566, 2.3522]} markers={markers} />);

    expect(screen.getByTestId('mock-marker-m1')).toBeInTheDocument();
    expect(screen.getByTestId('mock-marker-m2')).toBeInTheDocument();
  });

  it('renders empty markers array without error', () => {
    render(<MapView center={[0, 0]} markers={[]} />);

    expect(screen.getByTestId('mock-map-container')).toBeInTheDocument();
  });

  it('calls onMarkerClick when marker is clicked', () => {
    const onMarkerClick = vi.fn();
    const markers = [createTestMarker({ id: 'clickable' })];
    render(
      <MapView
        center={[48.8566, 2.3522]}
        markers={markers}
        onMarkerClick={onMarkerClick}
      />
    );

    fireEvent.click(screen.getByTestId('mock-marker-clickable'));

    expect(onMarkerClick).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Map Click Tests
// ============================================================================

describe('MapView Map Click', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__testMapClickHandler;
  });

  it('calls onMapClick when map is clicked', () => {
    const onMapClick = vi.fn();
    render(<MapView center={[0, 0]} onMapClick={onMapClick} />);

    // Simulate map click via stored handler
    const handler = (window as unknown as Record<string, (e: { latlng: { lat: number; lng: number } }) => void>).__testMapClickHandler;
    if (handler) {
      handler({ latlng: { lat: 45.0, lng: 10.0 } });
    }

    expect(onMapClick).toHaveBeenCalledWith([45.0, 10.0]);
  });
});

// ============================================================================
// Invalid Coordinates Tests
// ============================================================================

describe('MapView Invalid Coordinates', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('handles invalid center latitude', () => {
    render(<MapView center={[100, 0]} />);

    const container = screen.getByTestId('mock-map-container');
    // Should default to [0, 0]
    expect(container).toHaveAttribute('data-center', '[0,0]');
  });

  it('handles invalid center longitude', () => {
    render(<MapView center={[0, 200]} />);

    const container = screen.getByTestId('mock-map-container');
    // Should default to [0, 0]
    expect(container).toHaveAttribute('data-center', '[0,0]');
  });

  it('handles NaN coordinates', () => {
    render(<MapView center={[NaN, NaN]} />);

    const container = screen.getByTestId('mock-map-container');
    // Should default to [0, 0]
    expect(container).toHaveAttribute('data-center', '[0,0]');
  });
});

// ============================================================================
// Accessibility Tests
// ============================================================================

describe('MapView Accessibility', () => {
  it('has role="application"', () => {
    render(<MapView center={[0, 0]} />);

    expect(screen.getByRole('application')).toBeInTheDocument();
  });

  it('has default aria-label', () => {
    render(<MapView center={[0, 0]} />);

    expect(screen.getByRole('application')).toHaveAttribute('aria-label', 'map.ariaLabel');
  });

  it('accepts custom aria-label', () => {
    render(<MapView center={[0, 0]} aria-label="Trip location map" />);

    expect(screen.getByRole('application')).toHaveAttribute('aria-label', 'Trip location map');
  });

  it('announces marker count to screen readers', () => {
    const markers = [
      createTestMarker({ id: '1' }),
      createTestMarker({ id: '2' }),
    ];
    render(<MapView center={[0, 0]} markers={markers} />);

    expect(screen.getByText(/map\.markerCount/)).toBeInTheDocument();
  });
});

// ============================================================================
// Ref Tests
// ============================================================================

describe('MapView Ref', () => {
  it('exposes getMap method', () => {
    const ref = createRef<MapViewRef>();
    render(<MapView ref={ref} center={[0, 0]} />);

    expect(ref.current?.getMap).toBeDefined();
    expect(typeof ref.current?.getMap).toBe('function');
  });

  it('exposes panTo method', () => {
    const ref = createRef<MapViewRef>();
    render(<MapView ref={ref} center={[0, 0]} />);

    expect(ref.current?.panTo).toBeDefined();
    expect(typeof ref.current?.panTo).toBe('function');
  });

  it('exposes setZoom method', () => {
    const ref = createRef<MapViewRef>();
    render(<MapView ref={ref} center={[0, 0]} />);

    expect(ref.current?.setZoom).toBeDefined();
    expect(typeof ref.current?.setZoom).toBe('function');
  });

  it('exposes fitBounds method', () => {
    const ref = createRef<MapViewRef>();
    render(<MapView ref={ref} center={[0, 0]} />);

    expect(ref.current?.fitBounds).toBeDefined();
    expect(typeof ref.current?.fitBounds).toBe('function');
  });
});

// ============================================================================
// Height Tests
// ============================================================================

describe('MapView Height', () => {
  it('applies numeric height', () => {
    render(<MapView center={[0, 0]} height={400} />);

    const wrapper = screen.getByRole('application');
    expect(wrapper).toHaveStyle({ height: '400px' });
  });

  it('applies string height', () => {
    render(<MapView center={[0, 0]} height="50vh" />);

    const wrapper = screen.getByRole('application');
    expect(wrapper).toHaveStyle({ height: '50vh' });
  });
});

// ============================================================================
// Display Name Tests
// ============================================================================

describe('MapView Display Name', () => {
  it('has displayName set', () => {
    expect(MapView.displayName).toBe('MapView');
  });
});
