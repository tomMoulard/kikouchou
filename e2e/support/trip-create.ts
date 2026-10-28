/**
 * @fileoverview Creating a trip through the UI, wizard or form.
 *
 * `/trips/new` asks a device with no trip of its own one question per screen
 * (`TripCreateWizard`), and gives a device that already holds a trip the
 * one-page form. Automation turns the sample trip off, so every spec starts on
 * an empty device and its first trip goes through the wizard. A spec that
 * creates two trips meets both screens.
 *
 * Specs that are about the form seed a trip first (`seedTrip`) and stay on the
 * form. Specs that only need a trip call {@link fillNewTrip}, which answers
 * whichever screen is shown.
 *
 * @module e2e/support/trip-create
 */

import { expect, type Page } from '@playwright/test';

import { fixtureDate } from './fixture-dates';
import { seedTrip } from './seed';
import { clearTripOrganiser } from './trip-form';

// ============================================================================
// Type Definitions
// ============================================================================

export interface NewTripOptions {
  /**
   * Takes the signed-in user off the guest list. Signed in, both screens
   * pre-fill the first guest from the account.
   */
  readonly dropOrganiser?: boolean;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Writes a trip the user made earlier, so `/trips/new` shows the one-page form
 * rather than the first-trip wizard.
 *
 * Six months out, so it never shares a name or a month with the trip a test
 * creates. Leaves the page on `/trips`.
 *
 * @param page - Playwright page object
 * @returns The seeded trip's id
 */
export async function seedEarlierTrip(page: Page): Promise<string> {
  const { tripId } = await seedTrip(page, {
    name: 'Earlier trip',
    startDate: fixtureDate(1, 6),
    endDate: fixtureDate(5, 6),
  });
  return tripId;
}

/**
 * Fills the 15th and the 22nd of the current month into the wizard's two
 * native date inputs.
 *
 * @param page - Playwright page on the wizard's dates step
 */
export async function pickWizardDates(page: Page): Promise<void> {
  const dates = page.getByRole('group', { name: /trip dates/i });
  await dates.getByLabel(/^from$/i).fill(fixtureDate(15, 0));
  await dates.getByLabel(/^to$/i).fill(fixtureDate(22, 0));
}

/**
 * Creates a trip with a name and dates through the first-trip wizard, and
 * opens its calendar.
 *
 * Skips the place, the guests and the rooms.
 *
 * @param page - Playwright page sitting on `/trips/new` with no trip yet
 * @param name - The trip's name
 * @param options - See {@link NewTripOptions}
 */
export async function createTripThroughWizard(
  page: Page,
  name: string,
  options: NewTripOptions = {},
): Promise<void> {
  await expect(page.locator('#wizard-trip-name')).toBeVisible({ timeout: 15_000 });
  await page.locator('#wizard-trip-name').fill(name);
  await page.keyboard.press('Enter');

  await pickWizardDates(page);
  await page.getByRole('button', { name: /^next$/i }).click();

  // The place.
  await page.getByRole('button', { name: /skip for now/i }).click();

  // The guests. Signed in, the account is already on the list as "You".
  await expect(page.locator('#wizard-guest-name')).toBeVisible();
  if (options.dropOrganiser === true) {
    const remove = page
      .getByRole('list', { name: /who is coming/i })
      .getByRole('button', { name: /^remove /i });
    while ((await remove.count()) > 0) {
      await remove.first().click();
    }
  }
  await page.getByRole('button', { name: /skip for now/i }).click();

  // The rooms, the last question.
  await page.getByRole('button', { name: /create the trip/i }).click();

  await page.getByRole('button', { name: /open the calendar/i }).click({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/trips\/[^/]+\/calendar/, { timeout: 15_000 });
}

/**
 * Creates a trip with a name and dates on whichever screen `/trips/new` shows,
 * and lands on its calendar.
 *
 * The form's dates are the 15th and the 22nd of the current month, the same
 * days the wizard gets.
 *
 * @param page - Playwright page sitting on `/trips/new`
 * @param name - The trip's name
 * @param options - See {@link NewTripOptions}
 */
export async function fillNewTrip(
  page: Page,
  name: string,
  options: NewTripOptions = {},
): Promise<void> {
  await expect(page.locator('#wizard-trip-name, #trip-name').first()).toBeVisible({
    timeout: 15_000,
  });

  if ((await page.locator('#wizard-trip-name').count()) > 0) {
    await createTripThroughWizard(page, name, options);
    return;
  }

  await page.locator('#trip-name').fill(name);
  await page.locator('#trip-start-date').fill(fixtureDate(15, 0));
  await page.locator('#trip-end-date').fill(fixtureDate(22, 0));
  if (options.dropOrganiser === true) {
    await clearTripOrganiser(page);
  }
  await page.getByRole('button', { name: /save/i }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+\/calendar/, { timeout: 15_000 });
}
