/**
 * @fileoverview The first trip: a name, then the invite link. The dates come
 * later, from the calendar's setup checklist.
 *
 * The wizard replaces the one-page form on `/trips/new` for a device that
 * holds no trip yet. A device with a trip gets the form. Specs that need a
 * trip and nothing more use `support/trip-create`.
 *
 * @module e2e/trip-create-wizard
 */

import { expect, test, type Page } from '@playwright/test';

import { fixtureDate } from './support/fixture-dates';
import { setTripDatesFromChecklist } from './support/trip-create';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Creates a trip with the wizard's one question and opens its calendar from
 * the invite screen.
 *
 * @param page - Playwright page on `/trips/new` with no trip yet
 * @param name - The trip's name
 */
async function createThroughWizard(page: Page, name: string): Promise<void> {
  await page.getByLabel(/trip name/i).fill(name);
  await page.keyboard.press('Enter');
  await page
    .getByTestId('trip-wizard-invite')
    .getByRole('button', { name: /^(open the calendar|later, open the trip)$/i })
    .click({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/calendar/, { timeout: 15_000 });
}

// ============================================================================
// Tests
// ============================================================================

test.describe('the first-trip wizard', () => {
  test('asks only a name, then hands over the invite', async ({ page }) => {
    await page.goto('/trips/new');

    // One question, and Enter answers it. No dates are asked.
    await expect(page.getByText(/what is the trip called/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/when is it/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^next$/i })).toHaveCount(0);
    await page.getByLabel(/trip name/i).fill('Lake house');
    await page.keyboard.press('Enter');

    // No date, place, guest or room question: the invite comes next.
    const invite = page.getByTestId('trip-wizard-invite');
    await expect(invite).toContainText(/lake house is ready: invite the group/i, {
      timeout: 15_000,
    });
    await expect(
      page.getByText(/when is it|where is the house|who is coming|which rooms/i),
    ).toHaveCount(0);
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
    await createThroughWizard(page, 'First');

    // A second trip gets the one-page form, which asks for no dates either.
    await page.goto('/trips/new');
    await expect(page.locator('#trip-name')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/what is the trip called/i)).toHaveCount(0);
    await expect(page.locator('#trip-start-date')).toHaveCount(0);
  });
});

test.describe('a trip without dates', () => {
  test('shows a plain calendar and asks for the dates in the checklist', async ({ page }) => {
    await page.goto('/trips/new');
    await createThroughWizard(page, 'Lake house');

    // The timeline is drawn with no trip bounds, and the trip says it has no
    // dates rather than "undefined - undefined".
    await expect(page.getByRole('region', { name: /timeline calendar/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/undefined/i)).toHaveCount(0);

    // The checklist under the timeline asks for the dates.
    await expect(page.getByText(/^set the trip dates$/i)).toBeVisible();
    await expect(page.getByText(/^no dates yet/i)).toBeVisible();

    await setTripDatesFromChecklist(page, fixtureDate(15, 0), fixtureDate(22, 0));

    // Back on the calendar, the step is done.
    await expect(page.getByText(/^dates set$/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /^set dates$/i })).toHaveCount(0);
  });

  test('can lose its dates again from the trip settings', async ({ page }) => {
    await page.goto('/trips/new');
    await createThroughWizard(page, 'Lake house');
    await setTripDatesFromChecklist(page);

    const calendarUrl = page.url();
    await page.goto(calendarUrl.replace(/\/calendar.*$/, '/edit'));
    await expect(page.locator('#trip-start-date')).not.toHaveValue('', { timeout: 15_000 });
    await page.getByRole('button', { name: /^clear dates$/i }).click();
    await expect(page.locator('#trip-start-date')).toHaveValue('');
    await expect(page.locator('#trip-end-date')).toHaveValue('');
    await page.getByRole('button', { name: /save/i }).click();
    await expect(page).toHaveURL(/\/calendar/, { timeout: 15_000 });

    await expect(page.getByRole('button', { name: /^set dates$/i })).toBeVisible({
      timeout: 15_000,
    });
  });
});
