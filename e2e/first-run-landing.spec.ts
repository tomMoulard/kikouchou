/**
 * @fileoverview E2E tests for where the app's root sends a visitor.
 *
 * The rule, from the index route in `src/router.tsx`: `/` is the trip list,
 * on a first launch as on every other. A first launch used to land on the
 * create form; it now lands on the list, which a real device opens on the
 * sample trip (see `e2e/sample-trip.spec.ts`). Under automation the seed is
 * off, so here the first launch is an empty list.
 *
 * @module e2e/first-run-landing
 */

import { expect, test } from '@playwright/test';

import { fixtureDate } from './support/fixture-dates';
import { seedTrip } from './support/seed';
import { clearIndexedDB } from './support/storage';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Puts the browser back to the state of somebody who has never opened the app:
 * no trips, and no record of a first launch.
 *
 * @param page - Playwright page object
 */
async function clearEverything(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await clearIndexedDB(page);
  await page.evaluate(() => {
    localStorage.clear();
  });
}

// ============================================================================
// Tests
// ============================================================================

test.describe('First-run landing', () => {
  test('a first launch with no trips lands on the trip list', async ({ page }) => {
    await clearEverything(page);

    await page.goto('/');

    await expect(page).toHaveURL(/\/trips$/);
    await expect(page.getByText('No trips yet')).toBeVisible();
  });

  test('a device that already holds a trip lands on the list', async ({ page }) => {
    await clearEverything(page);
    await seedTrip(page, {
      name: 'Summer Vacation',
      location: 'Beach House, Cornwall',
      startDate: fixtureDate(15),
      endDate: fixtureDate(22),
    });

    await page.goto('/');

    await expect(page).toHaveURL(/\/trips$/);
    await expect(page.getByRole('button', { name: /Summer Vacation/u })).toBeVisible();
  });
});
