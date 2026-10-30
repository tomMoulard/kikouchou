/**
 * Component tests for MapMarker.
 *
 * `react-leaflet` is mocked, so the marker's whole visible output — its colour
 * and its glyph — lives in the `divIcon` options the component builds and never
 * reaches the DOM. The type and colour tests used to assert
 * `getByTestId('mock-marker')` and nothing else, which held with `MapMarker`
 * ignoring every prop it was given: a pickup could have drawn the trip glyph in
 * the trip blue and five green ticks would still have appeared.
 *
 * So these assert what the component *hands to* Leaflet rather than unmocking
 * it: the icon options are the seam, and they carry the mapping.
 *
 * @module components/shared/__tests__/MapMarker.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@/test/utils';

import type { MapMarkerData, MapMarkerType } from '@/components/shared/MapMarker';

/**
 * Loaded inside the first test rather than at the top of the file: the marker
 * classes, glyphs and colour pattern are load-time tables, and Stryker can only
 * test a mutant in load-time code against the test that was running when the
 * module loaded.
 */
let MapMarker: typeof import('@/components/shared/MapMarker').MapMarker;

beforeEach(async () => {
  ({ MapMarker } = await import('@/components/shared/MapMarker'));
});
import { statusVariants } from '@/components/ui/status.variants';

// ============================================================================
// Mocks
// ============================================================================

const mocks = vi.hoisted(() => ({
  /** How many times the Leaflet `Marker` beneath the component has rendered. */
  markerRenders: { count: 0 },
  /** Tags its argument so the object handed to `Marker` can be identified. */
  divIcon: vi.fn((options: Record<string, unknown>) => ({
    __leafletDivIcon: options,
  })),
}));

interface MockMarkerProps {
  children?: React.ReactNode;
  position: [number, number];
  icon?: unknown;
  eventHandlers?: {
    click?: () => void;
    keydown?: (e: unknown) => void;
  };
  /**
   * Leaflet's marker `alt` option, which is what it writes onto the marker
   * element as its accessible name. `aria-label` is not a marker option and
   * never reached the DOM, so a mock accepting it was testing a prop the real
   * library ignores.
   */
  alt?: string;
  title?: string;
}

// Mock react-leaflet components
vi.mock('react-leaflet', () => ({
  Marker: ({
    children,
    position,
    icon,
    eventHandlers,
    alt,
    title,
  }: MockMarkerProps) => {
    mocks.markerRenders.count += 1;
    return (
      <div
        data-testid="mock-marker"
        data-position={JSON.stringify(position)}
        // Proves the icon the component built is the one Leaflet is handed,
        // rather than an icon computed and dropped on the floor.
        data-icon-html={
          (icon as { __leafletDivIcon?: { html?: string } })?.__leafletDivIcon?.html ?? ''
        }
        aria-label={alt}
        title={title}
        onClick={eventHandlers?.click}
        onKeyDown={eventHandlers?.keydown}
        role="button"
        tabIndex={0}
      >
        {children}
      </div>
    );
  },
  Popup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-popup">{children}</div>
  ),
  Tooltip: ({
    children,
    direction,
    offset,
    opacity,
  }: {
    children: React.ReactNode;
    direction?: string;
    offset?: [number, number];
    opacity?: number;
  }) => (
    <div
      data-testid="mock-tooltip"
      data-direction={direction}
      data-offset={JSON.stringify(offset)}
      data-opacity={opacity}
    >
      {children}
    </div>
  ),
}));

// Mock leaflet
vi.mock('leaflet', () => ({
  divIcon: mocks.divIcon,
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

/** The options `MapMarker` last asked Leaflet to build an icon from. */
function lastIconOptions(): Record<string, unknown> {
  const calls = mocks.divIcon.mock.calls;
  expect(calls.length, 'divIcon was never called').toBeGreaterThan(0);
  return calls[calls.length - 1]![0];
}

/** The HTML of that icon. */
function lastIconHtml(): string {
  return String(lastIconOptions().html ?? '');
}

/**
 * Each marker type, its brief colour, and a fragment of the glyph only it draws.
 *
 * `pickup` and `default` deliberately share the map-pin glyph and differ only
 * in colour, which is why colour and glyph are asserted separately below.
 */
/**
 * NOTE: the hexes below are `MARKER_TYPE_COLORS` as it stands. Unit 21 is
 * moving that constant onto theme tokens so the markers follow dark mode; when
 * it lands, this one table is what moves with it. The distinctness test below
 * is the part that survives any re-theming unchanged.
 */
const TYPE_APPEARANCE: ReadonlyArray<
  readonly [MapMarkerType, string, string]
> = [
  ['trip', 'bg-primary', 'M3 12l2-2'],
  ['transport', 'bg-success', 'M8 7V3'],
  ['pickup', 'bg-departure', 'M17.657 16.657'],
  ['default', 'bg-muted-foreground', 'M17.657 16.657'],
];

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
  return lastIconHtml();
}

// ============================================================================
// Load-time tables
// ============================================================================

describe('MapMarker load-time tables', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const BASE =
    'map-marker-container flex size-8 cursor-pointer items-center justify-center ' +
    'rounded-full border-2 border-background shadow-md transition-colors';

  it('paints each type with its own classes and glyph, and lets only a real hex colour through', () => {
    const expected: ReadonlyArray<readonly [MapMarkerType, string, string]> = [
      [
        'trip',
        'bg-primary text-primary-foreground',
        '<path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>',
      ],
      [
        'transport',
        statusVariants({ tone: 'arrival', emphasis: 'solid' }),
        '<path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>',
      ],
      [
        'pickup',
        statusVariants({ tone: 'departure', emphasis: 'solid' }),
        '<path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>',
      ],
      [
        'default',
        'bg-muted-foreground text-background',
        '<path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>',
      ],
    ];

    for (const [type, classes, glyph] of expected) {
      const { unmount } = render(<MapMarker marker={createTestMarker({ id: type, type })} />);
      const html = lastIconHtml();
      expect(html).toContain(`class="${BASE} ${classes}" data-marker-type="${type}"`);
      expect(html).toContain(glyph);
      unmount();
    }

    const accepts = (color: string): boolean => {
      const { unmount } = render(<MapMarker marker={createTestMarker({ color })} />);
      const html = lastIconHtml();
      unmount();
      return html.includes(`style="background-color:${color}"`);
    };
    for (const color of ['#abc', '#A1B2C3', '#a1b2c3d4']) {
      expect(accepts(color), color).toBe(true);
    }
    for (const color of ['red', '#a', '#ab', '#abcd', 'x#abc', '#abcz', '#xyz', '#zzzzzz', '#zzzzzzzz']) {
      expect(accepts(color), color).toBe(false);
    }
  });
});

// ============================================================================
// Basic Rendering Tests
// ============================================================================

describe('MapMarker Basic Rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.markerRenders.count = 0;
  });

  it('renders a marker', () => {
    const marker = createTestMarker();
    render(<MapMarker marker={marker} />, { withProviders: false });

    expect(screen.getByTestId('mock-marker')).toBeInTheDocument();
  });

  it('renders marker with correct position', () => {
    const marker = createTestMarker({ position: [51.5074, -0.1278] });
    render(<MapMarker marker={marker} />, { withProviders: false });

    const element = screen.getByTestId('mock-marker');
    expect(element).toHaveAttribute('data-position', '[51.5074,-0.1278]');
  });

  it('gives the marker an accessible name through Leaflet\'s alt', () => {
    const marker = createTestMarker({ label: 'London' });
    render(<MapMarker marker={marker} />, { withProviders: false });

    expect(screen.getByLabelText('London')).toBeInTheDocument();
  });

  it('leaves the glyph as presentation, so the marker is one tab stop', () => {
    const marker = createTestMarker({ label: 'London' });
    render(<MapMarker marker={marker} />, { withProviders: false });

    // The icon html is rendered inside Leaflet's own focusable marker element.
    // A `tabindex` and a `role` on the inner div gave every pin a second tab
    // stop with no accessible name at all — the glyph is `aria-hidden`, so a
    // screen reader announced "button" and stopped.
    const html = screen.getByTestId('mock-marker').getAttribute('data-icon-html') ?? '';
    expect(html).not.toContain('tabindex');
    expect(html).not.toContain('role="button"');
  });

  it('renders marker with title', () => {
    const marker = createTestMarker({ label: 'Berlin' });
    render(<MapMarker marker={marker} />, { withProviders: false });

    expect(screen.getByTitle('Berlin')).toBeInTheDocument();
  });

  it('hands the icon it built to Leaflet rather than building one and dropping it', () => {
    const marker = createTestMarker({ type: 'transport' });
    render(<MapMarker marker={marker} />, { withProviders: false });

    expect(screen.getByTestId('mock-marker').getAttribute('data-icon-html')).toBe(
      lastIconHtml(),
    );
  });

  it('sizes and anchors the icon so the pin points at its coordinates', () => {
    render(<MapMarker marker={createTestMarker()} />, { withProviders: false });

    const options = lastIconOptions();
    expect(options.className).toBe('map-marker-icon');
    expect(options.iconSize).toEqual([32, 32]);
    // The anchor is the bottom-centre of a 32px box: an anchor at the centre
    // would sit the pin half a marker north of the place it names.
    expect(options.iconAnchor).toEqual([16, 32]);
    // And the popup opens above the pin, not on top of it.
    expect(options.popupAnchor).toEqual([0, -32]);
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
    const { container } = render(<MapMarker marker={marker} />, { withProviders: false });

    expect(container.firstChild).toBeNull();
  });

  it('returns null for invalid latitude (< -90)', () => {
    const marker = createTestMarker({ position: [-91, 0] });
    const { container } = render(<MapMarker marker={marker} />, { withProviders: false });

    expect(container.firstChild).toBeNull();
  });

  it('returns null for invalid longitude (> 180)', () => {
    const marker = createTestMarker({ position: [0, 181] });
    const { container } = render(<MapMarker marker={marker} />, { withProviders: false });

    expect(container.firstChild).toBeNull();
  });

  it('returns null for invalid longitude (< -180)', () => {
    const marker = createTestMarker({ position: [0, -181] });
    const { container } = render(<MapMarker marker={marker} />, { withProviders: false });

    expect(container.firstChild).toBeNull();
  });

  it('returns null for NaN coordinates', () => {
    const marker = createTestMarker({ position: [NaN, NaN] });
    const { container } = render(<MapMarker marker={marker} />, { withProviders: false });

    expect(container.firstChild).toBeNull();
  });

  it('names the offending marker in the dev warning', () => {
    // A silent `return null` on a map with forty markers gives a developer
    // nothing to search for; the id is the whole value of the warning.
    render(<MapMarker marker={createTestMarker({ id: 'pickup-7', position: [999, 0] })} />, {
      withProviders: false,
    });

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('pickup-7'));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('999'));
  });

  it('does not warn about a marker it drew', () => {
    render(<MapMarker marker={createTestMarker()} />, { withProviders: false });

    expect(console.warn).not.toHaveBeenCalled();
  });

  it('renders marker with valid edge coordinates (90, 180)', () => {
    const marker = createTestMarker({ position: [90, 180] });
    render(<MapMarker marker={marker} />, { withProviders: false });

    expect(screen.getByTestId('mock-marker')).toBeInTheDocument();
  });

  it('renders marker with valid edge coordinates (-90, -180)', () => {
    const marker = createTestMarker({ position: [-90, -180] });
    render(<MapMarker marker={marker} />, { withProviders: false });

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
    render(<MapMarker marker={marker} />, { withProviders: false });

    expect(screen.getByTestId('mock-popup')).toBeInTheDocument();
    expect(screen.getByText('Popup content here')).toBeInTheDocument();
  });

  it('does not render popup when popupContent is not provided', () => {
    const marker = createTestMarker();
    render(<MapMarker marker={marker} />, { withProviders: false });

    expect(screen.queryByTestId('mock-popup')).not.toBeInTheDocument();
  });

  it('popup has correct accessibility attributes', () => {
    const marker = createTestMarker({
      label: 'Test Location',
      popupContent: <p>Details</p>,
    });
    render(<MapMarker marker={marker} />, { withProviders: false });

    const popup = screen.getByRole('dialog');
    // i18next is mocked, so `t()` echoes the key: what matters is that the
    // label goes through it at all. It used to be a hardcoded English string,
    // announced in English to a French user.
    expect(popup).toHaveAttribute('aria-label', 'map.popupDetails');
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
    render(<MapMarker marker={marker} />, { withProviders: false });

    expect(screen.getByTestId('mock-tooltip')).toBeInTheDocument();
    expect(screen.getByText('Short info')).toBeInTheDocument();
  });

  it('does not render tooltip when tooltipContent is not provided', () => {
    const marker = createTestMarker();
    render(<MapMarker marker={marker} />, { withProviders: false });

    expect(screen.queryByTestId('mock-tooltip')).not.toBeInTheDocument();
  });
});

// ============================================================================
// Click Handler Tests
// ============================================================================

describe('MapMarker Click Handler', () => {
  it('calls onClick when marker is clicked', () => {
    const onClick = vi.fn();
    const marker = createTestMarker();
    render(<MapMarker marker={marker} onClick={onClick} />, { withProviders: false });

    screen.getByTestId('mock-marker').click();

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith(marker);
  });

  it('survives a click with no handler instead of throwing on the optional call', () => {
    const marker = createTestMarker();
    render(<MapMarker marker={marker} />, { withProviders: false });

    const element = screen.getByTestId('mock-marker');
    expect(() => element.click()).not.toThrow();
    // And the marker is still on the map afterwards — a thrown error inside an
    // event handler would leave it mounted too, so the no-throw alone is not
    // enough to say the click was a no-op.
    expect(screen.getByTestId('mock-marker')).toBeInTheDocument();
  });
});

// ============================================================================
// Keyboard Tests
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
// Keyboard Tests
// ============================================================================

describe('MapMarker Keyboard', () => {
  /**
   * The marker's `keydown` handler was previously untested altogether — the
   * whole keyboard path onto a map marker rested on nothing.
   */
  function pressKey(key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    screen.getByTestId('mock-marker').dispatchEvent(event);
    return event;
  }

  it.each(['Enter', ' '])('activates the marker on %s', (key) => {
    const onClick = vi.fn();
    const marker = createTestMarker();
    render(<MapMarker marker={marker} onClick={onClick} />, { withProviders: false });

    pressKey(key);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith(marker);
  });

  it('does not activate the marker on an unrelated key', () => {
    const onClick = vi.fn();
    render(<MapMarker marker={createTestMarker()} onClick={onClick} />, {
      withProviders: false,
    });

    pressKey('a');

    expect(onClick).not.toHaveBeenCalled();
  });

  it('forwards every key to onKeyDown together with the marker it belongs to', () => {
    const onKeyDown = vi.fn();
    const marker = createTestMarker();
    render(<MapMarker marker={marker} onKeyDown={onKeyDown} />, { withProviders: false });

    pressKey('Escape');

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    // The marker is the second argument: a handler shared across a map full of
    // markers has no other way to know which one was pressed.
    expect(onKeyDown.mock.calls[0]?.[1]).toBe(marker);
    expect((onKeyDown.mock.calls[0]?.[0] as KeyboardEvent).key).toBe('Escape');
  });

  it('swallows the page scroll that Space would otherwise cause', () => {
    const onClick = vi.fn();
    render(<MapMarker marker={createTestMarker()} onClick={onClick} />, {
      withProviders: false,
    });

    expect(pressKey(' ').defaultPrevented).toBe(true);
  });
});

// ============================================================================
// Marker Appearance Tests
// ============================================================================

describe('MapMarker Appearance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(TYPE_APPEARANCE)(
    'paints a %s marker with %s',
    (type, fill) => {
      render(<MapMarker marker={createTestMarker({ type })} />, { withProviders: false });

      expect(lastIconHtml()).toContain(fill);
    },
  );

  it.each(TYPE_APPEARANCE)(
    'draws the %s glyph',
    (type, _colour, glyph) => {
      render(<MapMarker marker={createTestMarker({ type })} />, { withProviders: false });

      expect(lastIconHtml()).toContain(glyph);
    },
  );

  it('gives the four types four different fills', () => {
    // Independent of which fills those are: a re-theme may move every entry in
    // the table above, but two types sharing one fill is always the bug.
    const fills = new Set(
      TYPE_APPEARANCE.map(([type]) => {
        const { unmount } = render(<MapMarker marker={createTestMarker({ type })} />, {
          withProviders: false,
        });
        const html = lastIconHtml();
        unmount();
        return /\bbg-[\w-]+\b/.exec(html)?.[0];
      }),
    );

    expect(fills.size).toBe(TYPE_APPEARANCE.length);
  });

  it('tells a trip apart from a transport stop at a glance', () => {
    // The two that a person actually has to distinguish on a busy map. If the
    // glyph table collapsed onto one entry, every per-type assertion above
    // would still pass for whichever entry survived.
    render(<MapMarker marker={createTestMarker({ type: 'trip' })} />, {
      withProviders: false,
    });
    const trip = lastIconHtml();

    render(<MapMarker marker={createTestMarker({ type: 'transport' })} />, {
      withProviders: false,
    });
    const transport = lastIconHtml();

    expect(trip).not.toBe(transport);
  });

  it('defaults an untyped marker to the grey pin', () => {
    const { id, position, label } = createTestMarker();
    render(<MapMarker marker={{ id, position, label }} />, { withProviders: false });

    expect(lastIconHtml()).toContain('bg-muted-foreground');
  });

  it('lets a custom colour override the type default', () => {
    render(<MapMarker marker={createTestMarker({ type: 'trip', color: '#ff0000' })} />, {
      withProviders: false,
    });

    const html = lastIconHtml();
    expect(html).toContain('background-color:#ff0000');
    // The person's colour replaces the trip fill rather than sitting beside it.
    expect(html).not.toContain('bg-primary');
  });

  it.each(['#f00', '#ff0000', '#ff0000cc'])('accepts the %s hex form', (colour) => {
    render(<MapMarker marker={createTestMarker({ color: colour })} />, {
      withProviders: false,
    });

    expect(lastIconHtml()).toContain(`background-color:${colour}`);
  });

  it('keeps the trip glyph when only the colour is customised', () => {
    render(<MapMarker marker={createTestMarker({ type: 'trip', color: '#ff0000' })} />, {
      withProviders: false,
    });

    expect(lastIconHtml()).toContain('M3 12l2-2');
  });
});

// ============================================================================
// Colour Sanitisation Tests
// ============================================================================

describe('MapMarker colour sanitisation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * The colour reaches an interpolated `style="..."` string inside `html`,
   * which Leaflet writes with `innerHTML`. Anything that is not a hex colour
   * has to be refused rather than escaped, because there is nothing here doing
   * the escaping.
   */
  const HOSTILE = [
    ['a style break-out', 'red" onload="alert(1)'],
    ['a tag break-out', '#fff"><script>alert(1)</script><b x="'],
    ['a CSS url()', 'url(javascript:alert(1))'],
    ['a named colour', 'red'],
    ['an rgb() function', 'rgb(255,0,0)'],
    ['an empty string', ''],
    ['a bare hex with no hash', 'ff0000'],
    ['a five-digit hex', '#12345'],
  ] as const;

  it.each(HOSTILE)('refuses %s and falls back to the type colour', (_name, colour) => {
    render(<MapMarker marker={createTestMarker({ type: 'trip', color: colour })} />, {
      withProviders: false,
    });

    const html = lastIconHtml();
    expect(html).toContain('bg-primary');
    if (colour !== '') {
      expect(html).not.toContain(colour);
    }
  });

  it('never lets a colour close the style attribute', () => {
    render(
      <MapMarker marker={createTestMarker({ color: '#fff" onmouseover="alert(1)' })} />,
      { withProviders: false },
    );

    expect(lastIconHtml()).not.toContain('onmouseover');
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
      // eslint-disable-next-line kikouchou/no-raw-palette-class -- Asserting the carve-out in MapMarker.tsx, not styling anything.
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

    // Not a bare `not.toContain(color)`: `red` is a substring of any future
    // base class that happens to contain it, which would fail this for the
    // wrong reason. What matters is that the rejected value did not become the
    // background, and that no attribute or tag was opened.
    expect(html).not.toContain(`background-color:${color}`);
    expect(html).not.toContain('style=');
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/\son[a-z]+=/);
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
// Older engines
// ============================================================================

/**
 * PostHog issue `01a1121b`: Chrome 92 on Android has no `Object.hasOwn` (it
 * shipped in 93), and resolving the marker type threw on every render.
 */
describe('MapMarker on an engine without Object.hasOwn', () => {
  // jsdom calls `Object.hasOwn` itself, so it cannot simply be deleted. The
  // stand-in throws what Chrome 92 threw, but only for the marker's own lookup
  // table, which is the one object with all four marker types as keys.
  beforeEach(() => {
    const realHasOwn = Object.hasOwn;
    vi.spyOn(Object, 'hasOwn').mockImplementation((target: object, key: PropertyKey) => {
      if (['trip', 'transport', 'pickup', 'default'].every((type) => type in target)) {
        throw new TypeError('Object.hasOwn is not a function');
      }
      return realHasOwn(target, key);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a known type', () => {
    const html = renderedIconHtml(createTestMarker({ type: 'transport' }));

    expect(html).toContain('data-marker-type="transport"');
  });

  it('still falls back to the default type for an unknown one', () => {
    const html = renderedIconHtml(
      createTestMarker({ type: 'ferry' as MapMarkerData['type'] }),
    );

    expect(html).toContain('data-marker-type="default"');
  });
});

// ============================================================================
// Memoization Tests
// ============================================================================

describe('MapMarker Memoization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.markerRenders.count = 0;
  });

  it('does not re-render when its parent does with unchanged props', () => {
    // The same `marker` object, so `memo`'s shallow compare has something to
    // bail on. `MapView` holds its markers in a memoised array for this reason.
    const marker = createTestMarker();
    const { rerender } = render(<MapMarker marker={marker} />, { withProviders: false });

    const before = mocks.markerRenders.count;
    expect(before).toBeGreaterThan(0);

    rerender(<MapMarker marker={marker} />);
    rerender(<MapMarker marker={marker} />);

    // A map redraws its parent on every pan; without `memo` each of those
    // rebuilds every marker beneath it.
    expect(mocks.markerRenders.count).toBe(before);
  });

  it('does re-render when the marker actually changes', () => {
    const { rerender } = render(<MapMarker marker={createTestMarker()} />, {
      withProviders: false,
    });

    const before = mocks.markerRenders.count;
    rerender(<MapMarker marker={createTestMarker({ label: 'Lyon' })} />);

    // The complement of the test above: a `memo` with a comparator that always
    // returned true would pass that one and freeze the map.
    expect(mocks.markerRenders.count).toBeGreaterThan(before);
    expect(screen.getByTestId('mock-marker')).toHaveAttribute('aria-label', 'Lyon');
  });

  it('reuses the icon when nothing it depends on changed', () => {
    const { rerender } = render(
      <MapMarker marker={createTestMarker({ label: 'Paris' })} />,
      { withProviders: false },
    );

    const buildsAfterFirstPaint = mocks.divIcon.mock.calls.length;
    rerender(<MapMarker marker={createTestMarker({ label: 'Lyon' })} />);

    // Rebuilding the DivIcon hands Leaflet a new icon object, which makes it
    // tear the marker's DOM down and put it back — a visible flicker on every
    // unrelated change.
    expect(mocks.divIcon.mock.calls.length).toBe(buildsAfterFirstPaint);
  });

  it('rebuilds the icon when the colour changes', () => {
    const { rerender } = render(<MapMarker marker={createTestMarker()} />, {
      withProviders: false,
    });

    const buildsAfterFirstPaint = mocks.divIcon.mock.calls.length;
    rerender(<MapMarker marker={createTestMarker({ color: '#ff0000' })} />);

    expect(mocks.divIcon.mock.calls.length).toBeGreaterThan(buildsAfterFirstPaint);
    expect(lastIconHtml()).toContain('background-color:#ff0000');
  });
});

// ============================================================================
// Freshness, the warning text and the tooltip placement
// ============================================================================

describe('MapMarker freshness and details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses a coordinate that is not a number at all', () => {
    const marker = createTestMarker({ position: ['48' as unknown as number, 2] });
    const { container } = render(<MapMarker marker={marker} />, { withProviders: false });

    expect(container.firstChild).toBeNull();
  });

  it('refuses a longitude that is not a number at all', () => {
    const marker = createTestMarker({ position: [48, '2' as unknown as number] });
    const { container } = render(<MapMarker marker={marker} />, { withProviders: false });

    expect(container.firstChild).toBeNull();
  });

  it('spells the whole marker out in the dev warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<MapMarker marker={createTestMarker({ id: 'pickup-7', position: [999, 4] })} />, {
      withProviders: false,
    });

    expect(warn).toHaveBeenCalledWith('MapMarker: Invalid coordinates for marker "pickup-7": [999, 4]');
    warn.mockRestore();
  });

  it('warns again when a marker it already drew moves off the globe', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { rerender } = render(<MapMarker marker={createTestMarker({ id: 'pickup-7', position: [48, 2] })} />, {
        withProviders: false,
      });
      expect(warn).not.toHaveBeenCalled();

      rerender(<MapMarker marker={createTestMarker({ id: 'pickup-7', position: [999, 4] })} />);

      expect(warn).toHaveBeenCalledWith('MapMarker: Invalid coordinates for marker "pickup-7": [999, 4]');
    } finally {
      warn.mockRestore();
    }
  });

  it('repaints the pin when its type or colour changes', () => {
    const { rerender } = render(<MapMarker marker={createTestMarker({ type: 'trip' })} />, {
      withProviders: false,
    });
    expect(screen.getByTestId('mock-marker').getAttribute('data-icon-html')).toContain('data-marker-type="trip"');

    rerender(<MapMarker marker={createTestMarker({ type: 'pickup' })} />);
    expect(screen.getByTestId('mock-marker').getAttribute('data-icon-html')).toContain('data-marker-type="pickup"');

    rerender(<MapMarker marker={createTestMarker({ type: 'pickup', color: '#123456' })} />);
    expect(screen.getByTestId('mock-marker').getAttribute('data-icon-html')).toContain('background-color:#123456');
  });

  it('drops a marker moved off the map', () => {
    const { container, rerender } = render(<MapMarker marker={createTestMarker()} />, {
      withProviders: false,
    });
    expect(screen.getByTestId('mock-marker')).toBeInTheDocument();

    rerender(<MapMarker marker={createTestMarker({ position: [95, 0] })} />);

    expect(container.firstChild).toBeNull();
  });

  it('reports a click and a key to the newest handlers, with the newest marker', () => {
    const firstClick = vi.fn();
    const secondClick = vi.fn();
    const secondKey = vi.fn();
    const { rerender } = render(<MapMarker marker={createTestMarker()} onClick={firstClick} />, {
      withProviders: false,
    });
    const moved = createTestMarker({ label: 'Lyon' });
    rerender(<MapMarker marker={moved} onClick={secondClick} onKeyDown={secondKey} />);

    fireEvent.click(screen.getByTestId('mock-marker'));
    fireEvent.keyDown(screen.getByTestId('mock-marker'), { key: 'Enter' });

    expect(firstClick).not.toHaveBeenCalled();
    expect(secondClick).toHaveBeenNthCalledWith(1, moved);
    expect(secondClick).toHaveBeenNthCalledWith(2, moved);
    expect(secondKey).toHaveBeenCalledWith(expect.objectContaining({ key: 'Enter' }), moved);
  });

  it('passes Enter on to onKeyDown when there is no click handler', () => {
    const onKeyDown = vi.fn();
    render(<MapMarker marker={createTestMarker()} onKeyDown={onKeyDown} />, { withProviders: false });

    fireEvent.keyDown(screen.getByTestId('mock-marker'), { key: 'Enter' });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('floats the tooltip above the pin, fully opaque', () => {
    render(<MapMarker marker={createTestMarker({ tooltipContent: 'Paris' })} />, { withProviders: false });

    const tooltip = screen.getByTestId('mock-tooltip');
    expect(tooltip).toHaveAttribute('data-direction', 'top');
    expect(tooltip).toHaveAttribute('data-offset', '[0,-16]');
    expect(tooltip).toHaveAttribute('data-opacity', '1');
    expect(tooltip.firstElementChild).toHaveClass('text-xs');
  });
});
