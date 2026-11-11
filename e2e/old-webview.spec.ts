/**
 * @fileoverview E2E cover for the polyfills an old Android WebView needs.
 *
 * The Android app installs on phones whose system WebView is Chrome 90, which
 * has neither `Object.hasOwn` (Chrome 93) nor `Array.prototype.at` (Chrome 92).
 * `react-markdown` calls the first on every render, so the trip's own page
 * crashed there. This spec removes both built-ins before any script of the
 * page runs, and asserts the page still renders the trip's description.
 *
 * @module e2e/old-webview
 */

import { expect, test } from '@playwright/test';

import { waitForRoute } from './support/routes';
import { seedTrip } from './support/seed';
import { clearIndexedDB } from './support/storage';

// ============================================================================
// Helpers
// ============================================================================

/** Dates are derived from today so the fixture never falls into the past. */
function isoDate(daysFromToday: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
}

// ============================================================================
// Tests
// ============================================================================

test.describe('Old WebView', () => {
  test('renders the markdown of a trip without Object.hasOwn or Array.prototype.at', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });
    await page.addInitScript(() => {
      Reflect.deleteProperty(Object, 'hasOwn');
      Reflect.deleteProperty(Array.prototype, 'at');
    });

    await clearIndexedDB(page);
    const { tripId } = await seedTrip(page, {
      name: 'Old WebView Trip',
      description: 'Bring **hiking boots**.',
      startDate: isoDate(30),
      endDate: isoDate(40),
    });

    await page.goto(`/trips/${tripId}/edit`);
    await waitForRoute(page);

    await expect(page.locator('strong', { hasText: 'hiking boots' })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  /*
   * Safari before 14 gives a MediaQueryList with only the deprecated
   * `addListener`/`removeListener`, and so did the Android in-app browser
   * PostHog reported from a Google Ads click. `useMediaQuery` runs inside
   * Layout, so its unguarded `addEventListener` call threw on every page and
   * sent the whole app to the route error page.
   *
   * Only this shape is driven end to end. A stub with no listener method at
   * all also crashes `next-themes` and `sonner`, which call `addListener`
   * themselves; production cannot have had that shape, or they would have
   * thrown first. The hooks' unit tests cover it.
   */
  test('renders a trip page when matchMedia returns a list with addListener only', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });
    page.on('console', (message) => {
      if (message.type() === 'error' && message.text().includes('addEventListener')) {
        errors.push(message.text());
      }
    });
    await page.addInitScript(() => {
      const realMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = ((query: string) => {
        const list = realMatchMedia(query);
        return {
          get matches() {
            return list.matches;
          },
          media: list.media,
          addListener: list.addListener.bind(list),
          removeListener: list.removeListener.bind(list),
        };
      }) as unknown as typeof window.matchMedia;
    });

    await clearIndexedDB(page);
    const { tripId } = await seedTrip(page, {
      name: 'Old Safari Trip',
      startDate: isoDate(30),
      endDate: isoDate(40),
    });

    await page.goto(`/trips/${tripId}/calendar`);
    await waitForRoute(page);

    await expect(page.locator('#main-content')).toBeVisible();
    await expect(page.getByText('Old Safari Trip').first()).toBeVisible();
    expect(errors).toEqual([]);
  });
});
