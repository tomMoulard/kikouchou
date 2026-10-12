/**
 * @fileoverview `/trips/new` on a phone held sideways: the form, and nothing else.
 *
 * A landscape iPhone reports 402px of viewport height. The shell spends a 56px
 * sticky header, 16px of top padding and a 64px bottom bar on that before the
 * page starts, which put the first question of the create form below the fold
 * on the one screen where the whole page is a form. The recording that prompted
 * this shows the visitor swiping and tapping at it and leaving.
 *
 * So the shell steps aside at this viewport, on this route only. The checks
 * below are geometry rather than appearance: the header and the bottom bar are
 * absent from the document, and the form's first control is measured to sit
 * inside the viewport without scrolling.
 *
 * @module e2e/trip-create-landscape
 */

import { expect, test, type Page } from '@playwright/test';

import { waitForRoute } from './support/routes';
import { seedEarlierTrip } from './support/trip-create';

// ============================================================================
// Fixtures
// ============================================================================

/** An iPhone held sideways, as PostHog recorded it: 750 x 402. */
const LANDSCAPE = { width: 750, height: 402 } as const;

/** The same phone upright, where the shell has the height it needs. */
const PORTRAIT = { width: 402, height: 750 } as const;

/**
 * The app's language detection can land on either locale; match both. The
 * form says "voyage" and the first-trip wizard says "séjour".
 */
const TRIP_NAME = /trip name|nom du voyage|nom du séjour/i;

/** The fixed bottom navigation bar, which has no role of its own. */
function bottomBar(page: Page) {
  return page.locator('nav.fixed.bottom-0');
}

// ============================================================================
// Tests
// ============================================================================

test.describe('creating a trip on a phone held sideways', () => {
  // An empty device, so this is the first-trip wizard: the first visit.
  test('drops the shell and leaves the form the whole screen', async ({ page }) => {
    await page.setViewportSize(LANDSCAPE);
    await page.goto('/trips/new');
    await waitForRoute(page);

    await expect(page.getByRole('banner')).toHaveCount(0);
    await expect(bottomBar(page)).toHaveCount(0);

    // The first field is on screen without scrolling. Measured at its own box
    // rather than asserted as "visible": Playwright calls an element visible
    // while it sits below the fold, which is exactly the bug.
    const firstField = page.getByLabel(TRIP_NAME).first();
    await expect(firstField).toBeVisible();
    const box = await firstField.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(LANDSCAPE.height);

    // And the page did not merely move the overflow elsewhere.
    const scrollTop = await page.evaluate(() => window.scrollY);
    expect(scrollTop).toBe(0);
  });

  test('puts the shell back the moment the phone is upright', async ({ page }) => {
    // A trip already on the device, so this is the one-page form, which keeps
    // the bottom bar when there is room for it.
    await seedEarlierTrip(page);
    await page.setViewportSize(PORTRAIT);
    await page.goto('/trips/new');
    await waitForRoute(page);

    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(bottomBar(page)).toHaveCount(1);
  });

  test('keeps the header but not the bottom bar beside the first-trip wizard', async ({
    page,
  }) => {
    await page.setViewportSize(PORTRAIT);
    await page.goto('/trips/new');
    await waitForRoute(page);

    // On a first visit no trip tab can open, so the bar has nowhere to go.
    await expect(page.getByLabel(TRIP_NAME).first()).toBeVisible();
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(bottomBar(page)).toHaveCount(0);
  });

  test('keeps the shell on the other routes at the same viewport', async ({ page }) => {
    await page.setViewportSize(LANDSCAPE);
    await page.goto('/trips');
    await waitForRoute(page);

    // The trip list is a list, and the navigation is how a phone leaves it.
    // Sideways, the automatic mode trades the 64px bar for the header's menu
    // button, so the button is the way out and the bar is gone.
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^menu$/i })).toBeVisible();
    await expect(bottomBar(page)).toHaveCount(0);
  });
});
