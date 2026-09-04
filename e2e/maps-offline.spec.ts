/**
 * @fileoverview Map caching behaviour that only exists in the production build.
 *
 * Split out of `maps-integration.spec.ts`. Those tests run against the dev
 * server, where vite-plugin-pwa registers no service worker at all — so the
 * offline reload here failed with ERR_INTERNET_DISCONNECTED, and the two cache
 * assertions passed only because they asserted `typeof value === 'boolean'`,
 * which is true whether the cache exists or not.
 *
 * @module e2e/maps-offline
 */

import { test, expect, type Page } from '@playwright/test';
import { clearIndexedDB } from './support/storage';
import { stubExternalMapServices } from './support/external-services';
import {
  waitForActivatedServiceWorker,
  waitForPrecachedAppShell,
} from './support/service-worker';

/**
 * Creates a trip through the UI and returns its id.
 */
async function createTestTrip(page: Page, name: string): Promise<string> {
  await page.goto('/trips/new');
  await page.waitForLoadState('load');

  await page.locator('#trip-name').fill(name);

  await page.locator('#trip-start-date').click();
  await page.waitForSelector('[data-slot="calendar"]', { state: 'visible' });
  await page
    .locator('[data-slot="calendar"]')
    .first()
    .locator('button')
    .filter({ hasText: /^15$/ })
    .first()
    .click();

  await page.locator('#trip-end-date').click();
  await page.waitForSelector('[data-slot="calendar"]', { state: 'visible' });
  await page
    .locator('[data-slot="calendar"]')
    .first()
    .locator('button')
    .filter({ hasText: /^22$/ })
    .first()
    .click();

  await page.getByRole('button', { name: /save|sauvegarder/i }).click();
  await page.waitForURL(/\/trips\/[a-zA-Z0-9_-]+\/(calendar)?/, { timeout: 10_000 });

  const tripId = /\/trips\/([a-zA-Z0-9_-]+)/.exec(page.url())?.[1] ?? '';
  expect(tripId).toBeTruthy();
  return tripId;
}

/** Reads the generated service worker script off the preview server. */
async function fetchServiceWorkerSource(page: Page): Promise<string> {
  const response = await page.request.get('/sw.js');
  expect(response.ok()).toBe(true);
  return await response.text();
}

test.describe('Offline Map Tiles', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load');
    await waitForActivatedServiceWorker(page);
    await waitForPrecachedAppShell(page);
  });

  /**
   * Asserts the rule, not a live fetch.
   *
   * Workbox creates a runtime cache lazily, on the first request that matches
   * its route — so `caches.keys()` only names `osm-tiles` once a real tile has
   * come back from openstreetmap.org. Asserting that would make CI depend on a
   * third-party tile server. The rule reaching the built worker is the part
   * this repo controls, so that is what is checked.
   */
  test('the service worker declares the OSM tile cache', async ({ page }) => {
    expect(await fetchServiceWorkerSource(page)).toContain('osm-tiles');
  });

  /**
   * The dark basemap is a different host from the OSM one above, so it needs
   * its own rule. Without it a dark-mode user's map is blank offline while the
   * same map works in light mode — and nothing else would notice, because
   * every existing map assertion runs in the default light theme.
   */
  test('the service worker declares the dark basemap tile cache', async ({ page }) => {
    expect(await fetchServiceWorkerSource(page)).toContain('carto-dark-tiles');
  });

  test('the service worker declares the Nominatim geocoding cache', async ({ page }) => {
    expect(await fetchServiceWorkerSource(page)).toContain('nominatim-geocoding');
  });

  test('the map page still loads when offline', async ({ page, context }) => {
    await clearIndexedDB(page);

    const tripId = await createTestTrip(page, 'Offline Test Trip');

    await page.goto(`/trips/${tripId}/transports/map`);
    await page.waitForLoadState('load');
    await waitForPrecachedAppShell(page);

    await context.setOffline(true);

    try {
      await page.reload({ waitUntil: 'domcontentloaded' });

      // The route itself, served out of the precache. `expect(body).toBeVisible()`
      // was the only assertion here and it is true of every page ever served,
      // including Chromium's own network error page — which is precisely what
      // this test exists to rule out.
      //
      // The trip has no transports, so the map page's empty state is the
      // correct offline render.
      await expect(
        page.getByRole('heading', { name: /no locations on the map yet/i }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        page.locator('main header').first().getByRole('heading', { level: 1 }),
      ).toHaveText(/map view/i);

      const pageContent = await page.content();
      expect(pageContent).not.toContain('ERR_INTERNET_DISCONNECTED');
      expect(pageContent).not.toContain('net::ERR');
    } finally {
      await context.setOffline(false);
    }
  });

  /**
   * Moved here from `maps-integration.spec.ts`, which runs against the dev
   * server. Its own comment said "with proper SW caching" — and there is no
   * service worker there, so `page.goto` while offline failed outright with
   * ERR_INTERNET_DISCONNECTED, which is the very string it asserts against.
   */
  test('the map page shows no raw network error when offline', async ({ page, context }) => {
    await stubExternalMapServices(page);
    await clearIndexedDB(page);

    const tripId = await createTestTrip(page, 'Fail Test Trip');

    await page.goto(`/trips/${tripId}/transports/map`);
    await page.waitForLoadState('load');
    await waitForPrecachedAppShell(page);

    await context.setOffline(true);

    try {
      await page.goto(`/trips/${tripId}/transports/map`);
      await page.waitForLoadState('domcontentloaded');

      // Not merely the absence of an error string: the page has to have
      // rendered. Asserting only what is *not* in `page.content()` passes on a
      // blank document too.
      await expect(
        page.getByRole('heading', { name: /no locations on the map yet/i }),
      ).toBeVisible({ timeout: 20_000 });

      const pageContent = await page.content();
      expect(pageContent).not.toContain('ERR_INTERNET_DISCONNECTED');
      expect(pageContent).not.toContain('net::ERR');
    } finally {
      await context.setOffline(false);
    }
  });
});
