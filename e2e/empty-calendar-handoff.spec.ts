/**
 * @fileoverview E2E cover for the empty calendar's hand-off to guests and rooms.
 *
 * An empty calendar offers "Add guests" and "Add rooms", and each has to land
 * on a create form rather than on another empty list. The `?new=1` flag behind
 * that has its two halves in different features — the calendar builds the URL,
 * the list pages read it and then drop it — so a unit test on either side can
 * stay green while the hand-off itself is broken. This is the test that fails
 * when the two disagree, and the only place the "reload does not reopen it"
 * promise can be checked at all, since it is a claim about real history.
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
 * Matched against the dialog's *heading*, not its text: the description below
 * the title says "…to create a new room", so a text match resolves to two
 * elements and trips strict mode.
 */
const LABELS = {
  addGuests: /add guests|ajouter des invités/i,
  addRooms: /add rooms|ajouter des chambres/i,
  newGuest: /new guest|nouveau participant/i,
  newRoom: /new room|nouvelle chambre/i,
} as const;

/**
 * Seeds a trip with nothing in it and opens its calendar.
 *
 * Nothing in it is the point: the empty state renders only when the trip has
 * no assignments, transports or activities to show.
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
  test('"Add guests" opens the guest form, not the guest list', async ({ page }) => {
    const tripId = await openEmptyCalendar(page);

    await page.getByRole('button', { name: LABELS.addGuests }).click();

    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/persons`));
    // The form itself, open on arrival. Landing on an empty list with the
    // dialog shut is the failure this whole mechanism exists to avoid.
    await expect(page.getByRole('dialog').getByRole('heading', { name: LABELS.newGuest })).toBeVisible();
  });

  test('"Add rooms" opens the room form', async ({ page }) => {
    const tripId = await openEmptyCalendar(page);

    await page.getByRole('button', { name: LABELS.addRooms }).click();

    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/rooms`));
    await expect(page.getByRole('dialog').getByRole('heading', { name: LABELS.newRoom })).toBeVisible();
  });

  test('the flag is spent on arrival, so a reload does not reopen the form', async ({
    page,
  }) => {
    await openEmptyCalendar(page);

    await page.getByRole('button', { name: LABELS.addGuests }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Dropped from the URL as soon as it has done its job.
    await expect(page).not.toHaveURL(/[?&]new=/);

    await page.reload();
    await waitForRoute(page);

    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('the flag survives history, without popping the form open again', async ({
    page,
  }) => {
    const tripId = await openEmptyCalendar(page);

    await page.getByRole('button', { name: LABELS.addRooms }).click();
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
