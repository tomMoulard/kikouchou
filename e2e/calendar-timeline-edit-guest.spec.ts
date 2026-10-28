/**
 * @fileoverview E2E cover for opening a guest's edit dialog from the calendar
 * timeline: a click on the name in the label column.
 *
 * The click lands on a transparent button laid over the label cell, which only
 * a real browser's hit testing proves reaches it — jsdom clicks whatever
 * element it is handed.
 *
 * Locators go through `data-testid` and the form's ids rather than label text:
 * the app defaults to French. Guest names are fixture data and are safe to
 * match.
 *
 * @module e2e/calendar-timeline-edit-guest
 */

import { expect, test } from '@playwright/test';

import { waitForRoute } from './support/routes';
import { seedPerson, seedTrip } from './support/seed';
import { clearIndexedDB } from './support/storage';

/** Dates are derived from today so the fixture never falls into the past. */
function isoDate(daysFromToday: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
}

test.describe('Calendar timeline', () => {
  test('clicking a guest name in the timeline opens its edit dialog', async ({ page }) => {
    await clearIndexedDB(page);

    const { tripId } = await seedTrip(page, {
      name: 'Timeline Trip',
      startDate: isoDate(30),
      endDate: isoDate(40),
    });
    const alice = await seedPerson(page, tripId, 'Alice');

    await page.goto(`/trips/${tripId}/calendar`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    // Clicks the label cell, as a user would, rather than the button: the
    // dialog only opens if the overlay is what sits under the pointer there.
    const labelCell = page
      .getByTestId(`calendar-timeline-edit-person-${alice}`)
      .locator('..');
    await expect(labelCell).toContainText('Alice');
    await labelCell.click();

    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#person-name')).toHaveValue('Alice');
  });
});
