/**
 * Component tests for MapView.
 *
 * `react-leaflet` is mocked, so anything MapView does *to* the map — panning,
 * zooming, fitting bounds, choosing a tile set — happens against the mock and
 * never shows up in the DOM. The ref tests used to assert only
 * `expect(typeof ref.current?.panTo).toBe('function')`, which an imperative
 * handle of four empty functions satisfies completely; these call the methods
 * and check what reached Leaflet.
 *
 * @module components/shared/__tests__/MapView.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createRef } from 'react';

import {
  MapView,
  type MapViewRef,
  type MapMarkerData,
  type MapPolylineData,
} from '@/components/shared/MapView';
import enTranslations from '@/locales/en/translation.json';
import frTranslations from '@/locales/fr/translation.json';

// ============================================================================
// Mocks
// ============================================================================

/**
 * One stable element for the map's keyboard listener.
 *
 * `getContainer: vi.fn(() => document.createElement('div'))` handed back a
 * *fresh* node on every call, so the listener went on one element and the
 * cleanup came off another — and no keyboard event could ever be delivered.
 */
const mapContainer = document.createElement('div');

/** Whether the current viewport is claimed to contain a position. */
let boundsContain = true;

/**
 * Every tile URL the map has asked for, in order.
 *
 * The last one is what the DOM shows, so only the *first* can tell a map that
 * opened dark apart from one that opened light and corrected itself — and the
 * correction is the bug: a light OSM tile requested, painted, and cached by the
 * service worker before the dark one replaces it.
 */
const tileUrls: string[] = [];

// Mock map instance
const mockMapInstance = {
  panTo: vi.fn(),
  setZoom: vi.fn(),
  fitBounds: vi.fn(),
  getContainer: vi.fn(() => mapContainer),
  getBounds: vi.fn(() => ({ contains: () => boundsContain })),
};

// Mock react-leaflet
vi.mock('react-leaflet', () => ({
  MapContainer: ({
    children,
    center,
    zoom,
    className,
    dragging,
    scrollWheelZoom,
    keyboard,
    zoomControl,
    minZoom,
    maxZoom,
  }: {
    children: React.ReactNode;
    center: [number, number];
    zoom: number;
    className?: string;
    dragging?: boolean;
    scrollWheelZoom?: boolean;
    keyboard?: boolean;
    zoomControl?: boolean;
    minZoom?: number;
    maxZoom?: number;
  }) => (
    <div
      data-testid="mock-map-container"
      data-center={JSON.stringify(center)}
      data-zoom={zoom}
      data-dragging={String(dragging)}
      data-scroll-wheel-zoom={String(scrollWheelZoom)}
      data-keyboard={String(keyboard)}
      data-zoom-control={String(zoomControl)}
      data-min-zoom={minZoom}
      data-max-zoom={maxZoom}
      className={className}
    >
      {children}
    </div>
  ),
  TileLayer: ({ url, attribution }: { url: string; attribution?: string }) => {
    tileUrls.push(url);
    return (
      <div
        data-testid="mock-tile-layer"
        data-url={url}
        data-attribution={attribution ?? ''}
      />
    );
  },
  Polyline: ({
    positions,
    pathOptions,
  }: {
    positions: [number, number][];
    pathOptions?: { color?: string; weight?: number; opacity?: number };
  }) => (
    <div
      data-testid="mock-polyline"
      data-positions={JSON.stringify(positions)}
      data-color={pathOptions?.color}
    />
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
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- A stand-in for <MapMarker>. The double exists to expose the click handler to the test, not to be operated by a user.
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

/** Sends a key to the element Leaflet gave the map's keyboard listener. */
function pressOnMap(key: string): void {
  fireEvent.keyDown(mapContainer, { key });
}

beforeEach(() => {
  boundsContain = true;
  tileUrls.length = 0;
  document.documentElement.classList.remove('dark');
});

afterEach(() => {
  document.documentElement.classList.remove('dark');
  delete (window as unknown as Record<string, unknown>).__testMapClickHandler;
});

// ============================================================================
// Basic Rendering Tests
// ============================================================================

describe('MapView Basic Rendering', () => {
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

  it('clamps zooming to the range OSM actually serves', () => {
    render(<MapView center={[0, 0]} />);

    const container = screen.getByTestId('mock-map-container');
    // Past 19 the tile server returns 404s and the map goes blank grey.
    expect(container).toHaveAttribute('data-min-zoom', '3');
    expect(container).toHaveAttribute('data-max-zoom', '19');
  });

  it('turns off every gesture at once for a static preview', () => {
    render(<MapView center={[0, 0]} interactive={false} />);

    const container = screen.getByTestId('mock-map-container');
    // A preview embedded in a scrolling page must not eat the scroll, and a
    // half-disabled map (draggable but not zoomable) is worse than either.
    expect(container).toHaveAttribute('data-dragging', 'false');
    expect(container).toHaveAttribute('data-scroll-wheel-zoom', 'false');
    expect(container).toHaveAttribute('data-keyboard', 'false');
  });

  it('is fully interactive by default', () => {
    render(<MapView center={[0, 0]} />);

    const container = screen.getByTestId('mock-map-container');
    expect(container).toHaveAttribute('data-dragging', 'true');
    expect(container).toHaveAttribute('data-scroll-wheel-zoom', 'true');
  });

  it('can hide the zoom control', () => {
    render(<MapView center={[0, 0]} showZoomControl={false} />);

    expect(screen.getByTestId('mock-map-container')).toHaveAttribute(
      'data-zoom-control',
      'false',
    );
  });
});

// ============================================================================
// Tile Layer / Theme Tests
// ============================================================================

describe('MapView tile layer', () => {
  it('paints OSM tiles in light mode', () => {
    render(<MapView center={[0, 0]} />);

    expect(screen.getByTestId('mock-tile-layer')).toHaveAttribute(
      'data-url',
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    );
  });

  it('asks for the dark tiles on the first paint, not after a flash of light ones', () => {
    // The state is seeded from the class synchronously for exactly this reason:
    // correcting it in an effect requests a light tile, paints it, caches it in
    // the service worker, and only then swaps. Asserting the rendered DOM would
    // not notice — by the time the effect has run, the URL is right either way.
    document.documentElement.classList.add('dark');

    render(<MapView center={[0, 0]} />);

    expect(tileUrls[0]).toContain('dark_all');
    expect(tileUrls).not.toContain(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    );
  });

  it('never asks for a dark tile on a light page', () => {
    render(<MapView center={[0, 0]} />);

    expect(tileUrls.every((url) => !url.includes('dark_all'))).toBe(true);
  });

  it('repaints a map that is already on screen when the theme flips', async () => {
    render(<MapView center={[0, 0]} />);

    document.documentElement.classList.add('dark');

    // The MutationObserver is what makes the toggle reach a mounted map.
    await waitFor(() => {
      expect(screen.getByTestId('mock-tile-layer').getAttribute('data-url')).toContain(
        'dark_all',
      );
    });
  });

  it('credits CARTO as well as OSM on the dark tiles', () => {
    document.documentElement.classList.add('dark');

    render(<MapView center={[0, 0]} />);

    const attribution = screen.getByTestId('mock-tile-layer').getAttribute('data-attribution');
    expect(attribution).toContain('openstreetmap.org/copyright');
    // CARTO's terms require the credit; OSM's alone is not enough for their tiles.
    expect(attribution).toContain('carto.com/attributions');
  });

  it('credits OSM on the light tiles', () => {
    render(<MapView center={[0, 0]} />);

    const attribution = screen.getByTestId('mock-tile-layer').getAttribute('data-attribution');
    expect(attribution).toContain('openstreetmap.org/copyright');
    expect(attribution).not.toContain('carto.com');
  });

  it('drops the attribution only when the call site asks it to', () => {
    render(<MapView center={[0, 0]} showAttribution={false} />);

    expect(screen.getByTestId('mock-tile-layer')).toHaveAttribute('data-attribution', '');
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

  it('calls onMarkerClick with the marker that was clicked', () => {
    const onMarkerClick = vi.fn();
    const first = createTestMarker({ id: 'first', label: 'Paris' });
    const second = createTestMarker({ id: 'second', label: 'London' });
    render(
      <MapView
        center={[48.8566, 2.3522]}
        markers={[first, second]}
        onMarkerClick={onMarkerClick}
      />
    );

    fireEvent.click(screen.getByTestId('mock-marker-second'));

    // Not merely "called once": a handler wired to the wrong marker is the
    // failure this is here to catch.
    expect(onMarkerClick).toHaveBeenCalledTimes(1);
    expect(onMarkerClick).toHaveBeenCalledWith(second);
  });
});

// ============================================================================
// Polyline Tests
// ============================================================================

describe('MapView Polylines', () => {
  it('draws one line per route segment, with its own positions', () => {
    const polylines: MapPolylineData[] = [
      { id: 'leg-1', positions: [[48.85, 2.35], [51.5, -0.12]] },
      { id: 'leg-2', positions: [[51.5, -0.12], [52.37, 4.9]] },
    ];
    render(<MapView center={[48.85, 2.35]} polylines={polylines} />);

    const lines = screen.getAllByTestId('mock-polyline');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveAttribute('data-positions', '[[48.85,2.35],[51.5,-0.12]]');
    expect(lines[1]).toHaveAttribute('data-positions', '[[51.5,-0.12],[52.37,4.9]]');
  });

  it('draws no lines when there are none', () => {
    render(<MapView center={[0, 0]} />);

    expect(screen.queryByTestId('mock-polyline')).not.toBeInTheDocument();
  });
});

// ============================================================================
// Map Click Tests
// ============================================================================

describe('MapView Map Click', () => {
  it('calls onMapClick when map is clicked', () => {
    const onMapClick = vi.fn();
    render(<MapView center={[0, 0]} onMapClick={onMapClick} />);

    // Simulate map click via stored handler
    const handler = (
      window as unknown as {
        __testMapClickHandler?: (e: { latlng: { lat: number; lng: number } }) => void;
      }
    ).__testMapClickHandler;
    // Without this the test passes when the map registers no handler at all:
    // the call below is skipped and `onMapClick` is never expected to fire.
    expect(handler, 'the map never registered a click handler').toBeTypeOf('function');
    handler?.({ latlng: { lat: 45.0, lng: 10.0 } });

    expect(onMapClick).toHaveBeenCalledWith([45.0, 10.0]);
  });
});

// ============================================================================
// Map Ready Tests
// ============================================================================

describe('MapView onMapReady', () => {
  it('hands the live Leaflet map to the call site once it exists', () => {
    const onMapReady = vi.fn();
    render(<MapView center={[0, 0]} onMapReady={onMapReady} />);

    // A call site that wants to add its own layer needs the instance itself,
    // not a truthy placeholder.
    expect(onMapReady).toHaveBeenCalledWith(mockMapInstance);
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

  it('keeps a valid centre exactly as given', () => {
    // The complement: a validator that rejected everything would pass all three
    // tests above and put every map in the Gulf of Guinea.
    render(<MapView center={[-33.8688, 151.2093]} />);

    expect(screen.getByTestId('mock-map-container')).toHaveAttribute(
      'data-center',
      '[-33.8688,151.2093]',
    );
  });

  it('says which coordinates it rejected', () => {
    render(<MapView center={[100, 0]} />);

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('100'));
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

  it('announces the marker count politely, out of sight', () => {
    const markers = [createTestMarker({ id: '1' }), createTestMarker({ id: '2' })];
    render(<MapView center={[0, 0]} markers={markers} />);

    const announcement = screen.getByText(/map\.markerCount/);
    // Visible text would repeat what the map already shows; the point is that a
    // screen-reader user learns how many pins are there without panning.
    expect(announcement).toHaveClass('sr-only');
    expect(announcement).toHaveAttribute('aria-live', 'polite');
  });

  it('counts the markers in the announcement in every language', () => {
    // The i18n mock strips `count`, so the rendered string cannot show that the
    // number reaches the announcement. Assert it on the bundles instead — the
    // same reasoning as `PersonBadge`'s accessible name.
    expect(enTranslations.map.markerCount_one).toContain('{{count}}');
    expect(enTranslations.map.markerCount_other).toContain('{{count}}');
    expect(frTranslations.map.markerCount_one).toContain('{{count}}');
    expect(frTranslations.map.markerCount_other).toContain('{{count}}');
  });
});

// ============================================================================
// Keyboard Navigation Tests
// ============================================================================

describe('MapView keyboard navigation', () => {
  const markers = [
    createTestMarker({ id: 'a', label: 'Paris', position: [48.8566, 2.3522] }),
    createTestMarker({ id: 'b', label: 'London', position: [51.5074, -0.1278] }),
    createTestMarker({ id: 'c', label: 'Berlin', position: [52.52, 13.405] }),
  ];

  it('activates the focused marker on Enter', () => {
    const onMarkerClick = vi.fn();
    render(<MapView center={[0, 0]} markers={markers} onMarkerClick={onMarkerClick} />);

    pressOnMap('ArrowDown'); // focus index 0
    pressOnMap('Enter');

    expect(onMarkerClick).toHaveBeenCalledWith(markers[0]);
  });

  it('steps forward through the markers', () => {
    const onMarkerClick = vi.fn();
    render(<MapView center={[0, 0]} markers={markers} onMarkerClick={onMarkerClick} />);

    pressOnMap('ArrowDown');
    pressOnMap('ArrowDown');
    pressOnMap('Enter');

    expect(onMarkerClick).toHaveBeenCalledWith(markers[1]);
  });

  it('wraps backwards from the start to the last marker', () => {
    const onMarkerClick = vi.fn();
    render(<MapView center={[0, 0]} markers={markers} onMarkerClick={onMarkerClick} />);

    pressOnMap('ArrowUp');
    pressOnMap('Enter');

    expect(onMarkerClick).toHaveBeenCalledWith(markers[2]);
  });

  it('drops the selection on Escape rather than activating it', () => {
    const onMarkerClick = vi.fn();
    render(<MapView center={[0, 0]} markers={markers} onMarkerClick={onMarkerClick} />);

    pressOnMap('ArrowDown');
    pressOnMap('Escape');
    pressOnMap('Enter');

    expect(onMarkerClick).not.toHaveBeenCalled();
  });

  it('leaves Tab alone so focus can escape the map', () => {
    render(<MapView center={[0, 0]} markers={markers} />);

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    mapContainer.dispatchEvent(event);

    // Trapping Tab inside a map is a keyboard trap (WCAG 2.1.2).
    expect(event.defaultPrevented).toBe(false);
  });

  it('pans to a focused marker that is off screen', () => {
    boundsContain = false;
    render(<MapView center={[0, 0]} markers={markers} />);
    mockMapInstance.panTo.mockClear();

    pressOnMap('ArrowDown');

    expect(mockMapInstance.panTo).toHaveBeenCalledWith(
      [48.8566, 2.3522],
      expect.objectContaining({ animate: true }),
    );
  });

  it('leaves the viewport alone for a marker already in view', () => {
    boundsContain = true;
    render(<MapView center={[0, 0]} markers={markers} />);
    mockMapInstance.panTo.mockClear();

    pressOnMap('ArrowDown');

    // Recentring on a pin the user can already see is a jump for no reason.
    expect(mockMapInstance.panTo).not.toHaveBeenCalled();
  });

  it('does not listen at all on a non-interactive map', () => {
    const onMarkerClick = vi.fn();
    render(
      <MapView
        center={[0, 0]}
        markers={markers}
        interactive={false}
        onMarkerClick={onMarkerClick}
      />,
    );

    pressOnMap('ArrowDown');
    pressOnMap('Enter');

    expect(onMarkerClick).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Ref Tests
// ============================================================================

describe('MapView Ref', () => {
  beforeEach(() => {
    mockMapInstance.panTo.mockClear();
    mockMapInstance.setZoom.mockClear();
    mockMapInstance.fitBounds.mockClear();
  });

  it('getMap returns the live Leaflet instance', () => {
    const ref = createRef<MapViewRef>();
    render(<MapView ref={ref} center={[0, 0]} />);

    expect(ref.current?.getMap()).toBe(mockMapInstance);
  });

  it('panTo moves the map to the position it was given', () => {
    const ref = createRef<MapViewRef>();
    render(<MapView ref={ref} center={[0, 0]} />);

    ref.current?.panTo([48.8566, 2.3522]);

    expect(mockMapInstance.panTo).toHaveBeenCalledWith([48.8566, 2.3522]);
  });

  it('setZoom sets the zoom it was given', () => {
    const ref = createRef<MapViewRef>();
    render(<MapView ref={ref} center={[0, 0]} />);

    ref.current?.setZoom(17);

    expect(mockMapInstance.setZoom).toHaveBeenCalledWith(17);
  });

  it('fitBounds frames every marker with room to breathe', () => {
    const ref = createRef<MapViewRef>();
    const markers = [
      createTestMarker({ id: 'a', position: [48.8566, 2.3522] }),
      createTestMarker({ id: 'b', position: [51.5074, -0.1278] }),
    ];
    render(<MapView ref={ref} center={[0, 0]} markers={markers} />);

    ref.current?.fitBounds();

    expect(mockMapInstance.fitBounds).toHaveBeenCalledWith(
      [
        [48.8566, 2.3522],
        [51.5074, -0.1278],
      ],
      // Without the padding the outermost pins sit against the frame, half of
      // each one clipped by the container edge.
      { padding: [50, 50] },
    );
  });

  it('fitBounds includes the route lines, not just the pins', () => {
    const ref = createRef<MapViewRef>();
    render(
      <MapView
        ref={ref}
        center={[0, 0]}
        markers={[createTestMarker({ id: 'a', position: [48.8566, 2.3522] })]}
        polylines={[{ id: 'leg', positions: [[10, 20], [30, 40]] }]}
      />,
    );

    ref.current?.fitBounds();

    // A transport leg drawn off the edge of the framed area is the whole point
    // of the journey, missing.
    expect(mockMapInstance.fitBounds).toHaveBeenCalledWith(
      [
        [48.8566, 2.3522],
        [10, 20],
        [30, 40],
      ],
      { padding: [50, 50] },
    );
  });

  it('fitBounds does nothing when there is nothing to frame', () => {
    const ref = createRef<MapViewRef>();
    render(<MapView ref={ref} center={[0, 0]} />);

    ref.current?.fitBounds();

    // Leaflet throws on empty bounds; the guard is not decoration.
    expect(mockMapInstance.fitBounds).not.toHaveBeenCalled();
  });

  it('fitBounds frames the markers the map has now, not the ones it opened with', () => {
    const ref = createRef<MapViewRef>();
    const { rerender } = render(
      <MapView ref={ref} center={[0, 0]} markers={[createTestMarker({ id: 'a' })]} />,
    );

    rerender(
      <MapView
        ref={ref}
        center={[0, 0]}
        markers={[createTestMarker({ id: 'b', position: [1, 2] })]}
      />,
    );
    ref.current?.fitBounds();

    // The handle closes over `markers`; a stale dependency list would frame a
    // marker that is no longer on the map.
    expect(mockMapInstance.fitBounds).toHaveBeenCalledWith([[1, 2]], { padding: [50, 50] });
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
