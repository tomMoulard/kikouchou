/**
 * @fileoverview E2E tests for a room's beds.
 *
 * A room that can be set up two ways (two 80 × 200 singles, or the singles
 * pushed into one queen) is described in its dialog, saved, and read back on
 * its card, after a reload, as a guest would read it.
 *
 * @module e2e/room-beds
 */

import { test, expect } from '@playwright/test';

import { fixtureDate } from './support/fixture-dates';
import { roomCards } from './support/page-regions';
import { waitForRoute } from './support/routes';
import { seedRoom, seedTrip } from './support/seed';
import { clearIndexedDB } from './support/storage';

test.describe('Room beds', () => {
  test.beforeEach(async ({ page }) => {
    await clearIndexedDB(page);
  });

  test('a room described as two singles or one queen shows both, and sleeps two', async ({ page }) => {
    const { tripId } = await seedTrip(page, {
      name: 'Beds Trip',
      startDate: fixtureDate(3),
      endDate: fixtureDate(6),
    });
    await seedRoom(page, { tripId, name: 'Attic', capacity: 2 });

    await page.goto(`/trips/${tripId}/rooms?view=card`);
    await waitForRoute(page);

    await page.getByLabel(/open menu|ouvrir le menu/iu).first().click();
    await page.getByRole('menuitem', { name: /^(edit|modifier)$/iu }).click();
    const dialog = page.getByRole('dialog');

    await dialog.getByRole('button', { name: 'Describe the beds' }).click();

    // A room for two starts as one double: make it two 80 × 200 singles.
    const first = dialog.getByRole('group', { name: 'Layout 1' });
    await first.getByRole('combobox', { name: 'Kind of bed' }).click();
    await page.getByRole('option', { name: 'Single' }).click();
    await first.getByRole('button', { name: 'One bed more' }).click();
    await first.getByLabel('Width (cm)').fill('80');
    await first.getByLabel('Length (cm)').fill('200');

    // The other way: the singles pushed together, a queen by default.
    await dialog.getByRole('button', { name: 'Add another way to set up the beds' }).click();
    const second = dialog.getByRole('group', { name: 'Layout 2' });
    await first.getByLabel('Name of this layout').fill('Twin');
    await second.getByLabel('Name of this layout').fill('Together');

    await expect(dialog.getByText('Sleeps 2')).toBeVisible();
    await dialog.getByRole('button', { name: /^(save|enregistrer)$/iu }).click();
    await expect(dialog).toBeHidden();

    const beds = roomCards(page).getByRole('list', { name: 'Beds' });
    await expect(beds).toContainText('Twin: 2 × Single · 80 × 200');
    await expect(beds).toContainText('or Together: Queen · 160 × 200');
    await expect(roomCards(page).getByText('Sleeps 2')).toBeVisible();

    // The beds are stored on the device, not held by the page.
    await page.reload();
    await waitForRoute(page);
    await expect(roomCards(page).getByRole('list', { name: 'Beds' })).toContainText(
      'Twin: 2 × Single · 80 × 200',
    );
  });
});
