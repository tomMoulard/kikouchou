/**
 * @fileoverview The install banner stays off the trip creation form.
 *
 * The card sits over the bottom of the screen, which on a phone is where the
 * form's own fields and buttons are. `InstallPrompt` is mounted outside
 * `RouterProvider`, so it learns the route from the router object in `App`.
 * These tests own what only a real browser can say: that a client-side
 * navigation reaches it, both onto the form and away from it.
 *
 * @module e2e/install-prompt-trip-create
 */

import { test, expect } from '@playwright/test';

import { fixtureDate } from './support/fixture-dates';
import { waitForRoute } from './support/routes';
import { seedTrip } from './support/seed';
import {
  INSTALL_REGION_LABEL,
  fakeBeforeInstallPrompt,
} from './support/install-prompt';

/**
 * A phone, because that is where the card covers the form.
 */
test.use({ viewport: { width: 393, height: 852 } });

test.describe('the install banner while a trip is created', () => {
  test('is not shown on the trip creation form', async ({ page }) => {
    await page.goto('/trips/new');
    await waitForRoute(page);
    await fakeBeforeInstallPrompt(page);

    // Past the card's own one-second delay, so an absence means something.
    await page.waitForTimeout(1500);
    await expect(
      page.getByRole('region', { name: INSTALL_REGION_LABEL }),
    ).toHaveCount(0);
  });

  test('hides on the way to the form and comes back after it', async ({
    page,
  }) => {
    // Seeded because the FAB below is on the populated `/trips`.
    await seedTrip(page, {
      name: 'Install Hidden',
      startDate: fixtureDate(1),
      endDate: fixtureDate(10),
    });

    await page.goto('/trips');
    await waitForRoute(page);
    await fakeBeforeInstallPrompt(page);

    const banner = page.getByRole('region', { name: INSTALL_REGION_LABEL });
    await expect(banner).toBeVisible();

    await page.getByRole('button', { name: /new trip|nouveau voyage/i }).click();
    await expect(page).toHaveURL(/\/trips\/new$/);
    await expect(banner).toHaveCount(0);

    await page.goBack();
    await expect(page).toHaveURL(/\/trips$/);
    await expect(banner).toBeVisible();
  });
});
