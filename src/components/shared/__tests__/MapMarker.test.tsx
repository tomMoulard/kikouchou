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
import { divIcon } from 'leaflet';

import { MapMarker, type MapMarkerData } from '@/components/shared/MapMarker';
import { statusVariants } from '@/components/ui/status.variants';

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
  Tooltip: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-tooltip">{children}</div>
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
// Helpers
// ============================================================================

/**
 * The HTML string `MapMarker` handed to Leaflet's `divIcon`.
 *
 * The icon is the only place the marker's colours live, and it never reaches
 * the React tree — react-leaflet passes it to Leaflet, which writes it into the
 * marker pane itself. Reading it back off the mocked `divIcon` is therefore the
 * only way to assert anything about how a marker is painted.
 */
function renderedIconHtml(marker: MapMarkerData): string {
  render(<MapMarker marker={marker} />);
  const call = vi.mocked(divIcon).mock.calls.at(-1);
  expect(call, 'MapMarker did not build an icon').toBeDefined();
  return String(call![0]?.html ?? '');
}

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
// Tooltip Tests
// ============================================================================

describe('MapMarker Tooltip', () => {
  it('renders tooltip when tooltipContent is provided', () => {
    const marker = createTestMarker({
      tooltipContent: <div>Short info</div>,
    });
    render(<MapMarker marker={marker} />);

    expect(screen.getByTestId('mock-tooltip')).toBeInTheDocument();
    expect(screen.getByText('Short info')).toBeInTheDocument();
  });

  it('does not render tooltip when tooltipContent is not provided', () => {
    const marker = createTestMarker();
    render(<MapMarker marker={marker} />);

    expect(screen.queryByTestId('mock-tooltip')).not.toBeInTheDocument();
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tags the pin with its type so a map can be probed for one', () => {
    expect(renderedIconHtml(createTestMarker({ type: 'pickup' }))).toContain(
      'data-marker-type="pickup"',
    );
  });

  /**
   * The regression the whole conversion exists for.
   *
   * Every default fill used to be a hex literal interpolated into the icon's
   * inline `style`, which no stylesheet — and therefore no `.dark` rule — can
   * reach. Asserting the absence of a hex is what fails if anyone reintroduces
   * one, whatever colour they pick.
   */
  it.each(['trip', 'transport', 'pickup', 'default'] as const)(
    'paints a %s pin with classes only, never a frozen hex',
    (type) => {
      const html = renderedIconHtml(createTestMarker({ type }));

      expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(html).not.toContain('style=');
      expect(html).not.toContain('background-color');
    },
  );

  it('draws the ring and the glyph from tokens, not from literal white', () => {
    const html = renderedIconHtml(createTestMarker({ type: 'trip' }));

    // `border-background` and `currentColor` invert with the theme; the
    // `2px solid white` ring and `stroke="white"` they replace did not.
    expect(html).toContain('border-background');
    expect(html).toContain('stroke="currentColor"');
    expect(html).not.toContain('white');
  });

  /**
   * The drift assertion the map legend depends on.
   *
   * `TransportMapPage` labels its pins with two swatches painted by
   * `statusVariants({ tone, emphasis: 'solid' })`. If the pins ever describe
   * those tones any other way — even a hand-written `bg-success` that happens
   * to match today — the legend and the map can be parted by a single edit to
   * the cva. Comparing against the live call is what makes that impossible.
   */
  it.each([
    ['transport', 'arrival'],
    ['pickup', 'departure'],
  ] as const)(
    'paints a %s pin with the same classes the legend swatch uses (%s)',
    (type, tone) => {
      const html = renderedIconHtml(createTestMarker({ type }));

      expect(html).toContain(statusVariants({ tone, emphasis: 'solid' }));
    },
  );

  it('keeps arrival and departure pins visibly different', () => {
    const arrival = renderedIconHtml(createTestMarker({ type: 'transport' }));
    const departure = renderedIconHtml(createTestMarker({ type: 'pickup' }));

    expect(arrival).toContain('bg-success');
    expect(departure).toContain('bg-departure');
    expect(arrival).not.toBe(departure);
  });

  it('gives each type its own fill', () => {
    const fills = (['trip', 'transport', 'pickup', 'default'] as const).map(
      (type) => /\bbg-[\w-]+\b/.exec(renderedIconHtml(createTestMarker({ type })))?.[0],
    );

    expect(fills).toEqual([
      'bg-primary',
      'bg-success',
      'bg-departure',
      'bg-muted-foreground',
    ]);
    expect(new Set(fills).size).toBe(fills.length);
  });
});

// ============================================================================
// Custom Colour Tests
// ============================================================================

describe('MapMarker custom colour', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with custom color', () => {
    const marker = createTestMarker({ color: '#ff0000' });
    render(<MapMarker marker={marker} />);

    expect(screen.getByTestId('mock-marker')).toBeInTheDocument();
  });

  /**
   * A person's colour is a database value, so it is the one thing here that
   * genuinely cannot be a class — AGENTS.md's inline-style carve-out. It has to
   * beat the type's `bg-*`, which an inline style does by specificity.
   */
  it.each(['#f00', '#ff0000', '#ff0000cc'])(
    'inlines the person colour %s and drops the type fill',
    (color) => {
      const html = renderedIconHtml(createTestMarker({ type: 'transport', color }));

      expect(html).toContain(`style="background-color:${color}"`);
      expect(html).not.toContain('bg-success');
      // The glyph stays white: nothing about an arbitrary user hex tells us
      // whether the theme's foreground would be readable on it.
      expect(html).toContain('text-white');
    },
  );

  /**
   * `sanitizeColor` is the only thing between `marker.color` and an HTML string
   * that is written into the document, and until now nothing tested it.
   */
  it.each([
    ['red', 'a CSS keyword'],
    ['rgb(255,0,0)', 'a functional notation'],
    ['#ff00', 'a wrong-length hex'],
    ['#gggggg', 'non-hex digits'],
    ['#ff0000" onload="alert(1)', 'an attribute-breaking payload'],
    ['red;"><script>alert(1)</script>', 'a tag-breaking payload'],
  ])('rejects %s (%s) and falls back to the type classes', (color) => {
    const html = renderedIconHtml(createTestMarker({ type: 'transport', color }));

    expect(html).not.toContain(color);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('style=');
    expect(html).toContain('bg-success');
  });

  /**
   * `type` is typed, but it lands in an HTML string, and a `MapMarkerData` is
   * routinely assembled from a persisted row that a sync or an import wrote.
   * The cast is what such a row looks like once it reaches this module.
   */
  it.each([
    '" onmouseover="alert(1)',
    '"><img src=x onerror=alert(1)>',
    'ferry',
  ])('falls back to the default type for an unknown %s', (type) => {
    const html = renderedIconHtml(
      createTestMarker({ type: type as MapMarkerData['type'] }),
    );

    expect(html).toContain('data-marker-type="default"');
    expect(html).not.toContain(type);
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('undefined');
    // A pin with a fill and a glyph, not an unpainted circle.
    expect(html).toContain('bg-muted-foreground');
    expect(html).toContain('<path');
  });

  it('falls back to the type classes when no colour is given', () => {
    const html = renderedIconHtml(createTestMarker({ type: 'pickup', color: undefined }));

    expect(html).not.toContain('style=');
    expect(html).toContain('bg-departure');
  });
});

// ============================================================================
// Memoization Tests
// ============================================================================

describe('MapMarker Memoization', () => {
  it('is wrapped in memo', () => {
    // memo() returns a MemoExoticComponent, which has $$typeof symbol
    // Named function inside memo provides DevTools debugging support
    expect(typeof MapMarker).toBe('object');
    expect(MapMarker.$$typeof).toBeDefined();
  });
});
