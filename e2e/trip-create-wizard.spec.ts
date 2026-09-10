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
    await expect(roomCards(page).getByText('Attic')).toBeVisible({ timeout: 15_000 });
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
