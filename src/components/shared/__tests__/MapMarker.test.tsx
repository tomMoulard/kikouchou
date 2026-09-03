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
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/utils';

import { MapMarker, type MapMarkerData, type MapMarkerType } from '@/components/shared/MapMarker';

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
  'aria-label'?: string;
  title?: string;
}

// Mock react-leaflet components
vi.mock('react-leaflet', () => ({
  Marker: ({
    children,
    position,
    icon,
    eventHandlers,
    'aria-label': ariaLabel,
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
        aria-label={ariaLabel}
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
  Tooltip: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-tooltip">{children}</div>
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
  ['trip', '#3b82f6', 'M3 12l2-2'],
  ['transport', '#22c55e', 'M8 7V3'],
  ['pickup', '#f97316', 'M17.657 16.657'],
  ['default', '#6b7280', 'M17.657 16.657'],
];

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

  it('renders marker with aria-label', () => {
    const marker = createTestMarker({ label: 'London' });
    render(<MapMarker marker={marker} />, { withProviders: false });

    expect(screen.getByLabelText('London')).toBeInTheDocument();
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
    'paints a %s marker in %s',
    (type, colour) => {
      render(<MapMarker marker={createTestMarker({ type })} />, { withProviders: false });

      expect(lastIconHtml()).toContain(`background-color: ${colour}`);
    },
  );

  it.each(TYPE_APPEARANCE)(
    'draws the %s glyph',
    (type, _colour, glyph) => {
      render(<MapMarker marker={createTestMarker({ type })} />, { withProviders: false });

      expect(lastIconHtml()).toContain(glyph);
    },
  );

  it('gives the four types four different colours', () => {
    // Independent of which colours those are: a re-theme may move every hex in
    // the table above, but two types sharing one colour is always the bug.
    const colours = new Set(
      TYPE_APPEARANCE.map(([type]) => {
        const { unmount } = render(<MapMarker marker={createTestMarker({ type })} />, {
          withProviders: false,
        });
        const html = lastIconHtml();
        unmount();
        return /background-color:\s*([^;]+);/.exec(html)?.[1];
      }),
    );

    expect(colours.size).toBe(TYPE_APPEARANCE.length);
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

    expect(lastIconHtml()).toContain('background-color: #6b7280');
  });

  it('lets a custom colour override the type default', () => {
    render(<MapMarker marker={createTestMarker({ type: 'trip', color: '#ff0000' })} />, {
      withProviders: false,
    });

    const html = lastIconHtml();
    expect(html).toContain('background-color: #ff0000');
    // The person's colour replaces the trip blue rather than sitting beside it.
    expect(html).not.toContain('#3b82f6');
  });

  it.each(['#f00', '#ff0000', '#ff0000cc'])('accepts the %s hex form', (colour) => {
    render(<MapMarker marker={createTestMarker({ color: colour })} />, {
      withProviders: false,
    });

    expect(lastIconHtml()).toContain(`background-color: ${colour}`);
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
    expect(html).toContain('background-color: #3b82f6');
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
    expect(lastIconHtml()).toContain('background-color: #ff0000');
  });
});
