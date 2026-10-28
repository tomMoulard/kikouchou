/**
 * @fileoverview The first trip, one question per screen.
 *
 * The wizard replaces the one-page form on `/trips/new` for a device that
 * holds no trip yet. A device with a trip gets the form. Specs that need a
 * trip and nothing more use `support/trip-create`.
 *
 * @module e2e/trip-create-wizard
 */

import { expect, test } from '@playwright/test';

import { guestCards, roomCards } from './support/page-regions';
import { pickWizardDates } from './support/trip-create';

// ============================================================================
// Helpers
// ============================================================================

// ============================================================================
// Tests
// ============================================================================

test.describe('the first-trip wizard', () => {
  test('walks a first trip through one question per screen', async ({ page }) => {
    await page.goto('/trips/new');

    // One question on screen at a time, and Enter answers it.
    await expect(page.getByText(/what is the trip called/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/when is it/i)).toHaveCount(0);
    await page.getByLabel(/trip name/i).fill('Lake house');
    await page.keyboard.press('Enter');

    await expect(page.getByText(/when is it/i)).toBeVisible();
    await pickWizardDates(page);
    await page.getByRole('button', { name: /^next$/i }).click();

    // Everything after the dates can be skipped.
    await expect(page.getByText(/where is the house/i)).toBeVisible();
    await page.getByRole('button', { name: /skip for now/i }).click();

    await expect(page.getByText(/who is coming/i)).toBeVisible();
    await page.getByLabel(/guest name/i).fill('Alice');
    await page.keyboard.press('Enter');
    await page.getByLabel(/guest name/i).fill('Bob');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Alice')).toBeVisible();
    await expect(page.getByText('Bob')).toBeVisible();
    // Enter with nothing typed moves on.
    await page.keyboard.press('Enter');

    await expect(page.getByText(/which rooms are there/i)).toBeVisible();
    await page.getByLabel(/room name/i).fill('Attic');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: /create the trip/i }).click();

    // The celebration, then the trip.
    await expect(page.getByTestId('trip-wizard-done')).toContainText(/lake house is ready/i, {
      timeout: 15_000,
    });
    await page.getByRole('button', { name: /open the calendar/i }).click();
    await expect(page).toHaveURL(/\/trips\/[^/]+\/calendar/, { timeout: 15_000 });
    await expect(page.getByText('Lake house').first()).toBeVisible();

    // The guests and the room exist. Each is read from the page's own list:
    // the organiser's column beside these pages names them again.
    await page.getByRole('link', { name: /guests/i }).first().click();
    await expect(guestCards(page).getByText('Alice')).toBeVisible({
      timeout: 15_000,
    });
    await expect(guestCards(page).getByText('Bob')).toBeVisible();
    await page.getByRole('link', { name: /^(rooms|chambres)$/i }).first().click();
    // In the cards view, where a room's name is always printed. A phone opens
    // on the timeline, and on a day inside the trip it scrolls to now and
    // folds the label column: the name then lives only in the row's
    // aria-label, so the assertion passed or failed by the date.
    await page.getByRole('radio', { name: /^(cards|cartes)$/i }).click();
    await expect(roomCards(page).getByText('Attic')).toBeVisible({ timeout: 15_000 });
  });

  test('keeps the guest field focused after the Add button', async ({ page, isMobile }) => {
    await page.goto('/trips/new');
    await page.getByLabel(/trip name/i).fill('Lake house');
    await page.keyboard.press('Enter');
    await pickWizardDates(page);
    await page.getByRole('button', { name: /^next$/i }).click();
    await page.getByRole('button', { name: /skip for now/i }).click();

    // A phone taps the button. Focus moving to it closes the keyboard, and
    // the next name then needs a tap back into the field.
    const field = page.getByLabel(/guest name/i);
    const add = page.getByRole('button', { name: /^add$/i });
    await field.fill('Alice');
    await (isMobile ? add.tap() : add.click());
    await expect(page.getByText('Alice')).toBeVisible();
    await expect(field).toBeFocused();
    await expect(field).toHaveValue('');

    // So the next name is typed straight in.
    await page.keyboard.type('Bob');
    await (isMobile ? add.tap() : add.click());
    await expect(page.getByText('Bob')).toBeVisible();
    await expect(field).toBeFocused();
  });

  test('is only ever for the first trip on a device', async ({ page }) => {
    await page.goto('/trips/new');
    await page.getByLabel(/trip name/i).fill('First');
    await page.keyboard.press('Enter');
    await pickWizardDates(page);
    await page.getByRole('button', { name: /^next$/i }).click();
    await page.getByRole('button', { name: /skip for now/i }).click();
    await page.getByRole('button', { name: /skip for now/i }).click();
    await page.getByRole('button', { name: /create the trip/i }).click();
    await page.getByRole('button', { name: /open the calendar/i }).click({ timeout: 15_000 });
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
