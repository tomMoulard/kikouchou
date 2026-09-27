/**
 * @fileoverview Directions to the trip location, handed to the viewer's own
 * map application from the trip card.
 *
 * @module e2e/trip-location-directions
 */

import { expect, test } from '@playwright/test';
import { fixtureDate } from './support/fixture-dates';
import { waitForRoute } from './support/routes';
import { seedTrip } from './support/seed';

test.describe('Trip location directions', () => {
  test.beforeEach(async ({ page }) => {
    // Record the hand-off instead of leaving the app for a real map site.
    await page.addInitScript(() => {
      const opened: string[] = [];
      Object.assign(window, { __opened: opened });
      window.open = (url?: string | URL) => {
        opened.push(String(url));
        return null;
      };
    });
  });

  test('the trip card opens directions to the pin', async ({ page }) => {
    await seedTrip(page, {
      name: 'Cabin weekend',
      location: 'Chamonix',
      startDate: fixtureDate(5),
      endDate: fixtureDate(8),
      coordinates: { lat: 45.9237, lon: 6.8694 },
    });

    await page.goto('/trips');
    await waitForRoute(page);

    const directions = page.getByRole('button', { name: /get directions|itinéraire/i });
    await expect(directions).toBeVisible();

    // Hit-tested at its own centre: the button sits over the map preview, and
    // a map layer painted on top of it would take the tap instead.
    await directions.scrollIntoViewIfNeeded();
    const box = await directions.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened))
      .toEqual([expect.stringMatching(/45\.9237.*6\.8694/)]);
    // The shortcut goes to the map app, not to the map dialog.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/trips$/);
  });
});
