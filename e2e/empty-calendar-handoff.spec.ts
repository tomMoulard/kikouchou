/**
 * @fileoverview E2E cover for the empty calendar's hand-off to guests, rooms
 * and travel.
 *
 * A trip that is not set up yet gets a checklist instead of the calendar, and
 * each of its buttons has to land on a create form rather than on another empty
 * list. The `?new=1` flag behind that has its two halves in different features
 * — the calendar builds the URL, the list pages read it and then drop it — so a
 * unit test on either side can stay green while the hand-off itself is broken.
 * This is the test that fails when the two disagree, and the only place the
 * "reload does not reopen it" promise can be checked at all, since it is a
 * claim about real history.
 *
 * @module e2e/empty-calendar-handoff
 */

import { expect, test, type Page } from '@playwright/test';

import { fixtureDate } from './support/fixture-dates';
import { waitForRoute } from './support/routes';
import { seedTrip } from './support/seed';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Both locales, because the suite runs against whichever the browser asks for.
 *
 * The checklist's buttons are named after the form each one opens, so the same
 * pattern matches the button on the calendar and the heading of the dialog it
 * lands on. Matched against the dialog's *heading*, not its text: the
 * description below the title says "…to create a new room", so a text match
 * resolves to two elements and trips strict mode.
 */
const LABELS = {
  newGuest: /new guest|nouveau participant/i,
  newRoom: /new room|nouvelle chambre/i,
  newArrival: /new arrival|nouvelle arrivée/i,
  newTransport: /new transport|nouveau transport/i,
  setupTitle: /set this trip up|configurez ce séjour/i,
} as const;

/**
 * Seeds a trip with nothing in it and opens its calendar.
 *
 * Nothing in it is the point: no guests, no rooms and nothing scheduled is
 * exactly the state a trip is saved in, and the state the checklist is for.
 */
async function openEmptyCalendar(page: Page): Promise<string> {
  const { tripId } = await seedTrip(page, {
    name: 'Empty Calendar Trip',
    startDate: fixtureDate(1),
    endDate: fixtureDate(10),
  });

  await page.goto(`/trips/${tripId}/calendar`);
  await waitForRoute(page);

  return tripId;
}

// ============================================================================
// Tests
// ============================================================================

test.describe('empty calendar hand-off', () => {
  test('an unfinished trip gets the setup checklist', async ({ page }) => {
    await openEmptyCalendar(page);

    await expect(page.getByText(LABELS.setupTitle)).toBeVisible();
    // Nothing done yet, so every step still asks for something.
    await expect(page.getByRole('progressbar')).toBeVisible();
  });

  test('"New guest" opens the guest form, not the guest list', async ({ page }) => {
    const tripId = await openEmptyCalendar(page);

    await page.getByRole('button', { name: LABELS.newGuest }).click();

    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/persons`));
    // The form itself, open on arrival. Landing on an empty list with the
    // dialog shut is the failure this whole mechanism exists to avoid.
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: LABELS.newGuest }),
    ).toBeVisible();
  });

  test('"New room" opens the room form', async ({ page }) => {
    const tripId = await openEmptyCalendar(page);

    await page.getByRole('button', { name: LABELS.newRoom }).click();

    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/rooms`));
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: LABELS.newRoom }),
    ).toBeVisible();
  });

  test('"New arrival" opens the travel form', async ({ page }) => {
    const tripId = await openEmptyCalendar(page);

    await page.getByRole('button', { name: LABELS.newArrival }).click();

    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/transports`));
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: LABELS.newTransport }),
    ).toBeVisible();
  });

  test('the flag is spent on arrival, so a reload does not reopen the form', async ({
    page,
  }) => {
    await openEmptyCalendar(page);

    await page.getByRole('button', { name: LABELS.newGuest }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Dropped from the URL as soon as it has done its job.
    await expect(page).not.toHaveURL(/[?&]new=/);

    await page.reload();
    await waitForRoute(page);

    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('the same is true of the travel form', async ({ page }) => {
    await openEmptyCalendar(page);

    await page.getByRole('button', { name: LABELS.newArrival }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page).not.toHaveURL(/[?&]new=/);

    await page.reload();
    await waitForRoute(page);

    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('the flag survives history, without popping the form open again', async ({
    page,
  }) => {
    const tripId = await openEmptyCalendar(page);

    await page.getByRole('button', { name: LABELS.newRoom }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // `replace: true` is what makes this work: the entry that carried `?new=1`
    // was overwritten, so going back leaves the rooms page for the calendar
    // rather than stepping onto the flag a second time.
    await page.goBack();
    await waitForRoute(page);

    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/calendar`));
    await expect(page.getByRole('dialog')).toBeHidden();
  });
});
