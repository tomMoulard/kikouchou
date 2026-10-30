/**
 * @fileoverview Opening a trip card's menu on a phone leaves the list alone.
 *
 * The menu locks the page while it is open, and the lock gives `body` a right
 * margin as wide as `window.innerWidth - documentElement.clientWidth`, the
 * width it takes for a desktop scrollbar. On a phone the two differ whenever
 * something on the page overflows sideways, so every card shrank by the
 * overflow until the menu closed. `src/index.css` cancels that margin on touch
 * screens.
 *
 * @module e2e/trip-card-menu-layout
 */

import { expect, test } from '@playwright/test';

import { fixtureDate } from './support/fixture-dates';
import { seedTrip } from './support/seed';

// ============================================================================
// Constants
// ============================================================================

/** How far the injected element reaches past the phone's 393px screen. */
const OVERFLOW_PX = 480;

// ============================================================================
// Tests
// ============================================================================

test.describe('the trip card menu on a phone', () => {
  test('keeps every card its width while it is open', async ({ page, isMobile }) => {
    test.skip(isMobile !== true, 'a desktop scrollbar is what the lock margin is for');

    await seedTrip(page, {
      name: 'Lake house',
      startDate: fixtureDate(1),
      endDate: fixtureDate(5),
    });
    await page.goto('/trips');

    // A CSS locator, not `getByRole`: the open menu hides the rest of the page
    // from the accessibility tree, and a role query then finds no card to
    // measure.
    const card = page.locator('[role="listitem"]', { hasText: 'Lake house' });
    await expect(card).toBeVisible({ timeout: 15_000 });

    // Any element wider than the screen widens the layout viewport, which is
    // what makes the lock read a scrollbar that is not there.
    await page.evaluate((width) => {
      const wide = document.createElement('div');
      wide.style.width = `${width}px`;
      wide.style.height = '1px';
      document.querySelector('main')?.append(wide);
    }, OVERFLOW_PX);
    await expect
      .poll(() => page.evaluate(() => window.innerWidth - document.documentElement.clientWidth))
      .toBeGreaterThan(0);

    const before = await card.boundingBox();
    expect(before).not.toBeNull();

    await card.getByRole('button', { name: /open menu/i }).click();
    await expect(page.getByRole('menuitem', { name: /archive/i })).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-scroll-locked', /\d/);

    expect((await card.boundingBox())?.width).toBe(before?.width);
  });
});
