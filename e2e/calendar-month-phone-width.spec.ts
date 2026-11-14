/**
 * @fileoverview The calendar's month grid scrolls inside its box on a phone,
 * and never makes the page wider than the screen.
 *
 * The bug this pins: the grid is 600px at the least, inside a horizontal
 * scroller. Each day carries an `sr-only` label, which is absolutely
 * positioned, and nothing inside the scroller was positioned, so the labels'
 * containing block was the page: the ones scrolled out of view escaped the
 * clip and stretched the document to the grid's width. On Android the whole
 * page then panned and zoomed sideways, the grid and the bottom bar cut off.
 *
 * Measured rather than asserted as a class string: only a browser resolves
 * containing blocks.
 *
 * @module e2e/calendar-month-phone-width
 */

import { expect, test } from '@playwright/test';

import { waitForRoute } from './support/routes';
import { seedTrip } from './support/seed';

/** Both locales, because the suite runs against whichever the browser asks for. */
const MONTH = /^(month|mois)$/i;

/** A small Android phone, and a Pixel 9a. */
const PHONE_WIDTHS = [360, 412] as const;

for (const width of PHONE_WIDTHS) {
  test(`keeps the month view within a ${width}px screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { tripId } = await seedTrip(page, { name: 'Month grid' });

    await page.goto(`/trips/${tripId}/calendar`);
    await waitForRoute(page);
    await page.getByRole('radio', { name: MONTH }).click();
    const grid = page.getByRole('region', { name: /scrollable calendar|calendrier/i });
    await expect(grid).toBeVisible();

    const { page: pageWidth, screen, grid: gridWidth } = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      screen: document.documentElement.clientWidth,
      grid: document.querySelector('[role="region"] [role="grid"]')?.scrollWidth ?? 0,
    }));
    // The grid itself is still wider than the phone: it scrolls in its box.
    expect(gridWidth).toBeGreaterThan(screen);
    expect(pageWidth).toBeLessThanOrEqual(screen);
  });
}
