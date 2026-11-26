/**
 * @fileoverview Achievements: the card on Settings is folded until opened,
 * keeps the hidden ones secret, and a trip created through the real wizard
 * unlocks the first tier with one message in the page.
 *
 * @module e2e/achievements
 */

import { test, expect, type Page } from '@playwright/test';

import { waitForRoute } from './support/routes';
import { createTripThroughWizard } from './support/trip-create';

// ============================================================================
// Fixtures
// ============================================================================

/** Labels in either language: the app may start in French or English. */
const CARD_LABEL = /^(achievements|succès)/i,
  HIDDEN_NAME = /^(hidden achievement|succès caché)$/i,
  FIRST_TRIP = /^(first trip|premier voyage)$/i;

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
  test('the card is folded, then lists all fifteen with the secrets kept', async ({ page }) => {
    const list = await openAchievements(page);

    await expect(list.getByRole('listitem')).toHaveCount(15);
    await expect(list.getByText(HIDDEN_NAME)).toHaveCount(5);
    await expect(page.getByText(/0 (of|sur) 15/)).toBeVisible();
  });

  test('creating a trip unlocks the first tier, and says so once', async ({ page }) => {
    await page.goto('/trips/new');
    await waitForRoute(page);
    await createTripThroughWizard(page, 'Achievement trip', { withoutDates: true });

    await expect(
      page.getByText(/^(achievement unlocked|succès débloqué)$/i),
    ).toHaveCount(1, { timeout: 10_000 });

    const list = await openAchievements(page);
    await expect(page.getByText(/1 (of|sur) 15/)).toBeVisible();
    await expect(list.getByText(FIRST_TRIP)).toBeVisible();
  });
});
