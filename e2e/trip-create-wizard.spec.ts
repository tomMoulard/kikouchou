/**
 * @fileoverview The first trip: a name, the dates, then the invite link.
 *
 * The wizard replaces the one-page form on `/trips/new` for a device that
 * holds no trip yet. A device with a trip gets the form. Specs that need a
 * trip and nothing more use `support/trip-create`.
 *
 * @module e2e/trip-create-wizard
 */

import { expect, test } from '@playwright/test';

import { pickWizardDates } from './support/trip-create';

// ============================================================================
// Tests
// ============================================================================

test.describe('the first-trip wizard', () => {
  test('asks a name and the dates, then hands over the invite', async ({ page }) => {
    await page.goto('/trips/new');

    // One question on screen at a time, and Enter answers it.
    await expect(page.getByText(/what is the trip called/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/when is it/i)).toHaveCount(0);
    await page.getByLabel(/trip name/i).fill('Lake house');
    await page.keyboard.press('Enter');

    // The dates are the last question: their button creates the trip.
    await expect(page.getByText(/when is it/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^next$/i })).toHaveCount(0);
    await pickWizardDates(page);
    await page.getByRole('button', { name: /create the trip/i }).click();

    // No place, guest or room question: the invite comes next.
    const invite = page.getByTestId('trip-wizard-invite');
    await expect(invite).toContainText(/lake house is ready: invite the group/i, {
      timeout: 15_000,
    });
    await expect(page.getByText(/where is the house|who is coming|which rooms/i)).toHaveCount(0);
    // The link needs a sync server and an account. This build has no server,
    // the deployed app asks for an account: either way the screen says so
    // rather than spinning.
    await expect(
      invite.getByRole('alert').or(invite.getByText(/sharing needs an account/i)).first(),
    ).toBeVisible({ timeout: 15_000 });

    await invite
      .getByRole('button', { name: /^(open the calendar|later, open the trip)$/i })
      .click();
    await expect(page).toHaveURL(/\/trips\/[^/]+\/calendar/, { timeout: 15_000 });
    await expect(page.getByText('Lake house').first()).toBeVisible();
  });

  test('is only ever for the first trip on a device', async ({ page }) => {
    await page.goto('/trips/new');
    await page.getByLabel(/trip name/i).fill('First');
    await page.keyboard.press('Enter');
    await pickWizardDates(page);
    await page.getByRole('button', { name: /create the trip/i }).click();
    await page
      .getByTestId('trip-wizard-invite')
      .getByRole('button', { name: /^(open the calendar|later, open the trip)$/i })
      .click({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/calendar/, { timeout: 15_000 });

    // A second trip gets the one-page form.
    await page.goto('/trips/new');
    await expect(page.locator('#trip-start-date')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/what is the trip called/i)).toHaveCount(0);
  });
});

/**
 * The replay that reported this ran on a 384×697 Chrome, where a drawn
 * calendar opened against one edge of the screen. The dates are now the
 * phone's own date inputs; this keeps them on the screen.
 */
test.describe('the dates step on a phone', () => {
  test.use({ viewport: { width: 384, height: 697 } });

  test('fits both date inputs on the screen and takes a range', async ({ page }) => {
    await page.goto('/trips/new');

    await page.getByLabel(/trip name/i).fill('Lake house');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/when is it/i)).toBeVisible();

    const dates = page.getByRole('group', { name: /trip dates/i });
    for (const label of [/^from$/i, /^to$/i]) {
      const box = await dates.getByLabel(label).boundingBox();
      expect(box).not.toBeNull();
      if (box === null) return;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(384);
    }

    await pickWizardDates(page);
    await expect(dates.getByLabel(/^from$/i)).not.toHaveValue('');
    await expect(dates.getByLabel(/^to$/i)).not.toHaveValue('');
  });
});
