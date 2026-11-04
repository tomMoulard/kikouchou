/**
 * @fileoverview Creating a trip through the UI, wizard or form.
 *
 * `/trips/new` asks a device with no trip of its own for a name, then shows
 * the trip's invite link (`TripCreateWizard`). A device that already holds a
 * trip gets the one-page form. Neither asks for the dates: a trip is created
 * without them, and the calendar's setup checklist asks for them. The helpers
 * here set them through that checklist ({@link setTripDatesFromChecklist}),
 * unless a spec asks for a trip without dates. Automation turns the sample trip off, so every spec starts on
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
import { guestCards } from './page-regions';
import { seedTrip } from './seed';
import { clearTripOrganiser } from './trip-form';

// ============================================================================
// Type Definitions
// ============================================================================

export interface NewTripOptions {
  /**
   * Takes the signed-in user off the guest list. Signed in, both screens put
   * the account on it: the form as a row to remove, the wizard straight into
   * the trip, so the wizard's path removes it from the Guests page.
   */
  readonly dropOrganiser?: boolean;
  /**
   * Leaves the trip without dates. By default the helpers set the 15th to the
   * 22nd of the current month through the calendar's setup checklist, which
   * is what most specs assume.
   */
  readonly withoutDates?: boolean;
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
 * Sets the open trip's dates the way a user does: the "Set dates" step of the
 * calendar's setup checklist, then the date fields of the trip's settings.
 * Lands back on the calendar.
 *
 * @param page - Playwright page on the calendar of a trip without dates
 * @param startDate - First day, `YYYY-MM-DD` (default: the 15th of this month)
 * @param endDate - Last day, `YYYY-MM-DD` (default: the 22nd of this month)
 */
export async function setTripDatesFromChecklist(
  page: Page,
  startDate: string = fixtureDate(15, 0),
  endDate: string = fixtureDate(22, 0),
): Promise<void> {
  await page.getByRole('button', { name: /^set dates$/i }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+\/edit/, { timeout: 15_000 });
  await page.locator('#trip-start-date').fill(startDate);
  await page.locator('#trip-end-date').fill(endDate);
  await page.getByRole('button', { name: /save/i }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+\/calendar/, { timeout: 15_000 });
}

/**
 * Deletes every guest of the open trip from its Guests page, then returns to
 * the calendar.
 *
 * @param page - Playwright page on the trip's calendar
 */
async function removeAllGuests(page: Page): Promise<void> {
  const calendarUrl = page.url();
  await page.goto(calendarUrl.replace(/\/calendar.*$/, '/persons'));
  const list = guestCards(page);
  const empty = page.getByText(/no guests yet/i);
  await expect(list.or(empty).first()).toBeVisible({ timeout: 15_000 });

  const cards = list.getByRole('listitem');
  while ((await cards.count()) > 0) {
    const before = await cards.count();
    await cards.first().getByRole('button', { name: /^delete$/i }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: /^delete$/i }).click();
    await expect(cards).toHaveCount(before - 1, { timeout: 10_000 });
  }

  await page.goto(calendarUrl);
}

/**
 * Creates a trip with a name through the first-trip wizard, opens its
 * calendar, and sets its dates there (unless `withoutDates`).
 *
 * Leaves the invite screen without sending the link: "Open the calendar" when
 * signed in, "Later" when the screen asks for an account.
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
  // The name is the only question: Enter creates the trip.
  await page.keyboard.press('Enter');

  // The invite screen. Left only once the link has settled: a link, a sign-in,
  // or a build with no server. Leaving while the invite is being minted would
  // race the share dialog a test opens next, and could leave two invites.
  const invite = page.getByTestId('trip-wizard-invite');
  await expect(invite).toBeVisible({ timeout: 15_000 });
  const later = invite.getByRole('button', { name: /^later, open the trip$/i });
  await expect(
    invite.getByTestId('share-url').or(later).or(invite.getByRole('alert')).first(),
  ).toBeVisible({ timeout: 20_000 });
  await invite
    .getByRole('button', { name: /^(open the calendar|later, open the trip)$/i })
    .click();
  await expect(page).toHaveURL(/\/trips\/[^/]+\/calendar/, { timeout: 15_000 });

  if (options.withoutDates !== true) {
    await setTripDatesFromChecklist(page);
  }
  if (options.dropOrganiser === true) {
    await removeAllGuests(page);
  }
}

/**
 * Creates a trip with a name on whichever screen `/trips/new` shows, lands on
 * its calendar, and sets its dates there (unless `withoutDates`): the 15th to
 * the 22nd of the current month.
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
  if (options.dropOrganiser === true) {
    await clearTripOrganiser(page);
  }
  await page.getByRole('button', { name: /save/i }).click();
  await expect(page).toHaveURL(/\/trips\/[^/]+\/calendar/, { timeout: 15_000 });
  if (options.withoutDates !== true) {
    await setTripDatesFromChecklist(page);
  }
}
