/**
 * @fileoverview A guest who comes back: several stays on one guest, typed in
 * the guest form, shown on the guest card and as separate bars on the
 * calendar timeline.
 *
 * @module e2e/guest-several-stays
 */

import { expect, test, type Page } from '@playwright/test';

import { fixtureDate } from './support/fixture-dates';
import { guestCards } from './support/page-regions';
import { seedTrip } from './support/seed';

/**
 * Fills a stay picker (two native date inputs) by its group name.
 */
async function fillStay(page: Page, group: RegExp, start: string, end: string): Promise<void> {
  const picker = page.getByRole('dialog').getByRole('group', { name: group });
  await picker.getByLabel(/^(from|du)$/i).fill(start);
  await picker.getByLabel(/^(to|au)$/i).fill(end);
}

test.describe('a guest who stays several times', () => {
  test('is entered with two stays and shown with both', async ({ page }) => {
    const { tripId } = await seedTrip(page, {
      name: 'Summer house',
      startDate: fixtureDate(1),
      endDate: fixtureDate(20),
    });

    await page.goto(`/trips/${tripId}/persons`);
    await page
      .getByRole('button', { name: /^(new guest|nouveau participant)$/i })
      .filter({ visible: true })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    await page.locator('#person-name').fill('Ana');
    await fillStay(page, /^stay dates$/i, fixtureDate(1), fixtureDate(4));
    await dialog.getByRole('button', { name: /^add another stay$/i }).click();
    await fillStay(page, /^stay 2$/i, fixtureDate(10), fixtureDate(14));
    await dialog.getByRole('button', { name: /^save$/i }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // The card names both stays, joined with a middle dot.
    const card = guestCards(page).getByRole('listitem').filter({ hasText: 'Ana' });
    await expect(card).toContainText(' · ', { timeout: 10_000 });

    // The calendar outlines each stay on its own: two outlines, one row.
    await page.goto(`/trips/${tripId}/calendar`);
    const timeline = page.getByRole('region', { name: /timeline calendar/i });
    await expect(timeline).toBeVisible({ timeout: 15_000 });
    await expect(timeline.getByTestId('timeline-stay-outline')).toHaveCount(2);

    // And the stays survive a reload, read back from IndexedDB.
    await page.reload();
    await expect(
      page.getByRole('region', { name: /timeline calendar/i }).getByTestId('timeline-stay-outline'),
    ).toHaveCount(2, { timeout: 15_000 });
  });
});
