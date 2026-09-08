/**
 * @fileoverview E2E tests for typing a house full of rooms at once, and for
 * copying one.
 *
 * A gîte with six identical doubles used to be six passes through the room
 * dialog. These tests cover the two ways out of that: the room list on the trip
 * creation form, where the whole house is named in one save, and Duplicate on a
 * room that is already right.
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

/**
 * Picks a start and an end date on the create form, from whatever month the
 * pickers open on — never a literal month.
 */
async function fillTripDates(page: Page): Promise<void> {
  await page.locator('#trip-start-date').click();
  await page.getByRole('gridcell').filter({ hasText: /^15$/u }).first().click();
  await page.locator('#trip-end-date').click();
  await page.getByRole('gridcell').filter({ hasText: /^22$/u }).first().click();
}

/**
 * Adds a room row on the create form and fills its name.
 *
 * Sequential by necessity: the input exists only once the click that adds its
 * row has rendered. Matched as an exact textbox rather than by label, because
 * each row's remove button is labelled "Remove room N" too.
 */
async function addTripRoom(
  page: Page,
  index: number,
  name: string,
): Promise<void> {
  await page.getByRole('button', { name: /^add room$/iu }).click();
  await page
    .getByRole('textbox', { name: `Room ${index}`, exact: true })
    .fill(name);
}

// ============================================================================
// Tests
// ============================================================================

test.describe('Rooms in bulk', () => {
  test.beforeEach(async ({ page }) => {
    await clearIndexedDB(page);
  });

  test('types the whole house on the trip creation form', async ({ page }) => {
    await page.goto('/trips/new');
    await waitForRoute(page);

    await page.getByLabel(/trip name/iu).fill('Gîte');
    await fillTripDates(page);

    await addTripRoom(page, 1, 'Double bed 1');
    await addTripRoom(page, 2, 'Double bed 2');
    await addTripRoom(page, 3, 'Attic');

    // The second room sleeps two; the beds stepper says so per row.
    await page
      .getByRole('button', { name: 'Add a bed to room 2', exact: true })
      .click();

    await page.getByRole('button', { name: /^save$/iu }).click();
    await page.waitForURL(/\/trips\/[\w-]+\/calendar/u, { timeout: 20_000 });

    await page.goto(page.url().replace('/calendar', '/rooms?view=card'));
    await waitForRoute(page);

    await expect(page.getByText('Double bed 1')).toBeVisible();
    await expect(page.getByText('Double bed 2')).toBeVisible();
    await expect(page.getByText('Attic')).toBeVisible();
  });

  test('drops a room row that was added and left empty', async ({ page }) => {
    await page.goto('/trips/new');
    await waitForRoute(page);

    await page.getByLabel(/trip name/iu).fill('Gîte');
    await fillTripDates(page);

    await addTripRoom(page, 1, 'Attic');
    // An abandoned "Add room" click, not a nameless room.
    await page.getByRole('button', { name: /^add room$/iu }).click();

    await page.getByRole('button', { name: /^save$/iu }).click();
    await page.waitForURL(/\/trips\/[\w-]+\/calendar/u, { timeout: 20_000 });

    await page.goto(page.url().replace('/calendar', '/rooms?view=card'));
    await waitForRoute(page);

    await expect(page.getByText('Attic')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /open menu|ouvrir le menu/iu }),
    ).toHaveCount(1);
  });

  test('does not ask how many rooms in the room dialog', async ({ page }) => {
    // The room dialog makes one room. How many of them there are is a question
    // the trip creation form asks, and it was mistaken here for the bed count.
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

    await expect(page.getByText('Double bed 2')).toBeVisible();
    await expect(page.getByText('Double bed', { exact: true })).toBeVisible();
  });
});
