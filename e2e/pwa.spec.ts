/**
 * @fileoverview E2E tests for PWA functionality in Kikouchou.
 * Tests service worker registration, offline capability, manifest validation,
 * app updates, and precaching behavior.
 *
 * Note: PWA tests require running against a production build since service workers
 * are not registered in development mode by default with VitePWA.
 * Run with: `bun run build && bun run preview` then `bun run test:e2e`
 *
 * @module e2e/pwa
 */

import { test, expect, type Page } from '@playwright/test';
import { clearIndexedDB } from './support/storage';
import {
  waitForActivatedServiceWorker,
  waitForPrecachedAppShell,
} from './support/service-worker';
import { waitForRoute } from './support/routes';
import { stubExternalMapServices } from './support/external-services';

// ============================================================================
// Test Configuration & Helpers
// ============================================================================

/**
 * Maximum time to wait for service worker to be ready.
 */
const SW_READY_TIMEOUT = 30000;

/**
 * Waits for the service worker to be registered and activated.
 *
 * @param page - Playwright page object
 * @returns Service worker registration info
 */
async function waitForServiceWorker(page: Page): Promise<{
  active: boolean;
  state: string | null;
  scriptURL: string | null;
}> {
  return await page.evaluate(async (timeout) => {
    // Wait for service worker to be ready (with timeout to prevent hanging)
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeout)),
    ]);

    if (!registration) {
      return { active: false, state: 'timeout', scriptURL: null };
    }

    return {
      active: !!registration.active,
      state: registration.active?.state ?? null,
      scriptURL: registration.active?.scriptURL ?? null,
    };
  }, SW_READY_TIMEOUT);
}

/**
 * Gets detailed service worker registration info.
 *
 * @param page - Playwright page object
 * @returns Detailed SW registration status
 */
async function getServiceWorkerInfo(page: Page): Promise<{
  hasServiceWorker: boolean;
  registrations: Array<{
    scope: string;
    updateViaCache: string;
    installing: boolean;
    waiting: boolean;
    active: boolean;
    activeState: string | null;
  }>;
}> {
  return await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) {
      return { hasServiceWorker: false, registrations: [] };
    }

    const registrations = await navigator.serviceWorker.getRegistrations();

    return {
      hasServiceWorker: true,
      registrations: registrations.map((reg) => ({
        scope: reg.scope,
        updateViaCache: reg.updateViaCache,
        installing: !!reg.installing,
        waiting: !!reg.waiting,
        active: !!reg.active,
        activeState: reg.active?.state ?? null,
      })),
    };
  });
}

/**
 * Gets cache storage information.
 *
 * @param page - Playwright page object
 * @returns Cache storage details
 */
async function getCacheInfo(page: Page): Promise<{
  cacheNames: string[];
  cacheEntries: Record<string, string[]>;
}> {
  return await page.evaluate(async () => {
    if (!('caches' in window)) {
      return { cacheNames: [], cacheEntries: {} };
    }

    const cacheNames = await caches.keys();
    const cacheEntries: Record<string, string[]> = {};

    for (const cacheName of cacheNames) {
      const cache = await caches.open(cacheName);
      const requests = await cache.keys();
      cacheEntries[cacheName] = requests.map((req) => req.url);
    }

    return { cacheNames, cacheEntries };
  });
}

/**
 * Checks if a specific URL is cached.
 *
 * @param page - Playwright page object
 * @param urlPattern - URL pattern to search for (partial match)
 * @returns Whether the URL is found in any cache
 */
async function isUrlCached(page: Page, urlPattern: string): Promise<boolean> {
  return await page.evaluate(async (pattern) => {
    if (!('caches' in window)) {
      return false;
    }

    const cacheNames = await caches.keys();

    for (const cacheName of cacheNames) {
      const cache = await caches.open(cacheName);
      const requests = await cache.keys();

      for (const request of requests) {
        if (request.url.includes(pattern)) {
          return true;
        }
      }
    }

    return false;
  }, urlPattern);
}

/**
 * The URLs workbox was told to precache, read back out of the built worker.
 *
 * `precacheAndRoute([...])` is where `self.__WB_MANIFEST` ends up after the
 * build substitutes it, so this is the build's own list of what must be
 * available offline — not a number written down in a test and left to rot. The
 * keys are unquoted (`{url:"index.html",revision:"..."}`), which is why this is
 * a regex over the source rather than a `JSON.parse`.
 *
 * @param serviceWorkerSource - The text of the built `sw.js`
 * @returns Every precached URL, relative to the app's base
 */
function parsePrecacheManifest(serviceWorkerSource: string): string[] {
  return [...serviceWorkerSource.matchAll(/\{url:"([^"]+)",revision:/g)].map(
    (match) => match[1] ?? '',
  );
}

/**
 * Every URL currently held in any cache, reduced to its pathname.
 *
 * Revisioned precache entries are stored with a `__WB_REVISION__` query
 * parameter, so comparing full URLs against the manifest would never match.
 *
 * @param page - Playwright page object
 * @returns The set of cached pathnames
 */
async function getCachedPathnames(page: Page): Promise<Set<string>> {
  const { cacheEntries } = await getCacheInfo(page);

  return new Set(
    Object.values(cacheEntries)
      .flat()
      .map((url) => new URL(url).pathname),
  );
}

/**
 * Creates a test trip and returns its ID.
 * Used to test offline data access.
 *
 * @param page - Playwright page object
 * @returns The created trip's ID
 */
async function createTestTrip(page: Page): Promise<string> {
  // Before the form loads: the location field debounces into a live Nominatim
  // search, and its suggestion popover renders over the date pickers and eats
  // the click on the day cell.
  await stubExternalMapServices(page);

  await page.goto('/trips/new');
  await page.waitForLoadState('load');

  // Fill trip form.
  //
  // No location, deliberately. Nothing here asserts one — it was set and never
  // read — and typing into that field opens a suggestion popper anchored over
  // the date buttons below it, which then swallows the click on the day cell:
  // "<span …>Location de matériel, Avenue Vulcain…</span> intercepts pointer
  // events".
  //
  // The Nominatim stub above does not prevent that in *this* project. It is the
  // production build, so a service worker controls the page, and `page.route`
  // never sees a request the worker makes — the search goes to the live network
  // and comes back with real places. Which is also why the failure only shows
  // up once an earlier test has installed the worker.
  await page.locator('#trip-name').fill('PWA Test Trip');

  // Set start date
  await page.locator('#trip-start-date').click();
  await page.waitForSelector('[data-slot="calendar"]', { state: 'visible' });

  // Select a day in the current month
  const calendar = page.locator('[data-slot="calendar"]').first();
  const dayButton = calendar.locator('button').filter({ hasText: /^15$/ }).first();
  await dayButton.click();

  // Set end date
  await page.locator('#trip-end-date').click();
  await page.waitForSelector('[data-slot="calendar"]', { state: 'visible' });

  const endCalendar = page.locator('[data-slot="calendar"]').first();
  const endDayButton = endCalendar.locator('button').filter({ hasText: /^20$/ }).first();
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
// Test Suite: Service Worker Registration
// ============================================================================

test.describe('Service Worker Registration', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any existing service workers and caches for a clean test
    await page.goto('/');
    await page.evaluate(async () => {
      // Unregister all service workers
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
      }

      // Clear all caches
      const cacheNames = await caches.keys();
      for (const cacheName of cacheNames) {
        await caches.delete(cacheName);
      }
    });
  });

  test('service worker is registered after page load', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load');

    await waitForActivatedServiceWorker(page);

    const swRegistration = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) {
        return { supported: false, active: false, state: null };
      }

      const registration = await navigator.serviceWorker.ready;

      return {
        supported: true,
        active: !!registration.active,
        state: registration.active?.state ?? null,
      };
    });

    expect(swRegistration.supported).toBe(true);
    expect(swRegistration.active).toBe(true);
    expect(swRegistration.state).toBe('activated');
  });

  test('service worker has correct scope', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load');

    await waitForActivatedServiceWorker(page);

    const swInfo = await getServiceWorkerInfo(page);

    expect(swInfo.hasServiceWorker).toBe(true);
    expect(swInfo.registrations.length).toBeGreaterThan(0);

    /**
     * The activated one, not `registrations[0]`.
     *
     * `beforeEach` unregisters whatever the previous test left behind, and for a
     * moment afterwards `getRegistrations()` can still hand back that dying
     * registration alongside the fresh one — in whichever order it likes. Index
     * 0 therefore sometimes named a registration with no active worker, which is
     * how this assertion failed right after a wait that had just confirmed an
     * activated worker existed.
     */
    const registration = swInfo.registrations.find((candidate) => candidate.active);
    expect(registration).toBeDefined();
    expect(registration?.activeState).toBe('activated');

    // Scope should contain the base path
    const baseUrl = page.url();
    const expectedScopeBase = new URL(baseUrl).origin;
    expect(registration?.scope).toContain(expectedScopeBase);
  });

  test('service worker script URL is correct', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load');

    const swRegistration = await waitForServiceWorker(page);

    expect(swRegistration.active).toBe(true);
    expect(swRegistration.scriptURL).not.toBeNull();

    // VitePWA generates sw.js in the build output
    expect(swRegistration.scriptURL).toMatch(/sw\.js$/);
  });
});

// ============================================================================
// Test Suite: Offline Capability
// ============================================================================

/**
 * `expect(page.locator('body')).toBeVisible()` appeared five times in this
 * suite and asserted nothing anywhere: `<body>` exists and is visible on
 * Chrome's own `ERR_INTERNET_DISCONNECTED` interstitial, on a blank SPA shell
 * whose scripts all 404'd, and on a crashed error boundary. Each of those is
 * exactly the failure these tests were written to catch.
 *
 * Every offline assertion below names something the app itself renders, so a
 * page that boots but cannot reach its route fails.
 */
test.describe('Offline Capability', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate and wait for SW to be fully active
    await page.goto('/');
    await page.waitForLoadState('load');

    // Ensure service worker is activated
    await waitForActivatedServiceWorker(page);

    // Precaching finished, rather than "two seconds have passed". `index.html`
    // in a cache is what makes the offline reload below possible at all, and a
    // fixed sleep is a race against a ~2.5 MB precache on a cold machine.
    await waitForPrecachedAppShell(page);
  });

  test('app shell loads when offline', async ({ page, context }) => {
    // Verify we're online and the app works
    await page.goto('/trips');
    await page.waitForLoadState('load');
    await expect(page.getByRole('heading', { name: 'My trips', level: 1 })).toBeVisible();

    // Go offline
    await context.setOffline(true);

    // Reload the page
    await page.reload({ waitUntil: 'domcontentloaded' });

    /**
     * The route rendered, from cache, with the network off.
     *
     * Three separate things have to have worked for this heading to exist: the
     * worker answered the navigation from the precached `index.html`, the app's
     * entry bundle came out of the precache, and the lazily-imported `/trips`
     * chunk did too. The old `body.length > 100` check needed none of them —
     * an error boundary's apology is over a hundred characters, and so is
     * Chrome's offline interstitial.
     */
    await waitForRoute(page);
    await expect(page.getByRole('heading', { name: 'My trips', level: 1 })).toBeVisible();

    // And the shell around it, not just the route: the bottom navigation is
    // rendered by `Layout`, so this fails if the app mounted a bare fallback.
    await expect(page.getByRole('navigation').first()).toBeAttached();

    // Restore online status
    await context.setOffline(false);
  });

  test('navigation works offline', async ({ page, context }) => {
    // Visit multiple pages to cache them
    await page.goto('/trips');
    await page.waitForLoadState('load');
    await waitForRoute(page);
    await page.goto('/settings');
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // Go offline
    await context.setOffline(true);

    // Navigate between cached pages. Each assertion names that page's own
    // heading, so serving the right document with the wrong route — or the
    // shell with no route at all — fails.
    await page.goto('/trips');
    await waitForRoute(page);
    await expect(page.getByRole('heading', { name: 'My trips', level: 1 })).toBeVisible();

    await page.goto('/settings');
    await waitForRoute(page);
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();

    // Restore online
    await context.setOffline(false);
  });

  test('cached data is accessible offline', async ({ page, context }) => {
    // Clear existing data first
    await clearIndexedDB(page);
    await page.reload();
    await page.waitForLoadState('load');

    // Create a trip while online
    const tripId = await createTestTrip(page);

    // Navigate to trips list to ensure it's cached
    await page.goto('/trips');
    await page.waitForLoadState('load');

    // Verify trip is visible (use first() to handle multiple matches)
    await expect(page.getByText('PWA Test Trip').first()).toBeVisible();

    // The app shell is in the precache, rather than "two seconds have passed".
    await waitForPrecachedAppShell(page);

    // Go offline
    await context.setOffline(true);

    // Reload the page
    await page.reload({ waitUntil: 'domcontentloaded' });

    // The trip data should still be accessible from IndexedDB
    // (IndexedDB works offline)
    await expect(page.getByText('PWA Test Trip').first()).toBeVisible({ timeout: 10000 });

    // Navigate to the trip's calendar (should work from cache)
    await page.goto(`/trips/${tripId}/calendar`);

    /**
     * The calendar route itself came out of the cache.
     *
     * This is the assertion the test was named for and the one it did not
     * make: `expect(page.locator('body')).toBeVisible()` passes on a blank
     * document. The calendar is one of the heaviest lazy chunks in the app, so
     * if the precache does not hold it, this is where that shows up.
     *
     * The trip name is the second half, and it is not decoration.
     * `CalendarPage` renders the same `Calendar` heading in its loading, error
     * and no-trip branches; only the loaded branch puts `currentTrip.name`
     * underneath it. Asserting the heading alone would pass on the error state.
     */
    await waitForRoute(page);
    await expect(
      page.getByRole('heading', { name: 'Calendar', level: 1 }),
    ).toBeVisible();
    await expect(page.getByText('PWA Test Trip').first()).toBeVisible();

    // Restore online
    await context.setOffline(false);
  });

  test('shows appropriate UI when offline with uncached routes', async ({ page, context }) => {
    await page.goto('/');
    await page.waitForLoadState('load');

    // Go offline before visiting a new route
    await context.setOffline(true);

    // A URL that was never visited, for a trip that does not exist. The
    // `navigateFallback` NavigationRoute has to answer it from the precached
    // `index.html`, and the app has to boot and route on it.
    await page.goto('/trips/nonexistent-trip-id/calendar');

    /**
     * The app rendered its own answer, not the browser's.
     *
     * String-sniffing `page.content()` for `net::` was the wrong instrument
     * twice over. Chrome's error interstitial lives in a different document,
     * so those strings would not have been in `page.content()` even when the
     * navigation did fail — and when a `goto` genuinely cannot be served,
     * Playwright throws before the assertion is ever reached. The check could
     * not distinguish success from either failure mode.
     *
     * What actually separates "the service worker served the shell" from "the
     * navigation died" is whether the app is on screen: React mounted, the
     * router resolved this path, and `CalendarPage` reached its no-trip branch
     * for an id that matches nothing.
     */
    await waitForRoute(page);
    await expect(
      page.getByRole('heading', { name: 'Calendar', level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole('navigation').first()).toBeAttached();

    // Restore online
    await context.setOffline(false);
  });
});

// ============================================================================
// Test Suite: Manifest Validation
// ============================================================================

test.describe('Manifest Validation', () => {
  test('manifest.webmanifest exists and is valid JSON', async ({ page }) => {
    // Fetch the manifest
    const response = await page.request.get('/manifest.webmanifest');

    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('application/manifest+json');

    const manifest = await response.json();
    expect(manifest).toBeDefined();
    expect(typeof manifest).toBe('object');
  });

  test('manifest has required fields', async ({ page }) => {
    const response = await page.request.get('/manifest.webmanifest');
    const manifest = await response.json();

    // Required fields for PWA installability
    expect(manifest.name).toBeDefined();
    expect(typeof manifest.name).toBe('string');
    expect(manifest.name.length).toBeGreaterThan(0);

    expect(manifest.short_name).toBeDefined();
    expect(typeof manifest.short_name).toBe('string');

    expect(manifest.start_url).toBeDefined();
    expect(typeof manifest.start_url).toBe('string');

    expect(manifest.display).toBeDefined();
    expect(['standalone', 'fullscreen', 'minimal-ui', 'browser']).toContain(manifest.display);

    expect(manifest.icons).toBeDefined();
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  test('manifest has valid icon configuration', async ({ page }) => {
    const response = await page.request.get('/manifest.webmanifest');
    const manifest = await response.json();

    // Verify each icon has required properties
    for (const icon of manifest.icons) {
      expect(icon.src).toBeDefined();
      expect(typeof icon.src).toBe('string');

      expect(icon.sizes).toBeDefined();
      expect(typeof icon.sizes).toBe('string');

      expect(icon.type).toBeDefined();
      expect(typeof icon.type).toBe('string');
    }

    // Verify at least one icon is available (for installability)
    const hasValidIcon = manifest.icons.some((icon: { src: string; sizes: string }) => {
      return icon.src && icon.sizes;
    });
    expect(hasValidIcon).toBe(true);
  });

  test('manifest theme and background colors are defined', async ({ page }) => {
    const response = await page.request.get('/manifest.webmanifest');
    const manifest = await response.json();

    // Theme color for browser UI
    expect(manifest.theme_color).toBeDefined();
    expect(typeof manifest.theme_color).toBe('string');
    // Should be a valid color (hex format)
    expect(manifest.theme_color).toMatch(/^#[0-9a-fA-F]{3,8}$/);

    // Background color for splash screen
    expect(manifest.background_color).toBeDefined();
    expect(typeof manifest.background_color).toBe('string');
    expect(manifest.background_color).toMatch(/^#[0-9a-fA-F]{3,8}$/);
  });

  test('manifest matches expected app configuration', async ({ page }) => {
    const response = await page.request.get('/manifest.webmanifest');
    const manifest = await response.json();

    // Verify against the VitePWA config
    expect(manifest.name).toBe('Kikouchou');
    expect(manifest.short_name).toBe('Kikouchou');
    expect(manifest.description).toBe('Organize your vacation house rooms and arrivals');
    expect(manifest.theme_color).toBe('#0f172a');
    expect(manifest.background_color).toBe('#ffffff');
    expect(manifest.display).toBe('standalone');
  });

  test('manifest declares a stable app id', async ({ page }) => {
    const response = await page.request.get('/manifest.webmanifest');
    const manifest = await response.json();

    /**
     * With no `id`, the app's computed identity *is* its `start_url`. That
     * makes the identity a function of `vite.config.ts`'s `base`: change it and
     * every already-installed copy points at an app that, as far as the browser
     * is concerned, no longer exists — the next install adds a second icon
     * instead of updating the first. Declaring it pins the identity to one
     * string, which is also what a cross-origin `navigator.install()` call from
     * the landing page would have to name.
     */
    expect(manifest.id).toBe('/');
  });

  test('manifest icons are accessible', async ({ page, baseURL }) => {
    const response = await page.request.get('/manifest.webmanifest');
    const manifest = await response.json();

    // A `for` loop over an empty array asserts nothing. An icons list that
    // vanished is precisely the regression that makes an app uninstallable, and
    // it would have walked straight through this test.
    expect(manifest.icons.length).toBeGreaterThan(0);

    // Verify each icon URL is accessible
    for (const icon of manifest.icons) {
      const iconUrl = icon.src.startsWith('http')
        ? icon.src
        : new URL(icon.src, baseURL).href;

      const iconResponse = await page.request.get(iconUrl);
      expect(iconResponse.ok(), `${iconUrl} should be served`).toBe(true);

      // 200 is not enough on its own: `vite preview` answers an unknown path
      // with the SPA `index.html`, so a renamed icon returns a perfectly OK
      // HTML document and passes an `ok()`-only check.
      expect(
        iconResponse.headers()['content-type'],
        `${iconUrl} should be served as an image`,
      ).toContain('image/');
    }
  });
});

// ============================================================================
// Test Suite: App Updates (autoUpdate mode)
// ============================================================================

test.describe('App Updates', () => {
  test('the built worker implements the autoUpdate contract', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load');

    await waitForActivatedServiceWorker(page);

    /**
     * `registerType: 'autoUpdate'` is two calls in the generated worker, and
     * both have to be there.
     *
     * `skipWaiting()` stops a new build from sitting in `waiting` until every
     * tab on the origin has closed — which, for an installed PWA, can be
     * never. `clientsClaim()` is what lets the worker take over pages that
     * were already open, and it is the event `virtual:pwa-register` reloads
     * on. Switch `vite.config.ts` to `registerType: 'prompt'` and both
     * disappear from `sw.js` while every other test in this file still passes.
     *
     * Read out of the served worker rather than off disk: what the browser
     * fetched is the artefact under test.
     */
    const workerSource = await (await page.request.get('/sw.js')).text();

    expect(workerSource).toContain('skipWaiting');
    expect(workerSource).toContain('clientsClaim');

    /**
     * And `clientsClaim()` observably worked: this page loaded *before* the
     * worker existed, and is nonetheless controlled by it.
     *
     * Without `clientsClaim` a freshly installed worker controls nothing until
     * the next navigation, so `controller` stays null for the whole of this
     * page's life — the load that installed the worker gets none of its
     * benefit. That is the difference between the app being offline-capable
     * now and being offline-capable next time.
     */
    await expect
      .poll(
        () => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null),
        { timeout: SW_READY_TIMEOUT },
      )
      .toMatch(/sw\.js$/);
  });

  test('service worker can check for updates', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load');

    // Wait for SW to be active
    await waitForActivatedServiceWorker(page);

    // Trigger an update check
    const updateResult = await page.evaluate(async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        // The activated one, not `registrations[0]`: an unregistered-but-not-yet
        // collected registration can still be in this list, and calling
        // `update()` on it rejects. Same trap as 'service worker has correct
        // scope' above.
        const registration = registrations.find((candidate) => candidate.active);
        if (!registration) return { success: false, error: 'No active registration' };
        await registration.update();
        return {
          success: true,
          // The check found nothing new — there is nothing new to find, the
          // preview server is serving the same build. A worker stuck in
          // `installing` or parked in `waiting` after an update check against
          // an unchanged origin means `skipWaiting` is not doing its job.
          hasWaiting: !!registration.waiting,
          hasInstalling: !!registration.installing,
          stillActive: registration.active?.state ?? null,
        };
      } catch (error) {
        return {
          success: false,
          error: String(error),
        };
      }
    });

    expect(updateResult.success, updateResult.error).toBe(true);
    expect(updateResult.hasWaiting).toBe(false);
    expect(updateResult.stillActive).toBe('activated');
  });

  /**
   * The test that used to sit here was called "controllerchange event fires on
   * SW update" and never fired one. It asserted that
   * `'controller' in navigator.serviceWorker` — a property of Chromium, true on
   * a page with no service worker at all — and that adding and removing an
   * event listener did not throw, which is true of every EventTarget in the
   * platform. No update was triggered and no event was observed, so nothing
   * about this app could have failed it.
   *
   * What it was reaching for is asserted for real above: `clientsClaim()` is in
   * the built worker, and `navigator.serviceWorker.controller` proves it ran.
   */
  test('a new build reloads the session it finds already running', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load');
    await waitForActivatedServiceWorker(page);

    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
        timeout: SW_READY_TIMEOUT,
      })
      .toBe(true);

    /**
     * A marker that only survives as long as this document does.
     *
     * The whole point of `autoUpdate` is that the running page does not stay on
     * the build it booted with, so the observable is a reload — and a reload is
     * exactly what a value hung off `window` cannot survive.
     */
    await page.evaluate(() => {
      (window as unknown as Record<string, string>).__unit7Session = 'pre-update';
    });

    /**
     * Register a worker at a URL the current registration does not have.
     *
     * A plain re-register of `/sw.js` does nothing observable, which is how the
     * first draft of this test failed: `unregister()` on a registration that
     * still controls a client only sets its uninstalling flag, and the
     * subsequent `register()` finds the same scope with a byte-identical script
     * URL and resolves with the resurrected registration. No worker installs,
     * no `controllerchange` fires. A distinct script URL in the same scope is
     * what makes the browser fetch, install and activate a genuinely new
     * worker — the same path a deploy takes.
     *
     * Not awaited, and wrapped: `lib/pwa/register` reloads the page the moment
     * the new worker activates, so this call site can be torn down mid-flight.
     * That reload is the assertion, not an accident.
     */
    await page
      .evaluate(() => {
        void navigator.serviceWorker.register('/sw.js?unit7-new-build=1');
      })
      .catch(() => {
        // The document went away before the call returned. That is the
        // behaviour under test; the poll below is what decides the verdict.
      });

    /**
     * The session reloaded onto the new worker.
     *
     * This is the half of `registerType: 'autoUpdate'` that
     * `src/lib/pwa/register.ts` exists to supply, and the half its fileoverview
     * records as a production bug when it was missing: "`skipWaiting` and
     * `clientsClaim` mean the *next* navigation gets the new build; nothing
     * reloads a session that never navigates". Delete the `registerSW` call
     * there — or set `injectRegister` back to its default, which injects a bare
     * `navigator.serviceWorker.register` and nothing else — and the marker
     * below is still sitting on `window` when this times out.
     *
     * `'navigating'` keeps a destroyed execution context from being read as a
     * pass: only a document that ran fresh JavaScript reports `'gone'`.
     */
    await expect
      .poll(
        async () => {
          try {
            return await page.evaluate(
              () =>
                (window as unknown as Record<string, string | undefined>)
                  .__unit7Session ?? 'gone',
            );
          } catch {
            return 'navigating';
          }
        },
        { timeout: SW_READY_TIMEOUT },
      )
      .toBe('gone');

    // And what it reloaded onto is this app's worker, in control.
    await expect
      .poll(
        () => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null),
        { timeout: SW_READY_TIMEOUT },
      )
      .toContain('sw.js');
  });
});

// ============================================================================
// Test Suite: Precaching
// ============================================================================

test.describe('Precaching', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load');

    // Wait for SW and precaching to complete
    await waitForActivatedServiceWorker(page);

    // Precaching finished, rather than "three seconds have passed". Every test
    // in this suite reads the cache exactly once, so a fixed sleep that came up
    // short would report a half-filled precache as the final state.
    await waitForPrecachedAppShell(page);
  });

  test('workbox cache is created', async ({ page }) => {
    const cacheInfo = await getCacheInfo(page);

    expect(cacheInfo.cacheNames.length).toBeGreaterThan(0);

    // Workbox creates caches with predictable naming
    // Look for workbox-precache or similar
    const hasWorkboxCache = cacheInfo.cacheNames.some(
      (name) =>
        name.includes('workbox') ||
        name.includes('precache') ||
        name.includes('runtime'),
    );

    expect(hasWorkboxCache).toBe(true);
  });

  test('the navigation fallback document is precached', async ({ page }) => {
    /**
     * `index.html`, by name.
     *
     * The previous version of this test accepted any cached URL matching
     * `endsWith('.html') || endsWith('/') || includes('index')`, and only the
     * third clause ever fired — on `assets/index-<hash>.js`. Revisioned
     * precache entries are stored with a `?__WB_REVISION__=` query, so the
     * cached app shell does not end in `.html` and never satisfied the first
     * two. The test asserting that HTML is precached was passing because a
     * JavaScript chunk happens to be called "index".
     *
     * This one entry is what the `navigateFallback` route serves for every
     * offline navigation, so if it is missing the whole offline story is
     * missing with it.
     */
    const cached = await getCachedPathnames(page);

    expect([...cached]).toContain('/index.html');
  });

  test('JavaScript bundles are precached', async ({ page }) => {
    const isJsCached = await isUrlCached(page, '.js');
    expect(isJsCached).toBe(true);
  });

  test('CSS files are precached', async ({ page }) => {
    const isCssCached = await isUrlCached(page, '.css');
    expect(isCssCached).toBe(true);
  });

  test('critical assets are cached according to workbox config', async ({ page }) => {
    // Based on vite.config.ts: globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']
    const cacheInfo = await getCacheInfo(page);

    // Flatten all cached URLs
    const allCachedUrls = Object.values(cacheInfo.cacheEntries).flat();

    // Check for different asset types
    const cachedTypes = {
      js: allCachedUrls.some((url) => url.endsWith('.js')),
      css: allCachedUrls.some((url) => url.endsWith('.css')),
      html: allCachedUrls.some((url) => url.endsWith('.html') || url.endsWith('/')),
      svg: allCachedUrls.some((url) => url.endsWith('.svg')),
    };

    // At minimum, JS and CSS should be cached for the app to work offline
    expect(cachedTypes.js).toBe(true);
    expect(cachedTypes.css).toBe(true);
  });

  test('every entry in the build manifest is actually precached', async ({ page }) => {
    /**
     * The build's own list, compared against what the browser holds.
     *
     * `expect(totalEntries).toBeGreaterThanOrEqual(3)` was the old assertion,
     * and three is a number no plausible regression can go below: an app that
     * precached its HTML, one chunk and nothing else — no router, no route
     * chunks, no CSS — passed it, and so does one whose `globPatterns` silently
     * stopped matching `assets/`. Nothing in the suite would have noticed.
     *
     * `precacheAndRoute([...])` in the served worker is where
     * `self.__WB_MANIFEST` ends up, so this compares the shipped precache
     * manifest — 87 entries at the time of writing, and never a number written
     * down here — against the cache's actual contents. Drop an entry from the
     * install and this names it.
     */
    const workerSource = await (await page.request.get('/sw.js')).text();
    const manifest = parsePrecacheManifest(workerSource);

    // A worker whose manifest failed to parse would make the loop below vacuous
    // in exactly the way this test exists to stop.
    expect(manifest.length).toBeGreaterThan(20);
    expect(manifest).toContain('index.html');

    /**
     * Polled rather than read once: `waitForPrecachedAppShell` proves the
     * install started, not that all ~2.5 MB of it landed.
     */
    await expect
      .poll(
        async () => {
          const cached = await getCachedPathnames(page);
          return manifest.filter((url) => !cached.has(`/${url}`));
        },
        { timeout: SW_READY_TIMEOUT },
      )
      .toEqual([]);
  });

  test('cache storage reports the precache it just wrote', async ({ page }) => {
    /**
     * Unconditional.
     *
     * This assertion used to live inside `if (storageInfo) { … }`, so a
     * `navigator.storage.estimate` that went missing turned the test into a
     * no-op that still reported green — the one outcome an availability check
     * must not produce. Chromium has had the API since 2016; if it is gone,
     * that is a finding, not a reason to skip.
     */
    const storageInfo = await page.evaluate(async () => {
      if (!('storage' in navigator) || !('estimate' in navigator.storage)) {
        return null;
      }

      const estimate = await navigator.storage.estimate();
      return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
    });

    expect(storageInfo, 'navigator.storage.estimate() should exist').not.toBeNull();

    // The precache is ~2.5 MB, so "something was written" is a floor this can
    // sit well above without becoming brittle: 100 KB is under any single
    // vendor chunk the app ships.
    expect(storageInfo?.usage ?? 0).toBeGreaterThan(100_000);
    expect(storageInfo?.quota ?? 0).toBeGreaterThan(storageInfo?.usage ?? 0);
  });
});

// ============================================================================
// Test Suite: PWA Installation Readiness
// ============================================================================

test.describe('PWA Installation Readiness', () => {
  test('app meets basic PWA installability criteria', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load');

    // The worker registers asynchronously, so `load` is not far enough: reading
    // `getRegistrations()` straight after it measured an empty list at 245 ms
    // and failed on `swRegistered`. Same wait as every other
    // service-worker assertion in this file.
    await waitForActivatedServiceWorker(page);

    // Check all installability requirements
    const installabilityChecks = await page.evaluate(async () => {
      const checks = {
        hasServiceWorker: 'serviceWorker' in navigator,
        isSecureContext: window.isSecureContext,
        hasManifestLink: !!document.querySelector('link[rel="manifest"]'),
        hasActiveWorker: false,
        swRegistered: false,
      };

      if (checks.hasServiceWorker) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        checks.swRegistered = registrations.length > 0;

        // `.some()`, not `registrations[0]`: an unregistered-but-not-yet
        // collected registration can still be in this list, in any position.
        checks.hasActiveWorker = registrations.some(
          (registration) => registration.active !== null,
        );
      }

      return checks;
    });

    expect(installabilityChecks.hasServiceWorker).toBe(true);
    expect(installabilityChecks.hasManifestLink).toBe(true);
    expect(installabilityChecks.swRegistered).toBe(true);

    // Collected but never asserted, which made it decoration. `127.0.0.1` is a
    // secure context by the same rule that makes `localhost` one, so this is
    // true here — and it is the criterion that stops the whole install prompt
    // if the app is ever served over plain HTTP from a real host.
    expect(installabilityChecks.isSecureContext).toBe(true);

    // The same: gathered as `hasFetchHandler` and then dropped on the floor.
    expect(installabilityChecks.hasActiveWorker).toBe(true);
  });

  test('manifest link is present in document head', async ({ page }) => {
    await page.goto('/');

    const manifestLink = await page.evaluate(() => {
      const link = document.querySelector('link[rel="manifest"]');
      return link ? {
        href: link.getAttribute('href'),
        exists: true,
      } : { exists: false, href: null };
    });

    expect(manifestLink.exists).toBe(true);
    expect(manifestLink.href).toContain('manifest');
  });

  test('theme-color meta tag is present', async ({ page }) => {
    await page.goto('/');

    const themeColor = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="theme-color"]');
      return meta?.getAttribute('content') ?? null;
    });

    // Theme color should match manifest
    expect(themeColor).toBe('#0f172a');
  });

  test('viewport meta tag is properly configured', async ({ page }) => {
    await page.goto('/');

    const viewport = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="viewport"]');
      return meta?.getAttribute('content') ?? null;
    });

    expect(viewport).not.toBeNull();
    expect(viewport).toContain('width=device-width');

    /**
     * `viewport-fit=cover` is what makes `env(safe-area-inset-*)` report
     * anything at all.
     *
     * Without it every inset is 0 on every device, so every safe-area rule in
     * `src/index.css` is dead code that still compiles, still ships and still
     * looks right in a desktop browser — the bottom nav bar simply renders
     * under the home indicator on the phones this app is installed on, and the
     * `theme-color` letterbox reappears. Nothing else in the suite can notice
     * that, which is why it is asserted on the meta tag itself.
     */
    expect(viewport).toContain('viewport-fit=cover');
  });

  test('the app shell reserves the bottom safe area', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load');

    /**
     * The safe-area utilities have to survive the production CSS pipeline.
     *
     * `pb-safe`, `pb-bottom-stack` and `bottom-nav-safe` are `@utility`
     * declarations rather than stock Tailwind classes, so a rename or a
     * Lightning CSS pass that dropped them would leave the class attribute
     * intact and every rule gone — the failure would be silent in the DOM and
     * visible only on a device with an inset. Reading the compiled stylesheet
     * back is the only place that shows up in CI, where every inset is 0.
     */
    const rules = await page.evaluate(() => {
      const found: string[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        let cssRules: CSSRuleList;
        try {
          cssRules = sheet.cssRules;
        } catch {
          // Cross-origin stylesheet — none of ours.
          continue;
        }
        const walk = (list: CSSRuleList): void => {
          for (const rule of Array.from(list)) {
            if (rule.cssText.includes('safe-area-inset')) {
              found.push(rule.cssText);
            }
            const nested = (rule as CSSGroupingRule).cssRules as CSSRuleList | undefined;
            if (nested !== undefined) {
              walk(nested);
            }
          }
        };
        walk(cssRules);
      }
      return found;
    });

    expect(rules.join('\n')).toContain('safe-area-inset-bottom');
  });
});
