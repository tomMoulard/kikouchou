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
});
