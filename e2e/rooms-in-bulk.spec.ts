/**
 * @fileoverview E2E tests for making many rooms quickly.
 *
 * A gîte with six identical doubles used to be six passes through the room
 * dialog. Duplicate on a room that is already right is the way out of that.
 *
 * @module e2e/rooms-in-bulk
 */

import { test, expect, type Page } from '@playwright/test';

import { fixtureDate } from './support/fixture-dates';
import { roomCards } from './support/page-regions';
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

  test('does not ask how many rooms in the room dialog', async ({ page }) => {
    // The room dialog makes one room. A "how many rooms" field there was
    // mistaken for the bed count.
    const tripId = await seedFutureTrip(page);

    await openRooms(page, tripId);

    await page.goto(`/trips/${tripId}/rooms?view=card&new=1`);
    await waitForRoute(page);

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

    await expect(roomCards(page).getByText('Double bed 2')).toBeVisible();
    await expect(
      roomCards(page).getByText('Double bed', { exact: true }),
    ).toBeVisible();
  });
});
