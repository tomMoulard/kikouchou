/**
 * @fileoverview E2E tests for Maps Integration in Kikouchou PWA.
 * Tests the map functionality including:
 * - Trip location map preview and expansion
 * - Transport map view with markers
 * - Directions button functionality
 * - Offline map tile caching
 *
 * @module e2e/maps-integration
 */

import { test, expect, type Page } from '@playwright/test';
import { clearIndexedDB } from './support/storage';
import { waitForRoute } from './support/routes';

import { seedPerson, seedTransport, seedTrip } from './support/seed';
import { fixtureDate, fixtureDatetime } from './support/fixture-dates';

// ============================================================================
// Test Configuration & Helpers
// ============================================================================

/**
 * Test data for creating trips with locations.
 *
 * Dates derived from today rather than pinned to July 2024, which was 26 months
 * behind by the time anyone looked — see `support/fixture-dates`.
 */
const TEST_TRIP_WITH_LOCATION = {
  name: 'Paris Trip',
  startDate: fixtureDate(15),
  endDate: fixtureDate(22),
} as const;

/**
 * Test coordinates for Paris.
 */
const PARIS_COORDINATES = {
  lat: 48.8566,
  lon: 2.3522,
} as const;

/** Somewhere else entirely, for the trip whose map is expanded. */
const LONDON_COORDINATES = {
  lat: 51.5074,
  lon: -0.1278,
} as const;

/**
 * The trip list, scoped so the sidebar's own lists cannot answer for it.
 */
function tripCard(page: Page, name: string) {
  return page
    .getByRole('list', { name: /my trips/i })
    .getByRole('listitem')
    .filter({ hasText: name });
}

/**
 * Console errors and uncaught exceptions, collected from *before* whatever
 * navigation is about to happen.
 *
 * Order is the whole point. Two tests here used to attach their listener after
 * `goto` + `waitForLoadState` and then assert the collection was empty — so
 * every error emitted while the page loaded, the ones they are named for, fired
 * before anything was listening and the assertion held by construction.
 */
interface CollectedErrors {
  /** `console.error(...)` calls. */
  readonly console: string[];
  /** Uncaught exceptions and unhandled rejections. */
  readonly uncaught: string[];
}

/**
 * Failures that say nothing about the app: a stubbed tile answers with an empty
 * body on purpose, and the favicon is not part of any contract here.
 */
const IGNORABLE_CONSOLE_ERROR =
  /Failed to load resource|net::ERR_|tile\.openstreetmap\.org|basemaps\.cartocdn\.com|favicon/i;

/**
 * Presses Enter the way a browser does, including the `keypress` a real key
 * press produces.
 *
 * `page.keyboard.press('Enter')` emits only `keydown` and `keyup` — measured,
 * by listening on the element — and Leaflet activates a marker's popup from
 * `keypress` (`Map._onKeyPress`, keyCode 13). So the built-in press cannot
 * drive the production path at all, and a test using it would report the
 * feature broken when it is not. CDP's `char` event is the missing half.
 */
async function pressEnterWithKeypress(page: Page): Promise<void> {
  const key = {
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    text: '\r',
    unmodifiedText: '\r',
  } as const;

  const client = await page.context().newCDPSession(page);
  try {
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
    await client.send('Input.dispatchKeyEvent', { type: 'char', ...key });
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  } finally {
    await client.detach();
  }
}

function collectErrors(page: Page): CollectedErrors {
  const collected: CollectedErrors = { console: [], uncaught: [] };
  page.on('console', (message) => {
    if (message.type() === 'error' && !IGNORABLE_CONSOLE_ERROR.test(message.text())) {
      collected.console.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    collected.uncaught.push(error.message);
  });
  return collected;
}

// ============================================================================
// Test Suite: Trip Location Map
// ============================================================================

/** A fixed window the seeded fixtures sit inside. */
const SEEDED_TRIP_DATES = { startDate: fixtureDate(13), endDate: fixtureDate(25) } as const;

/** Charles de Gaulle, so a seeded transport has somewhere to be on the map. */
const SEEDED_TRANSPORT_COORDINATES = { lat: 49.0097, lon: 2.5479 } as const;

/** A datetime inside {@link SEEDED_TRIP_DATES}, derived like the rest. */
const SEEDED_TRANSPORT_DATETIME = fixtureDatetime(15, '10:00:00.000Z');

test.describe('Trip Location Map', () => {
  test.beforeEach(async ({ page }) => {
    await clearIndexedDB(page);

    // Mock external tile & geocoding requests to prevent slow/hanging network calls
    await page.route('**/tile.openstreetmap.org/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }),
    );
    await page.route('**/nominatim.openstreetmap.org/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    await page.goto('/');
    await page.waitForLoadState('load');
    await waitForRoute(page);
  });

  /**
   * Two trips, one pinned and one not.
   *
   * Seeded rather than created through the form, and that is not a shortcut:
   * `LocationPicker` resolves coordinates by geocoding against Nominatim, which
   * this suite stubs out with `[]`, so a trip created through the UI here can
   * never carry coordinates and can never get a preview. That is why the
   * previous version of this test could only assert
   * `expect(typeof hasMapElement).toBe('boolean')` — true whether or not a map
   * had rendered, and true with the whole feature deleted.
   *
   * The unpinned trip is the control: without it, "a map is on the page"
   * would also pass if every card rendered one unconditionally.
   */
  test('a trip card renders a map preview only when the trip has coordinates', async ({
    page,
  }) => {
    await seedTrip(page, {
      name: TEST_TRIP_WITH_LOCATION.name,
      location: 'Paris, France',
      startDate: TEST_TRIP_WITH_LOCATION.startDate,
      endDate: TEST_TRIP_WITH_LOCATION.endDate,
      coordinates: PARIS_COORDINATES,
    });
    await seedTrip(page, {
      name: 'Unpinned Trip',
      location: 'Nowhere In Particular',
      startDate: TEST_TRIP_WITH_LOCATION.startDate,
      endDate: TEST_TRIP_WITH_LOCATION.endDate,
    });

    await page.goto('/trips');
    await page.waitForLoadState('load');

    // The list itself, not `waitForRoute`: this route pulls in Leaflet through
    // two lazy chunks, and on a loaded machine the dev server takes longer than
    // that helper's fixed 15 s to serve them.
    const list = page.getByRole('list', { name: /my trips/i });
    await expect(list).toBeVisible({ timeout: 30000 });

    const pinned = tripCard(page, TEST_TRIP_WITH_LOCATION.name);
    const unpinned = tripCard(page, 'Unpinned Trip');
    await expect(pinned).toHaveCount(1);
    await expect(unpinned).toHaveCount(1);

    // The preview is a lazy chunk behind a Suspense placeholder, so it arrives
    // after the card does.
    await expect(pinned.locator('.leaflet-container')).toBeVisible({ timeout: 15000 });
    // The marker is a `divIcon`, i.e. plain DOM, so this holds whether or not a
    // tile ever loads — which matters, since the tiles here are stubbed empty.
    await expect(pinned.locator('.leaflet-marker-icon')).toHaveCount(1);
    await expect(
      pinned.getByRole('button', { name: /view location on map: Paris, France/i }),
    ).toBeVisible();

    await expect(unpinned.locator('.leaflet-container')).toHaveCount(0);
  });

  /**
   * The preview is a button that opens the full map, and the two maps differ:
   * the thumbnail is `interactive={false}` and the dialog's is not. Leaflet
   * only makes a keyboard-enabled container focusable, so `tabindex` tells the
   * two apart and the assertion cannot be satisfied by the thumbnail leaking
   * into the dialog.
   */
  test('the trip card map preview expands into an interactive map dialog', async ({
    page,
  }) => {
    await seedTrip(page, {
      name: 'Map Test Trip',
      location: 'London, UK',
      startDate: TEST_TRIP_WITH_LOCATION.startDate,
      endDate: TEST_TRIP_WITH_LOCATION.endDate,
      coordinates: LONDON_COORDINATES,
    });

    await page.goto('/trips');
    await page.waitForLoadState('load');
    await waitForRoute(page);

    const preview = tripCard(page, 'Map Test Trip').getByRole('button', {
      name: /view location on map: London, UK/i,
    });
    await expect(preview).toBeVisible({ timeout: 15000 });
    await expect(preview).toHaveAttribute('aria-expanded', 'false');
    await expect(preview.locator('.leaflet-container')).not.toHaveAttribute('tabindex', '0');

    await preview.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('London, UK')).toBeVisible();
    await expect(preview).toHaveAttribute('aria-expanded', 'true');

    const expandedMap = dialog.locator('.leaflet-container');
    await expect(expandedMap).toBeVisible();
    await expect(expandedMap).toHaveAttribute('tabindex', '0');
    await expect(dialog.locator('.leaflet-marker-icon')).toHaveCount(1);
    await expect(dialog.locator('.leaflet-control-zoom')).toBeVisible();

    // The footer's Close, not the dialog chrome's — both are named "Close".
    await dialog.getByRole('button', { name: /^close$/i }).last().click();
    await expect(dialog).toHaveCount(0);
    await expect(preview).toHaveAttribute('aria-expanded', 'false');
  });
});

// ============================================================================
// Test Suite: Transport Map View
// ============================================================================

test.describe('Transport Map View', () => {
  let tripId: string;
  let personId: string;

  test.beforeEach(async ({ page }) => {
    await clearIndexedDB(page);

    // Mock external tile & geocoding requests
    await page.route('**/tile.openstreetmap.org/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }),
    );
    await page.route('**/nominatim.openstreetmap.org/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    await page.goto('/');
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // Create a trip
    // Seeded, not driven through the form. Both because the form is not the
    // subject here, and because the rows have to land before the trip becomes
    // current — see `seedPerson`.
    tripId = (
      await seedTrip(page, { name: 'Transport Map Trip', ...SEEDED_TRIP_DATES })
    ).tripId;
    personId = await seedPerson(page, tripId, 'Test Person');
  });

  test('transport list page has map view button', async ({ page }, testInfo) => {
    /**
     * Desktop only, and deliberately so rather than quietly widened.
     *
     * `TransportListPage` renders "Map view" inside a `hidden sm:flex` header
     * and offers no mobile equivalent — the mobile FAB only adds a transport.
     * So on the Pixel 5 viewport there is genuinely no way to reach the
     * transport map, and asserting the button here would encode that product
     * gap as a test failure instead of naming it.
     */
    test.skip(
      testInfo.project.name === 'Mobile Chrome',
      'No mobile affordance exists for the transport map (header button is `hidden sm:flex`).',
    );

    await page.goto(`/trips/${tripId}/transports`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // Look for the map view button/toggle
    const mapViewButton = page.getByRole('button', { name: /map|carte/i }).or(
      page.getByRole('link', { name: /map|carte/i })
    );

    await expect(mapViewButton).toBeVisible();
  });

  /**
   * A transport with no coordinates is still a transport, so it is seeded here:
   * otherwise "no locations on the map" would also be what an empty trip shows,
   * and the test would not distinguish the two.
   *
   * The assertion this replaces was `page.content()` containing 'location' or
   * 'transport' or 'map' — satisfied by the nav, the `<title>` and half the
   * Tailwind classes on the page. AGENTS.md records that exact assertion
   * passing against a page correctly showing "No locations on the map yet".
   */
  test('transport map page shows empty state when no transports have coordinates', async ({
    page,
  }) => {
    await seedTransport(page, {
      tripId,
      personId,
      type: 'arrival',
      datetime: SEEDED_TRANSPORT_DATETIME,
      location: 'Gare du Nord',
    });

    await page.goto(`/trips/${tripId}/transports/map`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    await expect(
      page.getByRole('heading', { name: /no locations on the map yet/i }),
    ).toBeVisible();
    await expect(
      page.getByText(/add a location to transport entries/i),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /back to list|retour à la liste/i }),
    ).toBeVisible();

    // And no map: the empty state replaces it rather than sitting beside it.
    await expect(page.locator('.leaflet-container')).toHaveCount(0);
  });

  /**
   * The listeners are attached before the navigation they observe, and the map
   * has to actually be on screen before the "no errors" claim means anything —
   * a page that rendered nothing also emits no errors.
   */
  test('transport map page loads without errors', async ({ page }) => {
    await seedTransport(page, {
      tripId,
      personId,
      type: 'arrival',
      datetime: SEEDED_TRANSPORT_DATETIME,
      location: 'Paris Charles de Gaulle',
      coordinates: SEEDED_TRANSPORT_COORDINATES,
    });

    const errors = collectErrors(page);

    await page.goto(`/trips/${tripId}/transports/map`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // Vacuity guard: the map, and the marker on it, really rendered.
    await expect(page.locator('.leaflet-container')).toBeVisible();
    await expect(page.locator('.leaflet-marker-icon')).toHaveCount(1);

    // Leaflet does its sizing and tile work on a later frame; give the async
    // half of the page a chance to throw before declaring it clean.
    await page.waitForTimeout(1000);

    expect(errors.uncaught).toEqual([]);
    expect(errors.console).toEqual([]);
  });

  test('navigating from list view to map view works', async ({ page }, testInfo) => {
    // Same product gap as `transport list page has map view button` above: the
    // header button is `hidden sm:flex` and there is no mobile equivalent.
    test.skip(
      testInfo.project.name === 'Mobile Chrome',
      'No mobile affordance exists for the transport map (header button is `hidden sm:flex`).',
    );

    await seedTransport(page, {
      tripId,
      personId,
      type: 'arrival',
      datetime: SEEDED_TRANSPORT_DATETIME,
      location: 'Paris Charles de Gaulle',
      coordinates: SEEDED_TRANSPORT_COORDINATES,
    });

    await page.goto(`/trips/${tripId}/transports`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // Unconditional. Wrapped in `if (await button.isVisible())`, this whole
    // body was skipped whenever the button was missing — which is the one
    // failure the test exists to catch.
    const mapViewButton = page.getByRole('button', { name: /^map view$/i });
    await expect(mapViewButton).toBeVisible();
    await mapViewButton.click();

    await page.waitForURL(new RegExp(`/trips/${tripId}/transports/map$`), {
      timeout: 5000,
    });
    await waitForRoute(page);

    // The destination, not just its URL: the map, its marker, and the control
    // that goes back the other way.
    await expect(page.locator('.leaflet-container')).toBeVisible();
    await expect(page.locator('.leaflet-marker-icon')).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^list view$/i })).toBeVisible();
  });
});

// ============================================================================
// Test Suite: Transport Map Legend
// ============================================================================

/**
 * The legend describes the pins by colour, and the two lived in different
 * places: the swatches painted themselves from a theme token while the pins
 * interpolated a hex literal into the inline style of a Leaflet `divIcon`. They
 * agreed only because Tailwind's `green-500` happens to be the `#22c55e`
 * somebody typed — an agreement no test could see, that no stylesheet could
 * keep across `.dark`, and that one edit to the token would have ended
 * silently.
 *
 * Both sides now resolve the same custom property, which only a browser can
 * confirm: a unit test sees class names, and two different class names can
 * still resolve to one colour (or, worse, one class name to two). So this reads
 * `backgroundColor` back off both elements, in both themes.
 *
 * The pins are seeded against a person that does not exist. `TransportMapPage`
 * passes `color: person?.color` and `Person.color` is required, so a transport
 * whose person row is present is painted that person's colour and the legend
 * describes nothing on screen — the type colour only surfaces on the
 * missing-person path the `?.` is written for. That is a product question
 * beyond this test; what it does mean is that the honest way to exercise the
 * legend's own colours is the path that actually uses them.
 */
test.describe('Transport Map Legend', () => {
  /** A person id with no row behind it, so the pins fall back to type colours. */
  const ORPHANED_PERSON = 'person-does-not-exist';

  /** `[legend swatch, pin]` background colours, as the browser resolves them. */
  type SwatchAndPin = readonly [string, string];

  async function readColours(
    page: Page,
    tone: 'arrival' | 'departure',
    markerType: 'transport' | 'pickup',
  ): Promise<SwatchAndPin> {
    const swatch = page.locator(`[data-testid="map-legend-swatch-${tone}"]`);
    const pin = page.locator(`[data-marker-type="${markerType}"]`);

    await expect(swatch).toBeVisible();
    await expect(pin.first()).toBeVisible();

    return [
      await swatch.evaluate((el) => getComputedStyle(el).backgroundColor),
      await pin.first().evaluate((el) => getComputedStyle(el).backgroundColor),
    ] as const;
  }

  async function openMapInTheme(
    page: Page,
    tripId: string,
    theme: 'light' | 'dark',
  ): Promise<void> {
    await page.evaluate((value) => localStorage.setItem('theme', value), theme);
    await page.goto(`/trips/${tripId}/transports/map`);
    await page.waitForLoadState('load');
    await waitForRoute(page);
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.classList.contains('dark')),
      )
      .toBe(theme === 'dark');
  }

  let tripId: string;

  test.beforeEach(async ({ page }) => {
    await clearIndexedDB(page);

    await page.route('**/tile.openstreetmap.org/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }),
    );
    await page.route('**/basemaps.cartocdn.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }),
    );

    await page.goto('/');
    await page.waitForLoadState('load');
    await waitForRoute(page);

    tripId = (
      await seedTrip(page, { name: 'Legend Trip', ...SEEDED_TRIP_DATES })
    ).tripId;

    // One of each, so both legend rows have something to describe.
    await seedTransport(page, {
      tripId,
      personId: ORPHANED_PERSON,
      type: 'arrival',
      datetime: '2026-07-15T10:00:00+02:00',
      location: 'CDG Terminal 2',
      coordinates: SEEDED_TRANSPORT_COORDINATES,
    });
    await seedTransport(page, {
      tripId,
      personId: ORPHANED_PERSON,
      type: 'departure',
      datetime: '2026-07-20T18:00:00+02:00',
      location: 'Gare de Lyon',
      coordinates: { lat: 48.8443, lon: 2.3743 },
    });
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`arrival pins are the colour the legend says, in ${theme} mode`, async ({
      page,
    }) => {
      await openMapInTheme(page, tripId, theme);
      const [swatch, pin] = await readColours(page, 'arrival', 'transport');

      expect(pin).toBe(swatch);
      // A pin that failed to resolve its token would be transparent and this
      // would pass against itself.
      expect(pin).not.toBe('rgba(0, 0, 0, 0)');
    });

    test(`departure pins are the colour the legend says, in ${theme} mode`, async ({
      page,
    }) => {
      await openMapInTheme(page, tripId, theme);
      const [swatch, pin] = await readColours(page, 'departure', 'pickup');

      expect(pin).toBe(swatch);
      expect(pin).not.toBe('rgba(0, 0, 0, 0)');
    });
  }

  test('arrival and departure stay distinguishable from each other', async ({
    page,
  }) => {
    await openMapInTheme(page, tripId, 'light');
    const [, arrival] = await readColours(page, 'arrival', 'transport');
    const [, departure] = await readColours(page, 'departure', 'pickup');

    expect(arrival).not.toBe(departure);
  });

  /**
   * The point of the whole conversion. An inline `background-color` is frozen
   * at the moment the `divIcon` is built; a class is live, so the same pin
   * repaints when the theme changes. If this ever comes back equal, somebody
   * has put a literal colour back into the icon HTML.
   */
  test('pins and swatches both repaint when the theme changes', async ({ page }) => {
    await openMapInTheme(page, tripId, 'light');
    const light = await readColours(page, 'arrival', 'transport');

    await openMapInTheme(page, tripId, 'dark');
    const dark = await readColours(page, 'arrival', 'transport');

    expect(dark[0]).not.toBe(light[0]);
    expect(dark[1]).not.toBe(light[1]);
  });

  /**
   * Colour is never the only carrier of meaning here: the two rows are also
   * labelled, and each pin carries the person, the direction and the place in
   * its tooltip and popup.
   *
   * Scoped to the legend rather than the page, or deleting both labels would
   * still pass on any other element that says "arrivals" — the transport list's
   * own counters do. And matched in both languages, because `DEFAULT_LANGUAGE`
   * is `fr` and detection reads the browser: an English-only regex asserts the
   * developer's locale, not the app's behaviour.
   */
  test('the legend labels its swatches in words', async ({ page }) => {
    await openMapInTheme(page, tripId, 'light');

    const legend = page.getByTestId('map-legend');
    await expect(legend).toBeVisible();
    await expect(legend).toContainText(/arrivals|arriv[ée]es/i);
    await expect(legend).toContainText(/departures|d[ée]parts/i);
  });
});

// ============================================================================
// Test Suite: Directions Button
// ============================================================================

test.describe('Directions Button', () => {
  test('directions button opens external maps app', async ({ page }) => {
    // Mock external tile requests
    await page.route('**/tile.openstreetmap.org/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }),
    );

    // Record `window.open` rather than letting it happen.
    //
    // The previous version waited for a real popup and read its `url()`, with
    // every step wrapped in `.catch(() => null)` — so when the button was
    // absent, which is the failure it exists to catch, zero assertions ran. It
    // also could not have worked: `window.open` to google.com must not be a
    // thing this suite does, and a fresh popup reports `about:blank` until it
    // commits.
    await page.addInitScript(() => {
      const opened: string[] = [];
      (window as unknown as { __openedUrls: string[] }).__openedUrls = opened;
      window.open = (url?: string | URL): Window | null => {
        opened.push(String(url));
        return null;
      };
    });

    await clearIndexedDB(page);
    await page.goto('/');
    await page.waitForLoadState('load');
    await waitForRoute(page);

    const { tripId } = await seedTrip(page, {
      name: 'Directions Test Trip',
      ...SEEDED_TRIP_DATES,
    });
    const personId = await seedPerson(page, tripId, 'Traveler');
    await seedTransport(page, {
      tripId,
      personId,
      type: 'arrival',
      datetime: SEEDED_TRANSPORT_DATETIME,
      location: 'Paris Charles de Gaulle',
      coordinates: SEEDED_TRANSPORT_COORDINATES,
    });

    await page.goto(`/trips/${tripId}/transports/map`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // The button lives inside the marker's popup, so the marker has to be
    // opened first.
    const marker = page.locator('.leaflet-marker-icon');
    await expect(marker).toHaveCount(1);
    await marker.click();

    const directionsButton = page.getByRole('button', {
      name: /get directions|itinéraire/i,
    });
    await expect(directionsButton).toBeVisible();
    await directionsButton.click();

    const opened = await page.evaluate(
      () => (window as unknown as { __openedUrls: string[] }).__openedUrls,
    );
    expect(opened).toHaveLength(1);

    // The destination is the assertion: a maps URL pointing anywhere else is
    // exactly as useless as no URL at all.
    const target = new URL(opened[0] ?? '');
    expect(`${target.origin}${target.pathname}`).toBe('https://www.google.com/maps/dir/');
    expect(target.searchParams.get('destination')).toBe(
      `${SEEDED_TRANSPORT_COORDINATES.lat},${SEEDED_TRANSPORT_COORDINATES.lon}`,
    );
  });
});

// ============================================================================
// Test Suite: Map Accessibility
// ============================================================================

test.describe('Map Accessibility', () => {
  test('map has proper ARIA attributes', async ({ page }) => {
    await clearIndexedDB(page);
    await page.route('**/tile.openstreetmap.org/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }),
    );

    const { tripId } = await seedTrip(page, {
      name: 'Accessibility Test Trip',
      ...SEEDED_TRIP_DATES,
    });
    const personId = await seedPerson(page, tripId, 'Map A11y Person');
    await seedTransport(page, {
      tripId,
      personId,
      type: 'arrival',
      datetime: SEEDED_TRANSPORT_DATETIME,
      location: 'Paris Charles de Gaulle',
      coordinates: SEEDED_TRANSPORT_COORDINATES,
    });

    await page.goto(`/trips/${tripId}/transports/map`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // Assert the map is there and named, rather than `typeof x === 'boolean'`,
    // which held whether or not a map had rendered.
    const mapContainer = page.locator('[role="application"]').first();
    await expect(mapContainer).toBeVisible();
    await expect(mapContainer).toHaveAttribute('aria-label', /.+/);

    // The live region that tells a screen reader how much is on the map has to
    // agree with what is on it.
    await expect(mapContainer.getByText(/1 location on map/i)).toBeAttached();
  });

  /**
   * "Navigable" means a keyboard can reach a marker and act on it, which is
   * what is asserted: the container takes focus, the marker takes focus, and
   * Enter on the focused marker opens its details.
   *
   * The previous version ended in `expect(typeof isFocused).toBe('boolean')`,
   * inside `if (await mapContainer.isVisible())` — so it asserted nothing when
   * the map rendered and ran nothing at all when it did not.
   */
  test('map markers are keyboard navigable', async ({ page }) => {
    await clearIndexedDB(page);
    await page.route('**/tile.openstreetmap.org/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }),
    );

    const { tripId } = await seedTrip(page, {
      name: 'Keyboard Nav Trip',
      ...SEEDED_TRIP_DATES,
    });
    const personId = await seedPerson(page, tripId, 'Map Keyboard Person');
    await seedTransport(page, {
      tripId,
      personId,
      type: 'arrival',
      datetime: SEEDED_TRANSPORT_DATETIME,
      location: 'Paris Charles de Gaulle',
      coordinates: SEEDED_TRANSPORT_COORDINATES,
    });

    await page.goto(`/trips/${tripId}/transports/map`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // Leaflet only makes the container focusable when its keyboard handler is
    // enabled, which `MapView` ties to `interactive`.
    const leafletContainer = page.locator('.leaflet-container');
    await expect(leafletContainer).toBeVisible();
    await expect(leafletContainer).toHaveAttribute('tabindex', '0');

    const marker = page.locator('.leaflet-marker-icon');
    await expect(marker).toHaveCount(1);
    await expect(marker).toHaveAttribute('tabindex', '0');
    await expect(marker).toHaveAttribute('role', 'button');

    // Tab out of the map container lands on the marker — that is what makes it
    // reachable at all, and it is not something the markup can be assumed to
    // give for free.
    await leafletContainer.focus();
    await page.keyboard.press('Tab');
    await expect(marker).toBeFocused();

    await pressEnterWithKeypress(page);

    const popup = page.getByRole('dialog', { name: /details for/i });
    await expect(popup).toBeVisible();
    await expect(popup.getByText('Paris Charles de Gaulle')).toBeVisible();
  });
});

// ============================================================================
// Test Suite: Map Error Handling
// ============================================================================

test.describe('Map Error Handling', () => {
  /**
   * "Gracefully" is spelled out: the transports whose coordinates are not a
   * point on Earth are dropped, the one that is survives, and nothing throws.
   *
   * The previous version seeded no transports at all — so there were no
   * coordinates, valid or otherwise — asserted `body` was visible, and attached
   * its `pageerror` listener *after* the navigation, which is the only place an
   * error could have come from.
   */
  test('handles invalid coordinates gracefully', async ({ page }) => {
    await clearIndexedDB(page);
    await page.route('**/tile.openstreetmap.org/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }),
    );

    const { tripId } = await seedTrip(page, {
      name: 'Error Test Trip',
      ...SEEDED_TRIP_DATES,
    });
    const personId = await seedPerson(page, tripId, 'Coordinate Tester');

    await seedTransport(page, {
      tripId,
      personId,
      type: 'arrival',
      datetime: SEEDED_TRANSPORT_DATETIME,
      location: 'Paris Charles de Gaulle',
      coordinates: SEEDED_TRANSPORT_COORDINATES,
    });
    // NaN survives a structured clone, so this is what a half-parsed geocode
    // actually looks like in IndexedDB.
    await seedTransport(page, {
      tripId,
      personId,
      type: 'departure',
      datetime: SEEDED_TRANSPORT_DATETIME,
      location: 'Not A Number Station',
      coordinates: { lat: Number.NaN, lon: Number.NaN },
    });
    // Numeric, finite, and nowhere: past the `isNaN` guard but off the globe.
    await seedTransport(page, {
      tripId,
      personId,
      type: 'departure',
      datetime: SEEDED_TRANSPORT_DATETIME,
      location: 'Out Of Range Station',
      coordinates: { lat: 999, lon: 999 },
    });

    const errors = collectErrors(page);

    await page.goto(`/trips/${tripId}/transports/map`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    await expect(page.locator('.leaflet-container')).toBeVisible();

    // Exactly one pin, and it is the only one that names a real place.
    const markers = page.locator('.leaflet-marker-icon');
    await expect(markers).toHaveCount(1);
    await expect(markers).toHaveAttribute('title', /Paris Charles de Gaulle/);

    await page.waitForTimeout(1000);
    expect(errors.uncaught).toEqual([]);
  });

});

// ============================================================================
// Test Suite: Maps under modal dialogs
// ============================================================================

/**
 * Trips pinned on the map, so the list renders a preview on every card.
 */
const MAPPED_TRIPS = [
  {
    name: 'Stacking Trip Paris',
    location: 'Paris, France',
    startDate: fixtureDate(1),
    endDate: fixtureDate(10),
    coordinates: { lat: 48.8566, lon: 2.3522 },
  },
  {
    name: 'Stacking Trip Lisbon',
    location: 'Lisbon, Portugal',
    startDate: fixtureDate(1, 3),
    endDate: fixtureDate(8, 3),
    coordinates: { lat: 38.7223, lon: -9.1393 },
  },
] as const;

/**
 * A map element hit-tested at its own centre, and whatever the browser found
 * painted on top of it there.
 */
interface StackingProbe {
  /** The map element that was probed, named for the failure message. */
  readonly probe: string;
  /** The topmost element at that point. */
  readonly hit: string;
  /** Whether that topmost element belongs to a map. */
  readonly hitsMap: boolean;
}

test.describe('Maps under modal dialogs', () => {
  test.beforeEach(async ({ page }) => {
    // Tiles and geocoding never leave the browser: this suite must not depend
    // on OpenStreetMap being reachable, or on how fast it answers.
    await page.route('**/tile.openstreetmap.org/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }),
    );
    await page.route('**/nominatim.openstreetmap.org/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    await page.goto('/');
    await page.waitForLoadState('load');
    await clearIndexedDB(page);
  });

  /**
   * Leaflet numbers its own layers from 200 (tiles) up to 1000 (controls), and
   * the dialog sits at 50. Those two scales only ever meet if the map container
   * fails to contain its own — which is what happened: opening the share dialog
   * on the trips list left every trip's map painted on top of it.
   *
   * Markers are the probe rather than tiles because they are plain DOM
   * (`divIcon`), so the assertion holds whether or not a tile ever loads.
   */
  test('the share dialog covers the trip maps, not the other way round', async ({
    page,
  }) => {
    for (const trip of MAPPED_TRIPS) {
      await seedTrip(page, trip);
    }

    await page.goto('/trips');
    await page.waitForLoadState('load');

    // Card previews are lazy; wait for the markers the assertion probes.
    await expect(page.locator('.leaflet-marker-icon').first()).toBeVisible({
      timeout: 15000,
    });

    await page.getByRole('button', { name: /share trip/i }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 });
    // `toBeVisible` resolves the moment the dialog is laid out, which is the
    // start of its 200 ms open animation. Probe the resting state instead.
    await page.waitForTimeout(500);

    const probes = await page.evaluate((): StackingProbe[] => {
      const describe = (element: Element | null): string => {
        if (element === null) {
          return '<nothing>';
        }
        const classes = element.getAttribute('class');
        const suffix = classes === null ? '' : '.' + classes.trim().split(/\s+/).join('.');
        return element.tagName.toLowerCase() + suffix;
      };

      const results: StackingProbe[] = [];
      // Markers and controls are the map's own DOM, and both carry a real box.
      const targets = document.querySelectorAll('.leaflet-marker-icon, .leaflet-control');

      for (const target of targets) {
        const rect = target.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          continue;
        }
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
          continue;
        }

        const hit = document.elementFromPoint(x, y);
        results.push({
          probe: describe(target),
          hit: describe(hit),
          hitsMap: hit !== null && hit.closest('.leaflet-container') !== null,
        });
      }

      return results;
    });

    // Guard against a vacuous pass: with no map on screen there is nothing to
    // cover, and the assertion below would hold for the wrong reason.
    expect(probes.length).toBeGreaterThan(0);
    expect(probes.filter((probe) => probe.hitsMap)).toEqual([]);
  });
});
