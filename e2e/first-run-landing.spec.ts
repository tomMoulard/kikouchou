/**
 * @fileoverview E2E tests for where the app's root sends a visitor.
 *
 * The rule, from `src/features/trips/pages/TripsEntryRedirect`: a first launch
 * with nothing to open lands on the create form, and everything else lands on
 * the trip list. What is worth driving in a real browser rather than in jsdom
 * is the part that spans launches — the form once, the list ever after — and
 * the way out of the form, because a landing page nobody can leave is a trap.
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
  test('a first launch with no trips lands on the create form', async ({ page }) => {
    await clearEverything(page);

    await page.goto('/');

    await expect(page).toHaveURL(/\/trips\/new$/);
  });

  test('cancelling the form gives the visitor the trip list', async ({ page }) => {
    await clearEverything(page);

    await page.goto('/');
    await expect(page).toHaveURL(/\/trips\/new$/);

    await page.getByRole('button', { name: /cancel/iu }).click();

    await expect(page).toHaveURL(/\/trips$/);
    await expect(page.getByText('No trips yet')).toBeVisible();
  });

  test('the next launch lands on the list, not on the form again', async ({ page }) => {
    await clearEverything(page);

    await page.goto('/');
    await expect(page).toHaveURL(/\/trips\/new$/);

    // A second launch, with the database still empty: the form was offered
    // once and turned down, so the list is what this visitor gets.
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
