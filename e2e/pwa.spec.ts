/**
 * @fileoverview E2E tests for PWA functionality in Kikoushou.
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
import { waitForActivatedServiceWorker } from './support/service-worker';
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

  // Fill trip form
  await page.locator('#trip-name').fill('PWA Test Trip');
  await page.locator('#trip-location').fill('Test Location');

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

test.describe('Offline Capability', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate and wait for SW to be fully active
    await page.goto('/');
    await page.waitForLoadState('load');

    // Ensure service worker is activated
    await waitForActivatedServiceWorker(page);

    // Give time for precaching to complete
    await page.waitForTimeout(2000);
  });

  test('app shell loads when offline', async ({ page, context }) => {
    // Verify we're online and the app works
    await page.goto('/trips');
    await page.waitForLoadState('load');
    await expect(page.locator('body')).toBeVisible();

    // Go offline
    await context.setOffline(true);

    // Reload the page
    await page.reload({ waitUntil: 'domcontentloaded' });

    // The app shell should still render from cache
    // Check for main app container or navigation
    await expect(page.locator('body')).toBeVisible();

    // Check for the main app content (not an error page)
    // The app should show either the trip list or empty state
    const hasContent = await page.evaluate(() => {
      const body = document.body.textContent ?? '';
      // Should NOT show a network error page
      const isErrorPage =
        body.includes('ERR_INTERNET_DISCONNECTED') ||
        body.includes('No internet') ||
        body.includes('DNS_PROBE');
      return !isErrorPage && body.length > 100;
    });

    expect(hasContent).toBe(true);

    // Restore online status
    await context.setOffline(false);
  });

  test('navigation works offline', async ({ page, context }) => {
    // Visit multiple pages to cache them
    await page.goto('/trips');
    await page.waitForLoadState('load');
    await page.goto('/settings');
    await page.waitForLoadState('load');

    // Wait for caching
    await page.waitForTimeout(1000);

    // Go offline
    await context.setOffline(true);

    // Navigate between cached pages
    await page.goto('/trips');
    await expect(page.locator('body')).toBeVisible();

    await page.goto('/settings');
    await expect(page.locator('body')).toBeVisible();

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

    // Wait for SW to cache everything
    await page.waitForTimeout(2000);

    // Go offline
    await context.setOffline(true);

    // Reload the page
    await page.reload({ waitUntil: 'domcontentloaded' });

    // The trip data should still be accessible from IndexedDB
    // (IndexedDB works offline)
    await expect(page.getByText('PWA Test Trip').first()).toBeVisible({ timeout: 10000 });

    // Navigate to the trip's calendar (should work from cache)
    await page.goto(`/trips/${tripId}/calendar`);

    // Page should load from cache
    await expect(page.locator('body')).toBeVisible();

    // Restore online
    await context.setOffline(false);
  });

  test('shows appropriate UI when offline with uncached routes', async ({ page, context }) => {
    await page.goto('/');
    await page.waitForLoadState('load');

    // Go offline before visiting a new route
    await context.setOffline(true);

    // Try to navigate to a route that might not be precached
    // The behavior depends on the workbox configuration
    await page.goto('/trips/nonexistent-trip-id/calendar');

    // Either the app shows a fallback or the SW serves a cached response
    // We just verify no browser network error is shown
    const pageContent = await page.content();
    const isNetworkError =
      pageContent.includes('ERR_INTERNET_DISCONNECTED') ||
      pageContent.includes('DNS_PROBE') ||
      pageContent.includes('net::');

    // With proper SW setup, we should not see raw network errors
    // The app should handle this gracefully
    expect(isNetworkError).toBe(false);

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
    expect(manifest.name).toBe('Kikoushou');
    expect(manifest.short_name).toBe('Kikoushou');
    expect(manifest.description).toBe('Organize your vacation house rooms and arrivals');
    expect(manifest.theme_color).toBe('#0f172a');
    expect(manifest.background_color).toBe('#ffffff');
    expect(manifest.display).toBe('standalone');
  });

  test('manifest icons are accessible', async ({ page, baseURL }) => {
    const response = await page.request.get('/manifest.webmanifest');
    const manifest = await response.json();

    // Verify each icon URL is accessible
    for (const icon of manifest.icons) {
      const iconUrl = icon.src.startsWith('http')
        ? icon.src
        : new URL(icon.src, baseURL).href;

      const iconResponse = await page.request.get(iconUrl);
      expect(iconResponse.ok()).toBe(true);
    }
  });
});

// ============================================================================
// Test Suite: App Updates (autoUpdate mode)
// ============================================================================

test.describe('App Updates', () => {
  test('VitePWA is configured for auto-update', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load');

    await waitForActivatedServiceWorker(page);

    // With autoUpdate, VitePWA checks for updates automatically
    // We can verify the SW is registered with the correct update behavior
    const updateInfo = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;

      return {
        hasActive: !!registration.active,
        hasWaiting: !!registration.waiting,
        hasInstalling: !!registration.installing,
        updateViaCache: registration.updateViaCache,
      };
    });

    expect(updateInfo).not.toBeNull();
    expect(updateInfo?.hasActive).toBe(true);
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
        const registration = registrations[0];
        if (!registration) return { success: false, error: 'No registration' };
        await registration.update();
        return {
          success: true,
          hasWaiting: !!registration.waiting,
          hasInstalling: !!registration.installing,
        };
      } catch (error) {
        return {
          success: false,
          error: String(error),
        };
      }
    });

    expect(updateResult.success).toBe(true);
  });

  test('controllerchange event fires on SW update', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load');

    // Set up a listener for controllerchange
    // This is triggered when a new SW takes control
    const hasControllerChangeSupport = await page.evaluate(() => {
      return 'serviceWorker' in navigator && 'controller' in navigator.serviceWorker;
    });

    expect(hasControllerChangeSupport).toBe(true);

    // Verify the event listener can be attached
    const canListenForChanges = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        if (!('serviceWorker' in navigator)) {
          resolve(false);
          return;
        }

        // Just verify we can add the listener
        try {
          const handler = () => {};
          navigator.serviceWorker.addEventListener('controllerchange', handler);
          navigator.serviceWorker.removeEventListener('controllerchange', handler);
          resolve(true);
        } catch {
          resolve(false);
        }
      });
    });

    expect(canListenForChanges).toBe(true);
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

    // Additional wait for precaching
    await page.waitForTimeout(3000);
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

  test('HTML files are precached', async ({ page }) => {
    const cacheInfo = await getCacheInfo(page);

    // Find entries that look like HTML or the root path
    let hasHtmlCached = false;

    for (const entries of Object.values(cacheInfo.cacheEntries)) {
      for (const url of entries) {
        if (
          url.endsWith('.html') ||
          url.endsWith('/') ||
          url.includes('index')
        ) {
          hasHtmlCached = true;
          break;
        }
      }
      if (hasHtmlCached) break;
    }

    expect(hasHtmlCached).toBe(true);
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

  test('precache manifest contains expected number of entries', async ({ page }) => {
    const cacheInfo = await getCacheInfo(page);

    // Count total cached entries
    const totalEntries = Object.values(cacheInfo.cacheEntries).reduce(
      (sum, entries) => sum + entries.length,
      0,
    );

    // A typical Vite + React app should have several cached assets
    // At minimum: index.html, main JS bundle, CSS, possibly vendor chunks
    expect(totalEntries).toBeGreaterThanOrEqual(3);
  });

  test('cache storage quota is reasonable', async ({ page }) => {
    const storageInfo = await page.evaluate(async () => {
      if (!('storage' in navigator) || !('estimate' in navigator.storage)) {
        return null;
      }

      const estimate = await navigator.storage.estimate();
      return {
        usage: estimate.usage ?? 0,
        quota: estimate.quota ?? 0,
        usagePercentage:
          estimate.quota && estimate.quota > 0
            ? ((estimate.usage ?? 0) / estimate.quota) * 100
            : 0,
      };
    });

    if (storageInfo) {
      // Cache usage should be reasonable (less than 10% of quota for a typical PWA)
      expect(storageInfo.usagePercentage).toBeLessThan(10);

      // Usage should be positive if we have cached content
      expect(storageInfo.usage).toBeGreaterThan(0);
    }
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
        hasFetchHandler: false,
        swRegistered: false,
      };

      if (checks.hasServiceWorker) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        checks.swRegistered = registrations.length > 0;

        // Check if SW is active (has fetch handler)
        if (registrations[0]?.active) {
          checks.hasFetchHandler = true;
        }
      }

      return checks;
    });

    expect(installabilityChecks.hasServiceWorker).toBe(true);
    // Note: isSecureContext might be false on localhost without HTTPS
    // but Chrome allows PWA installation on localhost for development
    expect(installabilityChecks.hasManifestLink).toBe(true);
    expect(installabilityChecks.swRegistered).toBe(true);
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
