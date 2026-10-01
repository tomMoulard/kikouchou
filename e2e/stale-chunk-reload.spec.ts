/**
 * @fileoverview A lazy page chunk that fails to load heals itself with a reload.
 *
 * A tab left open across a deploy asks for a chunk name the new build replaced,
 * and `import()` rejects. PostHog issue `01a0a104-252e-7b53-8c95-eb0341c6f733`
 * holds those sessions: `TripEditPage`, `TripCreatePage`, `SettingsPage` and
 * `vendor-supabase`, all on Android Chrome. The error boundary reloads the tab
 * onto the current build instead of showing the error screen, and it reports
 * nothing when that reload goes ahead.
 *
 * The missing chunk is simulated by aborting the first request for the page's
 * module. The second request, after the reload, goes through as it would once
 * the new build is served.
 *
 * @module e2e/stale-chunk-reload
 */

import { expect, test } from '@playwright/test';

import { waitForRoute } from './support/routes';

// ============================================================================
// Fixtures
// ============================================================================

/** The app's language detection can land on either locale; match both. */
const TRIP_NAME = /trip name|nom du voyage/i;

/** The module of the create page, as the dev server and a build both name it. */
const CREATE_PAGE_CHUNK = /TripCreatePage[^/]*\.(tsx|js)(\?|$)/;

/** Where `reloadForStaleChunk` records its once-per-tab guard. */
const RELOAD_GUARD_KEY = 'kikouchou:stale-chunk-reload';

// ============================================================================
// Tests
// ============================================================================

test.describe('a lazy page chunk the origin no longer serves', () => {
  test('reloads the tab by itself and renders the page', async ({ page }) => {
    let refused = 0;
    await page.route(CREATE_PAGE_CHUNK, async (route) => {
      if (refused === 0) {
        refused += 1;
        await route.abort('failed');
        return;
      }
      await route.continue();
    });

    let loads = 0;
    page.on('load', () => {
      loads += 1;
    });

    await page.goto('/trips/new');
    await waitForRoute(page);

    // The form, not the error screen, and without a tap on "Retry".
    await expect(page.getByLabel(TRIP_NAME).first()).toBeVisible();
    expect(refused).toBe(1);
    expect(loads).toBeGreaterThanOrEqual(2);

    // The guard was set, so a chunk missing from the new build too shows the
    // error screen instead of reloading forever.
    const guard = await page.evaluate(
      (key) => sessionStorage.getItem(key),
      RELOAD_GUARD_KEY,
    );
    expect(guard).not.toBeNull();
  });
});
