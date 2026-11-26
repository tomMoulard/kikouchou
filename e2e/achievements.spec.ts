/**
 * @fileoverview Achievements: the card on Settings is folded until opened,
 * shows nine family tiles and the specials, keeps the hidden ones secret, and
 * a trip created through the real wizard reaches the first stage of the trips
 * family with one message in the page.
 *
 * @module e2e/achievements
 */

import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

import { waitForRoute } from './support/routes';
import { createTripThroughWizard } from './support/trip-create';

// ============================================================================
// Fixtures
// ============================================================================

/** Labels in either language: the app may start in French or English. */
const CARD_LABEL = /^(achievements|succès)/i,
  HIDDEN_NAME = /^(hidden achievement|succès caché)$/i,
  FIRST_TRIP = /^(first trip|premier voyage)$/i,
  TRIP_FAMILY = /^(trip maker|organisation)$/i,
  TOTAL = 53;

async function openAchievements(page: Page) {
  await page.goto('/settings');
  await waitForRoute(page);

  const toggle = page.getByRole('button', { name: CARD_LABEL });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  return page.locator('#achievements-list');
}

// ============================================================================
// Tests
// ============================================================================

test.describe('achievements', () => {
  test('the card is folded, then shows nine families and the specials, secrets kept', async ({
    page,
  }) => {
    const list = await openAchievements(page);

    // Nine tiles and eight specials: a tile lists its stages only once opened.
    await expect(list.getByRole('listitem')).toHaveCount(17);
    await expect(list.getByText(HIDDEN_NAME)).toHaveCount(5);
    await expect(page.getByText(new RegExp(`0 (of|sur) ${TOTAL}`))).toBeVisible();
  });

  test('creating a trip unlocks the first tier, and says so once', async ({ page }) => {
    await page.goto('/trips/new');
    await waitForRoute(page);
    await createTripThroughWizard(page, 'Achievement trip', { withoutDates: true });

    await expect(
      page.getByText(/^(achievement unlocked|succès débloqué)$/i),
    ).toHaveCount(1, { timeout: 10_000 });

    const list = await openAchievements(page);
    await expect(page.getByText(new RegExp(`1 (of|sur) ${TOTAL}`))).toBeVisible();

    const tile = list.getByRole('listitem').filter({ has: page.getByText(TRIP_FAMILY) });
    await expect(tile.getByText(FIRST_TRIP)).toBeVisible();

    const unfold = tile.getByRole('button');
    await unfold.click();
    await expect(unfold).toHaveAttribute('aria-expanded', 'true');
    await expect(tile.locator('ol > li')).toHaveCount(5);

    // Rings, stage states and the muted locked rows all hold their contrast.
    const results = await new AxeBuilder({ page }).include('#achievements-list').analyze();
    expect(results.violations).toEqual([]);
    await list.screenshot({ path: test.info().outputPath('achievements-card.png') });
  });
});
