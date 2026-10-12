/**
 * @fileoverview E2E cover for the phone navigation preferences.
 *
 * Settings lets a phone choose which four trip pages sit in the bottom bar, by
 * dragging them, and whether the bar is shown at all. Both are checked here in
 * a real browser because the unit tests cannot: dnd-kit measures rows with
 * `getBoundingClientRect`, which jsdom answers with zeros, and the bar's
 * absence moves the FAB through CSS variables that jsdom never computes.
 *
 * @module e2e/mobile-nav-settings
 */

import { expect, test, type Page } from '@playwright/test';

import { dragOnto } from './support/drag';
import { fixtureDate } from './support/fixture-dates';
import { waitForRoute } from './support/routes';
import { seedTrip } from './support/seed';

// ============================================================================
// Constants
// ============================================================================

/** A phone, narrower than `sm`, so the bottom bar and the FAB both render. */
const PHONE = { width: 393, height: 852 } as const;

/** An iPhone SE upright: under the 360px where `auto` drops the bar. */
const NARROW_PHONE = { width: 320, height: 640 } as const;

test.use({ viewport: PHONE });

/** Both locales, as everywhere in this suite. */
const LABELS = {
  mobileNav: /mobile navigation|navigation mobile/i,
  moreNav: /more navigation|navigation plus/i,
  menu: /^menu$/i,
  transportHandle: /^(move|déplacer) transports?, position 6$/i,
  menuMode: /^(menu button|bouton menu)$/i,
} as const;

// ============================================================================
// Helpers
// ============================================================================

/** The fixed bottom navigation bar. */
function bottomBar(page: Page) {
  return page.getByRole('navigation', { name: LABELS.mobileNav });
}

/** Seeds one trip and returns its id. */
async function seedOneTrip(page: Page): Promise<string> {
  const { tripId } = await seedTrip(page, {
    name: 'Navigation trip',
    startDate: fixtureDate(1),
    endDate: fixtureDate(8),
  });
  return tripId;
}

// ============================================================================
// Tests
// ============================================================================

test.describe('phone navigation preferences', () => {
  test('dragging Transport into the bar puts it there', async ({ page }) => {
    const tripId = await seedOneTrip(page);

    await page.goto('/settings');
    await waitForRoute(page);

    const handle = page.getByRole('button', { name: LABELS.transportHandle });
    await handle.scrollIntoViewIfNeeded();
    await dragOnto(page, handle, page.getByTestId('nav-order-money'));

    // Saved: the handle now reads its new place.
    await expect(
      page.getByRole('button', { name: /^(move|déplacer) transports?, position 4$/i }),
    ).toBeVisible();

    await page.goto(`/trips/${tripId}/calendar`);
    await waitForRoute(page);

    const bar = bottomBar(page);
    await expect(bar.getByRole('link')).toHaveCount(4);
    await expect(bar.getByRole('link').nth(3)).toHaveText(/^(transport|transports)$/i);

    // Money gave up its slot and went into the sheet.
    await bar.getByRole('button', { name: /^(more|plus)$/i }).click();
    await expect(
      page
        .getByRole('navigation', { name: LABELS.moreNav })
        .getByRole('button', { name: /^(money|argent)$/i }),
    ).toBeVisible();
  });

  test('menu mode replaces the bar with a header menu that reaches every page', async ({
    page,
  }) => {
    const tripId = await seedOneTrip(page);

    await page.goto('/settings');
    await waitForRoute(page);
    await page.getByRole('radio', { name: LABELS.menuMode }).click();

    await page.goto(`/trips/${tripId}/calendar`);
    await waitForRoute(page);

    await expect(bottomBar(page)).toHaveCount(0);
    await page.getByRole('banner').getByRole('button', { name: LABELS.menu }).click();

    const menu = page.getByRole('navigation', { name: LABELS.moreNav });
    await menu.getByRole('button', { name: /^(transport|transports)$/i }).click();

    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/transports$`));
  });

  test('without the bar, the FAB sits at the bottom instead of above a hole', async ({
    page,
  }) => {
    await seedOneTrip(page);

    await page.goto('/settings');
    await waitForRoute(page);
    await page.getByRole('radio', { name: LABELS.menuMode }).click();

    // A list with a trip on it: an empty one puts its create button in the
    // empty state rather than in a FAB.
    await page.goto('/trips');
    await waitForRoute(page);

    const fab = page.locator('button.fixed.rounded-full').last();
    await expect(fab).toBeVisible();
    const box = await fab.boundingBox();
    expect(box).not.toBeNull();
    // `bottom-nav-safe` is 1rem with the bar off, 5rem with it on.
    expect(PHONE.height - (box!.y + box!.height)).toBeLessThan(32);
  });

  test('automatic mode drops the bar on a very narrow phone', async ({ page }) => {
    const tripId = await seedOneTrip(page);
    await page.setViewportSize(NARROW_PHONE);

    await page.goto(`/trips/${tripId}/calendar`);
    await waitForRoute(page);

    await expect(page.getByRole('banner').getByRole('button', { name: LABELS.menu })).toBeVisible();
    await expect(bottomBar(page)).toHaveCount(0);
  });
});
