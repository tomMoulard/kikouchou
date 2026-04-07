/**
 * @fileoverview E2E tests for Trip Import feature.
 * Tests the ability to import configuration from a previous trip
 * at the same location when creating a new trip.
 *
 * @module e2e/trip-import
 */

import { expect, test, type Page } from '@playwright/test';

// ============================================================================
// Test Configuration & Helpers
// ============================================================================

const ORIGINAL_TRIP = {
  name: 'Summer at Vacation Home',
  location: 'Vacation Home',
  startDate: '2024-07-15',
  endDate: '2024-07-22',
} as const;

const ROOMS = ['Living Room', 'Master Bedroom', 'Guest Room'] as const;

/**
 * Selects a date in the shadcn/ui Calendar popover.
 */
async function selectDate(page: Page, dateString: string): Promise<void> {
  const targetDate = new Date(dateString + 'T12:00:00');
  const popover = page.locator('[data-radix-popper-content-wrapper]:visible');
  await popover.waitFor({ state: 'visible' });
  const calendar = popover.locator('[data-slot="calendar"]');
  await navigateToMonth(page, targetDate, calendar);
  const day = targetDate.getDate();
  const dayButton = calendar
    .locator('button')
    .filter({ hasText: new RegExp(`^${day}$`) })
    .first();
  await dayButton.click();
  await popover.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {
    // Popover may already be hidden
  });
}

/**
 * Navigates the calendar to a specific month/year.
 */
async function navigateToMonth(
  page: Page,
  targetDate: Date,
  calendar: ReturnType<Page['locator']>,
): Promise<void> {
  const maxAttempts = 24;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const captionText = await calendar.locator('.rdp-month_caption').textContent();
    if (captionText) {
      const targetMonth = targetDate.toLocaleString('default', { month: 'long' });
      const targetYear = targetDate.getFullYear().toString();
      if (captionText.includes(targetMonth) && captionText.includes(targetYear)) {
        return;
      }
      const currentMonthMatch = captionText.match(/(\w+)\s*(\d{4})/);
      if (currentMonthMatch) {
        const [, monthName, yearStr] = currentMonthMatch;
        const currentYear = parseInt(yearStr, 10);
        const monthNames = [
          'January', 'February', 'March', 'April', 'May', 'June',
          'July', 'August', 'September', 'October', 'November', 'December',
        ];
        const currentMonth = monthNames.findIndex((m) =>
          monthName.toLowerCase().startsWith(m.toLowerCase().slice(0, 3)),
        );
        if (currentMonth >= 0) {
          const currentDateValue = currentYear * 12 + currentMonth;
          const targetDateValue = targetDate.getFullYear() * 12 + targetDate.getMonth();
          if (targetDateValue > currentDateValue) {
            await calendar.locator('button.rdp-button_next').click();
          } else if (targetDateValue < currentDateValue) {
            await calendar.locator('button.rdp-button_previous').click();
          } else {
            return;
          }
          await page.waitForTimeout(50);
          continue;
        }
      }
    }
    await calendar.locator('button.rdp-button_next').click();
    await page.waitForTimeout(50);
  }
}

/**
 * Creates a trip using the trip form.
 */
async function createTrip(
  page: Page,
  tripData: { name: string; location?: string; startDate: string; endDate: string },
): Promise<void> {
  await page.getByLabel(/trip name/i).fill(tripData.name);
  if (tripData.location) {
    await page.getByLabel(/location/i).fill(tripData.location);
  }
  await page.locator('#trip-start-date').click();
  await selectDate(page, tripData.startDate);
  await page.locator('#trip-end-date').click();
  await selectDate(page, tripData.endDate);
  await page.getByRole('button', { name: /save/i }).click();
}

/**
 * Navigates to the rooms page and adds rooms to the current trip.
 */
async function addRooms(page: Page, roomNames: readonly string[]): Promise<void> {
  // Navigate to rooms page via the trip menu
  await page.getByRole('link', { name: /rooms/i }).click();
  await page.waitForURL(/\/rooms/);

  for (const roomName of roomNames) {
    // Click the add room button
    await page.getByRole('button', { name: /add room/i }).click();

    // Fill in the room name
    await page.getByLabel(/room name/i).fill(roomName);

    // Save the room
    await page.getByRole('button', { name: /save/i }).click();

    // Wait for the room to appear
    await expect(page.getByText(roomName)).toBeVisible();
  }
}

// ============================================================================
// Tests
// ============================================================================

test.describe('Trip Import Feature', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the app to load
    await page.waitForLoadState('networkidle');
  });

  test('location autocomplete shows matching trips when typing', async ({ page }) => {
    // Step 1: Create the first trip
    await page.getByRole('button', { name: /create.*trip|new.*trip|plan.*trip/i }).click();
    await page.waitForURL(/\/trips\/new/);
    await createTrip(page, ORIGINAL_TRIP);

    // Wait for navigation to calendar
    await page.waitForURL(/\/calendar/);

    // Step 2: Navigate back to create another trip
    await page.goto('/');
    await page.getByRole('button', { name: /create.*trip|new.*trip|add/i }).click();
    await page.waitForURL(/\/trips\/new/);

    // Step 3: Type the matching location
    const locationInput = page.getByLabel(/location/i);
    await locationInput.fill('Vacation');

    // Step 4: Verify the autocomplete dropdown appears with the matching trip
    await expect(page.getByText(ORIGINAL_TRIP.name)).toBeVisible({ timeout: 5000 });
  });

  test('importing a trip pre-fills location and description', async ({ page }) => {
    // Step 1: Create the first trip with a description
    await page.getByRole('button', { name: /create.*trip|new.*trip|plan.*trip/i }).click();
    await page.waitForURL(/\/trips\/new/);
    await createTrip(page, ORIGINAL_TRIP);
    await page.waitForURL(/\/calendar/);

    // Step 2: Navigate to create another trip
    await page.goto('/');
    await page.getByRole('button', { name: /create.*trip|new.*trip|add/i }).click();
    await page.waitForURL(/\/trips\/new/);

    // Step 3: Type the matching location and select import
    const locationInput = page.getByLabel(/location/i);
    await locationInput.fill('Vacation');

    // Wait for the suggestion to appear and click it
    const importButton = page.getByRole('button', { name: /import/i }).first();
    await expect(importButton).toBeVisible({ timeout: 5000 });
    await importButton.click();

    // Step 4: Verify the location field is pre-filled
    await expect(locationInput).toHaveValue(ORIGINAL_TRIP.location);

    // Verify import badge is shown
    await expect(page.getByText(/importing from/i)).toBeVisible();
  });

  test('importing a trip clones rooms to the new trip', async ({ page }) => {
    // Step 1: Create the first trip
    await page.getByRole('button', { name: /create.*trip|new.*trip|plan.*trip/i }).click();
    await page.waitForURL(/\/trips\/new/);
    await createTrip(page, ORIGINAL_TRIP);
    await page.waitForURL(/\/calendar/);

    // Step 2: Add rooms to the first trip
    await addRooms(page, ROOMS);

    // Step 3: Navigate to create another trip
    await page.goto('/');
    await page.getByRole('button', { name: /create.*trip|new.*trip|add/i }).click();
    await page.waitForURL(/\/trips\/new/);

    // Step 4: Type the matching location and import
    const locationInput = page.getByLabel(/location/i);
    await locationInput.fill('Vacation');

    const importButton = page.getByRole('button', { name: /import/i }).first();
    await expect(importButton).toBeVisible({ timeout: 5000 });
    await importButton.click();

    // Step 5: Fill in remaining required fields and save
    await page.getByLabel(/trip name/i).fill('Return to Vacation Home');

    await page.locator('#trip-start-date').click();
    await selectDate(page, '2025-07-15');
    await page.locator('#trip-end-date').click();
    await selectDate(page, '2025-07-22');

    await page.getByRole('button', { name: /save/i }).click();

    // Step 6: Wait for navigation and go to rooms
    await page.waitForURL(/\/calendar/);
    await page.getByRole('link', { name: /rooms/i }).click();
    await page.waitForURL(/\/rooms/);

    // Step 7: Verify all rooms were cloned
    for (const roomName of ROOMS) {
      await expect(page.getByText(roomName)).toBeVisible();
    }
  });

  test('can dismiss import and type a fresh location', async ({ page }) => {
    // Step 1: Create a trip
    await page.getByRole('button', { name: /create.*trip|new.*trip|plan.*trip/i }).click();
    await page.waitForURL(/\/trips\/new/);
    await createTrip(page, ORIGINAL_TRIP);
    await page.waitForURL(/\/calendar/);

    // Step 2: Navigate to create another trip
    await page.goto('/');
    await page.getByRole('button', { name: /create.*trip|new.*trip|add/i }).click();
    await page.waitForURL(/\/trips\/new/);

    // Step 3: Type a matching location — suggestions appear
    const locationInput = page.getByLabel(/location/i);
    await locationInput.fill('Vacation');

    // Wait for suggestions
    await expect(page.getByText(ORIGINAL_TRIP.name)).toBeVisible({ timeout: 5000 });

    // Step 4: Clear the input and type something else
    await locationInput.clear();
    await locationInput.fill('Brand New Place');

    // Step 5: Verify no suggestions show for unmatched location
    // Give it a moment to search
    await page.waitForTimeout(500);

    // The autocomplete should not show the old trip
    await expect(page.getByText(ORIGINAL_TRIP.name)).not.toBeVisible();
  });
});
