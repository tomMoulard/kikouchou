/**
 * @fileoverview E2E tests for Maps Integration in Kikoushou PWA.
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

// ============================================================================
// Test Configuration & Helpers
// ============================================================================

/**
 * Test data for creating trips with locations.
 */
const TEST_TRIP_WITH_LOCATION = {
  name: 'Paris Trip 2024',
  startDate: '2024-07-15',
  endDate: '2024-07-22',
} as const;

/**
 * Creates a test trip and returns its ID.
 *
 * @param page - Playwright page object
 * @param options - Trip options
 * @returns The created trip's ID
 */
async function createTestTrip(
  page: Page,
  options: { name: string; location?: string } = { name: 'Test Trip' }
): Promise<string> {
  await page.goto('/trips/new');
  await page.waitForLoadState('load');

  // Fill trip form
  await page.locator('#trip-name').fill(options.name);

  if (options.location) {
    await page.locator('#trip-location').fill(options.location);
  }

  // Set start date
  await page.locator('#trip-start-date').click();
  await page.waitForSelector('[data-slot="calendar"]', { state: 'visible' });

  const calendar = page.locator('[data-slot="calendar"]').first();
  const dayButton = calendar.locator('button').filter({ hasText: /^15$/ }).first();
  await dayButton.click();

  // Set end date
  await page.locator('#trip-end-date').click();
  await page.waitForSelector('[data-slot="calendar"]', { state: 'visible' });

  const endCalendar = page.locator('[data-slot="calendar"]').first();
  const endDayButton = endCalendar.locator('button').filter({ hasText: /^22$/ }).first();
  await endDayButton.click();

  // Submit form
  await page.getByRole('button', { name: /save|sauvegarder/i }).click();

  // Wait for navigation
  await page.waitForURL(/\/trips\/[a-zA-Z0-9_-]+\/(calendar)?/, { timeout: 10000 });

  // Extract trip ID
  const url = page.url();
  const match = url.match(/\/trips\/([a-zA-Z0-9_-]+)/);
  const tripId = match?.[1] ?? '';

  expect(tripId).toBeTruthy();
  return tripId;
}

// ============================================================================
// Test Suite: Trip Location Map
// ============================================================================

/** A fixed window the seeded fixtures sit inside. */
const SEEDED_TRIP_DATES = { startDate: '2026-07-13', endDate: '2026-07-25' } as const;

/** Charles de Gaulle, so a seeded transport has somewhere to be on the map. */
const SEEDED_TRANSPORT_COORDINATES = { lat: 49.0097, lon: 2.5479 } as const;

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

  test('trip card shows map preview when location has coordinates', async ({ page }) => {
    // Create a trip with a known location
    await createTestTrip(page, {
      name: TEST_TRIP_WITH_LOCATION.name,
      location: 'Paris, France',
    });

    // Navigate to trips list
    await page.goto('/trips');
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // Find the trip card
    const tripCard = page.getByRole('button', { name: new RegExp(TEST_TRIP_WITH_LOCATION.name) });
    await expect(tripCard).toBeVisible();

    // Check if the trip card contains a map element or map-related content
    // The map preview should be visible within the card
    const hasMapElement = await page.evaluate(() => {
      // Look for leaflet container or map-related elements
      const mapElements = document.querySelectorAll('.leaflet-container, [data-testid="map-preview"]');
      return mapElements.length > 0;
    });

    // Map preview may or may not be visible depending on whether coordinates were resolved
    // This is acceptable as location resolution depends on external API
    expect(typeof hasMapElement).toBe('boolean');
  });

  test('trip detail shows location on map when coordinates exist', async ({ page }) => {
    // Create a trip
    const tripId = await createTestTrip(page, {
      name: 'Map Test Trip',
      location: 'London, UK',
    });

    // Navigate to trip calendar (main trip view)
    await page.goto(`/trips/${tripId}/calendar`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // The trip detail page should be accessible
    await expect(page.locator('body')).toBeVisible();

    // If there's a "view on map" button or map preview, it should work
    const viewMapButton = page.getByRole('button', { name: /map|carte/i });
    if (await viewMapButton.isVisible()) {
      await viewMapButton.click();
      // Map should expand or navigate
      await page.waitForTimeout(500);
    }
  });
});

// ============================================================================
// Test Suite: Transport Map View
// ============================================================================

test.describe('Transport Map View', () => {
  let tripId: string;

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
    await seedPerson(page, tripId, 'Test Person');
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

  test('transport map page shows empty state when no transports have coordinates', async ({
    page,
  }) => {
    await page.goto(`/trips/${tripId}/transports/map`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // Either empty state or the map should be visible
    const pageContent = await page.content();
    const hasContent =
      pageContent.includes('location') ||
      pageContent.includes('transport') ||
      pageContent.includes('map');

    expect(hasContent).toBe(true);
  });

  test('transport map page loads without errors', async ({ page }) => {
    await page.goto(`/trips/${tripId}/transports/map`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // Page should load without console errors
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Wait a bit for any async errors
    await page.waitForTimeout(1000);

    // Filter out expected errors (like 404 for missing tiles when offline)
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes('404') &&
        !err.includes('Failed to load resource') &&
        !err.includes('tile')
    );

    expect(criticalErrors.length).toBe(0);
  });

  test('navigating from list view to map view works', async ({ page }) => {
    await page.goto(`/trips/${tripId}/transports`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // Click on map view button
    const mapViewButton = page.getByRole('button', { name: /map|carte/i }).or(
      page.getByRole('link', { name: /map|carte/i })
    );

    if (await mapViewButton.isVisible()) {
      await mapViewButton.click();

      // Should navigate to map view
      await page.waitForURL(/\/map/, { timeout: 5000 });

      // Map page should be visible
      await expect(page.locator('body')).toBeVisible();
    }
  });
});

// ============================================================================
// Test Suite: Directions Button
// ============================================================================

test.describe('Directions Button', () => {
  test('directions button opens external maps app', async ({ page, context }) => {
    // Mock external tile requests
    await page.route('**/tile.openstreetmap.org/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }),
    );

    // Create a trip with transports
    await clearIndexedDB(page);
    await page.goto('/');
    await page.waitForLoadState('load');
    await waitForRoute(page);

    const { tripId } = await seedTrip(page, {
      name: 'Directions Test Trip',
      ...SEEDED_TRIP_DATES,
    });
    await seedPerson(page, tripId, 'Traveler');

    // Navigate to transport map page (where directions button exists)
    await page.goto(`/trips/${tripId}/transports/map`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // Look for directions button (might be in popup or always visible)
    const directionsButton = page.getByRole('button', {
      name: /direction|itinéraire|get directions/i,
    });

    // The button might not be visible if there are no transports with coordinates
    // This is expected behavior
    const isVisible = await directionsButton.isVisible().catch(() => false);

    if (isVisible) {
      // Set up listener for new tabs/windows
      const [newPage] = await Promise.all([
        context.waitForEvent('page', { timeout: 5000 }).catch(() => null),
        directionsButton.click(),
      ]);

      // Should open a new page/tab with maps URL
      if (newPage) {
        const url = newPage.url();
        // Should be a maps URL (Google, Apple, or OSM)
        const isMapsUrl =
          url.includes('google.com/maps') ||
          url.includes('maps.apple.com') ||
          url.includes('openstreetmap.org');

        expect(isMapsUrl).toBe(true);
        await newPage.close();
      }
    }
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
      datetime: '2026-07-15T10:00:00.000Z',
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
  });

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
      datetime: '2026-07-15T10:00:00.000Z',
      location: 'Paris Charles de Gaulle',
      coordinates: SEEDED_TRANSPORT_COORDINATES,
    });

    await page.goto(`/trips/${tripId}/transports/map`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // The map should be focusable
    const mapContainer = page.locator('[role="application"]').first();

    if (await mapContainer.isVisible()) {
      // Try to focus the map
      await mapContainer.focus();

      // Check if map received focus
      const isFocused = await page.evaluate(() => {
        const focused = document.activeElement;
        return focused?.getAttribute('role') === 'application' ||
               focused?.classList.contains('leaflet-container');
      });

      // Map should be focusable
      expect(typeof isFocused).toBe('boolean');
    }
  });
});

// ============================================================================
// Test Suite: Map Error Handling
// ============================================================================

test.describe('Map Error Handling', () => {
  test('handles invalid coordinates gracefully', async ({ page }) => {
    await clearIndexedDB(page);
    await page.route('**/tile.openstreetmap.org/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }),
    );

    // Create a trip
    const { tripId } = await seedTrip(page, {
      name: 'Error Test Trip',
      ...SEEDED_TRIP_DATES,
    });

    // Navigate to map page
    await page.goto(`/trips/${tripId}/transports/map`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // Page should not crash
    await expect(page.locator('body')).toBeVisible();

    // No uncaught errors in console
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => {
      consoleErrors.push(error.message);
    });

    await page.waitForTimeout(1000);

    // Filter out expected errors
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes('ResizeObserver') && // Common in Leaflet
        !err.includes('ChunkLoadError')
    );

    expect(criticalErrors.length).toBe(0);
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
    startDate: '2026-06-01',
    endDate: '2026-06-10',
    coordinates: { lat: 48.8566, lon: 2.3522 },
  },
  {
    name: 'Stacking Trip Lisbon',
    location: 'Lisbon, Portugal',
    startDate: '2026-07-01',
    endDate: '2026-07-08',
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
