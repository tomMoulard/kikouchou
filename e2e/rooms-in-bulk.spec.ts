/**
 * @fileoverview E2E tests for adding rooms several at a time, and for copying
 * one.
 *
 * A gîte with six identical doubles used to be six passes through the dialog.
 * These tests cover the two ways out of that: a count in the create dialog, and
 * Duplicate on a room that is already right.
 *
 * @module e2e/rooms-in-bulk
 */

import { test, expect, type Page } from '@playwright/test';

import { fixtureDate } from './support/fixture-dates';
import { waitForRoute } from './support/routes';
import { seedRoom, seedTrip } from './support/seed';
import { clearIndexedDB } from './support/storage';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Opens the rooms page in card view, where the room cards and their menus are.
 */
async function openRooms(page: Page, tripId: string): Promise<void> {
  await page.goto(`/trips/${tripId}/rooms?view=card`);
  await waitForRoute(page);
}

/**
 * Seeds a trip whose dates are always ahead of today.
 */
async function seedFutureTrip(page: Page): Promise<string> {
  const { tripId } = await seedTrip(page, {
    name: 'Bulk Rooms Trip',
    startDate: fixtureDate(1),
    endDate: fixtureDate(10),
  });
  return tripId;
}

// ============================================================================
// Tests
// ============================================================================

test.describe('Rooms in bulk', () => {
  test.beforeEach(async ({ page }) => {
    await clearIndexedDB(page);
  });

  test('creates three identical doubles in one save', async ({ page }) => {
    const tripId = await seedFutureTrip(page);

    await openRooms(page, tripId);

    await page.goto(`/trips/${tripId}/rooms?view=card&new=1`);
    await waitForRoute(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await page.locator('#room-name').fill('Double bed');
    await page.locator('#room-capacity').fill('2');
    await page.locator('#room-count').fill('3');

    await dialog
      .getByRole('button', { name: /save|sauvegarder/iu })
      .click();

    await expect(dialog).toBeHidden();

    await expect(page.getByText('Double bed 1')).toBeVisible();
    await expect(page.getByText('Double bed 2')).toBeVisible();
    await expect(page.getByText('Double bed 3')).toBeVisible();
  });

  test('does not offer a count when editing an existing room', async ({
    page,
  }) => {
    const tripId = await seedFutureTrip(page);
    await seedRoom(page, { tripId, name: 'Attic', capacity: 2 });

    await openRooms(page, tripId);

    await page.getByLabel(/open menu|ouvrir le menu/iu).first().click();
    await page.getByRole('menuitem', { name: /^(edit|modifier)$/iu }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.locator('#room-capacity')).toBeVisible();
    await expect(page.locator('#room-count')).toHaveCount(0);
  });

  test('duplicates a room from its menu', async ({ page }) => {
    const tripId = await seedFutureTrip(page);
    await seedRoom(page, { tripId, name: 'Double bed', capacity: 2 });

    await openRooms(page, tripId);

    await page.getByLabel(/open menu|ouvrir le menu/iu).first().click();
    await page
      .getByRole('menuitem', { name: /^(duplicate|dupliquer)$/iu })
      .click();

    await expect(page.getByText('Double bed 2')).toBeVisible();
    await expect(page.getByText('Double bed', { exact: true })).toBeVisible();
  });
});
