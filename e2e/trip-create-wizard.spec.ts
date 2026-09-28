/**
 * @fileoverview The first trip, one question per screen — behind its flag.
 *
 * The wizard replaces the one-page form on `/trips/new` for a device that
 * holds no trip yet, when the `first-trip-wizard` flag is on. These tests force
 * the flag through the local override `useFeatureFlag` honours, because the
 * e2e servers carry no PostHog key on purpose; every other spec in this
 * directory creates trips through the form, which is what a device without the
 * flag still gets.
 *
 * @module e2e/trip-create-wizard
 */

import { expect, test, type Page } from '@playwright/test';

import { guestCards, roomCards } from './support/page-regions';

// ============================================================================
// Helpers
// ============================================================================

const FLAG_ON = `localStorage.setItem('kikouchou-flag:first-trip-wizard', 'on');`;

/** Picks the 15th and the 22nd of the month the range picker opens on. */
async function pickDates(page: Page): Promise<void> {
  await page.getByRole('button', { name: /trip dates/i }).click();
  await page.getByRole('gridcell').filter({ hasText: /^15$/ }).first().click();
  await page.getByRole('gridcell').filter({ hasText: /^22$/ }).first().click();
}

// ============================================================================
// Tests
// ============================================================================

test.describe('the first-trip wizard', () => {
  test('walks a first trip through one question per screen', async ({ page }) => {
    await page.addInitScript(FLAG_ON);
    await page.goto('/trips/new');

    // One question on screen at a time, and Enter answers it.
    await expect(page.getByText(/what is the trip called/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/when is it/i)).toHaveCount(0);
    await page.getByLabel(/trip name/i).fill('Lake house');
    await page.keyboard.press('Enter');

    await expect(page.getByText(/when is it/i)).toBeVisible();
    await pickDates(page);
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
    await page.addInitScript(FLAG_ON);
    await page.goto('/trips/new');
    await page.getByLabel(/trip name/i).fill('Lake house');
    await page.keyboard.press('Enter');
    await pickDates(page);
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
    await page.addInitScript(FLAG_ON);
    await page.goto('/trips/new');
    await page.getByLabel(/trip name/i).fill('First');
    await page.keyboard.press('Enter');
    await pickDates(page);
    await page.getByRole('button', { name: /^next$/i }).click();
    await page.getByRole('button', { name: /skip for now/i }).click();
    await page.getByRole('button', { name: /skip for now/i }).click();
    await page.getByRole('button', { name: /create the trip/i }).click();
    await page.getByRole('button', { name: /open the calendar/i }).click({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/calendar/, { timeout: 15_000 });

    // A second trip gets the one-page form, flag or not.
    await page.goto('/trips/new');
    await expect(page.locator('#trip-start-date')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/what is the trip called/i)).toHaveCount(0);
  });

  test('stays off without the flag', async ({ page }) => {
    await page.goto('/trips/new');

    await expect(page.locator('#trip-start-date')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/what is the trip called/i)).toHaveCount(0);
  });
});

/**
 * The replay that reported this ran on a 384×697 Chrome. The popover opened
 * against the left edge of the screen with most of it empty beside it; on a
 * phone the calendar is now a dialog that spans the screen between equal
 * gutters.
 */
test.describe('the dates step on a phone', () => {
  test.use({ viewport: { width: 384, height: 697 } });

  test('opens the calendar centred, across the width of the screen', async ({ page }) => {
    await page.addInitScript(FLAG_ON);
    await page.goto('/trips/new');

    await page.getByLabel(/trip name/i).fill('Lake house');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/when is it/i)).toBeVisible();
    await page.getByRole('button', { name: /trip dates/i }).click();

    const dialog = page.getByRole('dialog', { name: /select date range/i });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    if (box === null) return;

    const leftGutter = box.x,
     rightGutter = 384 - (box.x + box.width);
    expect(leftGutter).toBeGreaterThan(8);
    expect(Math.abs(leftGutter - rightGutter)).toBeLessThanOrEqual(1);
    expect(box.width).toBeGreaterThan(384 * 0.85);
    expect(box.y + box.height).toBeLessThanOrEqual(697);

    // The day grid fills the dialog rather than sitting in a corner of it.
    const grid = await dialog.getByRole('grid').boundingBox();
    expect(grid?.width ?? 0).toBeGreaterThan(box.width * 0.85);

    await page.screenshot({ path: test.info().outputPath('dates-on-a-phone.png') });

    // And it still picks a range and closes.
    await page.getByRole('gridcell').filter({ hasText: /^15$/ }).first().click();
    await page.getByRole('gridcell').filter({ hasText: /^22$/ }).first().click();
    await expect(dialog).toBeHidden();
  });
});
