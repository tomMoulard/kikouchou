/**
 * @fileoverview E2E tests for Trip Lifecycle in Kikoushou PWA.
 * Tests the complete CRUD operations for trips including:
 * - Creating trips from empty state
 * - Editing existing trips
 * - Deleting trips with confirmation
 * - Navigating between trips
 * - Data persistence across page reloads
 *
 * @module e2e/trip-lifecycle
 */

import { expect, test, type Page } from '@playwright/test';

// ============================================================================
// Test Configuration & Helpers
// ============================================================================

/**
 * Test data for creating trips.
 */
const TEST_TRIP = {
  name: 'Summer Vacation 2024',
  location: 'Beach House, Cornwall',
  startDate: '2024-07-15',
  endDate: '2024-07-22',
} as const;

const SECOND_TRIP = {
  name: 'Winter Ski Trip',
  location: 'Alps Chalet',
  startDate: '2024-12-20',
  endDate: '2024-12-27',
} as const;

const UPDATED_TRIP = {
  name: 'Summer Vacation 2024 - Extended',
  startDate: '2024-07-14',
  endDate: '2024-07-25',
} as const;

/**
 * Gets a trip card locator by trip name.
 * The trip cards on the list page are buttons with aria-label containing the trip name.
 *
 * @param page - Playwright page object
 * @param tripName - The name of the trip to find
 * @returns Locator for the trip card button
 */
function getTripCard(page: Page, tripName: string) {
  return page.getByRole('button', { name: new RegExp(tripName) });
}

/**
 * Selects a date in the shadcn/ui Calendar popover.
 * The calendar uses react-day-picker with custom day buttons that have data-day attributes.
 * Scoped to the visible popover to handle cases where multiple calendars exist in DOM.
 *
 * @param page - Playwright page object
 * @param dateString - ISO date string (YYYY-MM-DD)
 */
async function selectDate(page: Page, dateString: string): Promise<void> {
  const targetDate = new Date(dateString + 'T12:00:00'); // Avoid timezone issues

  // Wait for popover content to be visible (this contains the calendar)
  const popover = page.locator('[data-radix-popper-content-wrapper]:visible');
  await popover.waitFor({ state: 'visible' });

  // Get the calendar within the visible popover
  const calendar = popover.locator('[data-slot="calendar"]');

  // First, navigate to the correct month if needed
  await navigateToMonth(page, targetDate, calendar);

  // The day buttons have text content with the day number
  // We need to find the button with the correct day that's not "outside" the current month
  const day = targetDate.getDate();

  // Find the day button within the calendar
  // Look for buttons that contain exactly the day number
  const dayButton = calendar
    .locator('button')
    .filter({ hasText: new RegExp(`^${day}$`) })
    .first();

  await dayButton.click();

  // Wait for popover to close after selection
  await popover.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {
    // Popover may already be hidden, that's okay
  });
}

/**
 * Navigates the calendar to a specific month/year if needed.
 * Uses the calendar's navigation buttons to reach the target month.
 *
 * @param page - Playwright page object
 * @param targetDate - Target date to navigate to
 * @param calendar - Locator for the calendar element
 */
async function navigateToMonth(
  page: Page,
  targetDate: Date,
  calendar: ReturnType<Page['locator']>,
): Promise<void> {
  // Get the currently displayed month from the calendar caption
  // The caption shows the month name and year
  const maxAttempts = 24; // Safety limit (2 years of navigation)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Check if we're on the right month by looking at the caption
    const captionText = await calendar.locator('.rdp-month_caption').textContent();

    if (captionText) {
      const targetMonth = targetDate.toLocaleString('default', { month: 'long' });
      const targetYear = targetDate.getFullYear().toString();

      // Check if caption contains both the target month and year
      if (captionText.includes(targetMonth) && captionText.includes(targetYear)) {
        return; // We're on the correct month
      }

      // Determine direction: check if we need to go forward or backward
      // Parse the current month/year from caption
      const currentMonthMatch = captionText.match(/(\w+)\s*(\d{4})/);

      if (currentMonthMatch) {
        const [, monthName, yearStr] = currentMonthMatch;
        const currentYear = parseInt(yearStr, 10);

        // Convert month name to index (0-11)
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
            // Go forward - find the next button within this calendar
            await calendar.locator('button.rdp-button_next').click();
          } else if (targetDateValue < currentDateValue) {
            // Go backward
            await calendar.locator('button.rdp-button_previous').click();
          } else {
            // Same month, we're done
            return;
          }
          await page.waitForTimeout(50); // Brief wait for animation
          continue;
        }
      }
    }

    // Fallback: just try clicking next
    await calendar.locator('button.rdp-button_next').click();
    await page.waitForTimeout(50);
  }
}

/**
 * Creates a trip using the trip form.
 * Handles date picker interactions and form submission.
 *
 * @param page - Playwright page object
 * @param tripData - Trip data to fill in the form
 */
async function createTrip(
  page: Page,
  tripData: { name: string; location?: string; startDate: string; endDate: string },
): Promise<void> {
  // Fill in the trip name
  await page.getByLabel(/trip name/i).fill(tripData.name);

  // Fill in location if provided
  if (tripData.location) {
    await page.locator('#trip-location').fill(tripData.location);
  }

  // Open start date picker and select date
  // The start date button has id="trip-start-date"
  await page.locator('#trip-start-date').click();
  await selectDate(page, tripData.startDate);

  // Open end date picker and select date
  // The end date button has id="trip-end-date"
  await page.locator('#trip-end-date').click();
  await selectDate(page, tripData.endDate);

  // Submit the form
  await page.getByRole('button', { name: /save/i }).click();
}

/**
 * Asserts the calendar route is on screen for `tripName`, and returns its id.
 *
 * Fourteen assertions in this file were `expect(page).toHaveURL(...)` and
 * nothing else, most of them the last statement in their test. The calendar
 * route could render a blank `<main>` and every one of them would still pass —
 * and asserting a URL and calling it a screen is exactly how the share wizard
 * shipped broken for months: `/identity` matched while the parent route painted
 * the welcome screen over it.
 *
 * The trip name is part of it on purpose. Two of these tests click one card out
 * of two and only ever checked that *a* calendar URL resulted, so opening the
 * wrong trip was indistinguishable from opening the right one.
 *
 * @param page - Playwright page object
 * @param tripName - The trip whose calendar must be showing
 * @returns The trip id from the URL
 */
async function expectCalendarPage(page: Page, tripName: string): Promise<string> {
  await expect(page).toHaveURL(/\/trips\/[^/]+\/calendar/);

  // Scoped to the page's own header: the trip name is also painted in the top
  // banner and the sidebar, because it is the current trip.
  const header = page.locator('main header').first();
  await expect(header.getByRole('heading', { level: 1 })).toHaveText(/calendar/i);
  await expect(header.getByText(tripName, { exact: true })).toBeVisible();

  const tripId = /\/trips\/([^/]+)\/calendar/.exec(page.url())?.[1];
  expect(tripId).toBeTruthy();
  return tripId ?? '';
}

/**
 * Asserts the trip form is rendered and empty-headed, not merely routed to.
 */
async function expectTripFormPage(page: Page, heading: RegExp): Promise<void> {
  await expect(
    page.locator('main header').first().getByRole('heading', { level: 1 }),
  ).toHaveText(heading);
  await expect(page.getByLabel(/trip name/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /save/i })).toBeVisible();
}

// ============================================================================
// Test Setup
// ============================================================================

test.describe('Trip Lifecycle', () => {
  // Clear data before each test to ensure clean state
  test.beforeEach(async ({ page, context }) => {
    // Clear storage state including IndexedDB for a fresh start
    await context.clearCookies();

    // The trip location field searches OpenStreetMap for places; keep that off
    // the wire so these tests stay deterministic and don't depend on Nominatim.
    await page.route('**/nominatim.openstreetmap.org/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    // Navigate to the app
    await page.goto('/');

    // Use the settings page to clear all data if it exists
    // This uses the app's built-in "Clear All Data" functionality
    await page.goto('/settings');

    // Look for the clear data button and click it if present
    const clearDataButton = page.getByRole('button', { name: /clear.*data/i });
    if (await clearDataButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await clearDataButton.click();

      // Confirm the dialog if it appears. ConfirmDialog is an alert dialog.
      const confirmButton = page
        .getByRole('alertdialog')
        .getByRole('button', { name: /clear|confirm/i });
      if (await confirmButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await confirmButton.click();
        // Wait for the operation to complete
        await page.waitForTimeout(500);
      }
    }
  });

  // ============================================================================
  // Test Case 1: Creates a new trip from empty state
  // ============================================================================

  test('creates a new trip from empty state', async ({ page }) => {
    // Navigate to the trips page
    await page.goto('/trips');

    // Verify empty state is shown
    // The EmptyState component shows "No trips" as a heading when the list is empty
    await expect(
      page.getByRole('heading', { name: /no trips/i }),
    ).toBeVisible();
    await expect(page.getByText(/plan your next getaway/i)).toBeVisible();

    // Click the "New trip" button in the empty state.
    //
    // `.first()` because the empty state offers this action twice — once in the
    // page header and once in the `EmptyState` body — and both carry the
    // `trips.new` label, so an unqualified match is a strict-mode violation.
    // They are the same action, so either will do.
    await page.getByRole('button', { name: /new trip/i }).first().click();

    // Verify we're on the create trip page — and that the form is on it.
    await expect(page).toHaveURL('/trips/new');
    await expectTripFormPage(page, /new trip/i);

    // Fill in the trip form
    await createTrip(page, TEST_TRIP);

    // Wait for navigation after successful creation
    // The app navigates to /trips/:id/calendar after creation
    await expectCalendarPage(page, TEST_TRIP.name);

    // Verify success toast appears
    await expect(page.getByText(/trip created successfully/i)).toBeVisible();

    // Navigate back to trips list to verify the trip appears
    await page.goto('/trips');

    // Wait for the trip list to load
    await page.waitForLoadState('load');

    // Verify the trip is now in the list
    // The trip cards are buttons with aria-label containing the trip name and location
    await expect(getTripCard(page, TEST_TRIP.name)).toBeVisible();

    // Verify the empty state is no longer shown
    await expect(
      page.getByRole('heading', { name: /no trips/i }),
    ).not.toBeVisible();
  });

  // ============================================================================
  // Test Case 2: Edits an existing trip
  // ============================================================================

  test('edits an existing trip', async ({ page }) => {
    // First, create a trip to edit
    await page.goto('/trips/new');
    await createTrip(page, TEST_TRIP);

    // Wait for navigation to calendar
    const tripId = await expectCalendarPage(page, TEST_TRIP.name);

    // Navigate to the edit page
    await page.goto(`/trips/${tripId}/edit`);

    // Verify we're on the edit page with the correct title
    await expect(page.getByRole('heading', { name: /edit trip/i })).toBeVisible();

    // Verify the form is pre-filled with existing data
    await expect(page.getByLabel(/trip name/i)).toHaveValue(TEST_TRIP.name);

    // Clear and update the trip name
    await page.getByLabel(/trip name/i).clear();
    await page.getByLabel(/trip name/i).fill(UPDATED_TRIP.name);

    // Update the start date
    await page.locator('#trip-start-date').click();
    await selectDate(page, UPDATED_TRIP.startDate);

    // Update the end date
    await page.locator('#trip-end-date').click();
    await selectDate(page, UPDATED_TRIP.endDate);

    // Save the changes
    await page.getByRole('button', { name: /save/i }).click();

    // `TripEditPage.handleSubmit` navigates to the trip's calendar, so this is
    // deterministic and is asserted rather than raced.
    //
    // What was here was a `Promise.race` between a URL check and a sidebar text
    // check, wrapped in `try { … } catch { /* If save seems stuck */ }` — so a
    // save that never happened at all reached the next line unremarked, and the
    // 1 s `waitForTimeout` before it was there to make that likely enough to
    // pass. Both are gone: if the save does not land, this fails here.
    expect(await expectCalendarPage(page, UPDATED_TRIP.name)).toBe(tripId);

    // Navigate to trips list to verify changes persisted
    // (also handles case where save navigation didn't work)
    await page.goto('/trips');

    // Verify the updated name is shown in the trip list
    await expect(getTripCard(page, UPDATED_TRIP.name)).toBeVisible();

    // Verify the trip was actually updated (not duplicated)
    // The list should show the new name, not the old one as a separate card
    // We check that there's only one trip card with either name
    const tripCards = page.getByRole('list', { name: /my trips/i }).getByRole('listitem');
    await expect(tripCards).toHaveCount(1);
  });

  // ============================================================================
  // Test Case 3: Deletes a trip with confirmation
  // ============================================================================

  test('deletes a trip with confirmation', async ({ page }) => {
    // First, create a trip to delete
    await page.goto('/trips/new');
    await createTrip(page, TEST_TRIP);

    // Wait for navigation to calendar
    const tripId = await expectCalendarPage(page, TEST_TRIP.name);

    // Navigate to the edit page (where delete button is)
    await page.goto(`/trips/${tripId}/edit`);

    // Click the delete button in the header (not the one that might appear elsewhere)
    await page.getByRole('button', { name: /delete/i }).first().click();

    // Verify the confirmation dialog appears. A destructive confirmation is an
    // alert dialog: `getByRole('dialog')` no longer matches it.
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(
      page.getByText(/this will permanently delete the trip/i),
    ).toBeVisible();

    // Wait for the dialog Delete button to be enabled (not in loading state)
    const deleteConfirmButton = dialog.getByRole('button', { name: /delete/i });
    await expect(deleteConfirmButton).toBeEnabled();

    // Confirm the deletion with force option in case of overlay issues
    await deleteConfirmButton.click({ force: true });

    // `TripEditPage.handleDelete` replaces the history entry with `/trips`, so
    // the app navigates itself and the dialog goes with the page.
    //
    // What was here instead: a 1 s sleep, a `Promise.race` in a `try`/`catch`
    // that swallowed both outcomes, then `if (url.includes('/edit')) { … await
    // page.goto('/trips') }` — a manual rescue that made "the delete never
    // navigated" and "the delete worked" produce the same green result. The
    // navigation is part of the feature, so it is asserted.
    await expect(page).toHaveURL('/trips', { timeout: 10000 });
    await expect(dialog).toHaveCount(0);

    // Verify the trip is no longer in the list (most important assertion)
    await expect(getTripCard(page, TEST_TRIP.name)).not.toBeVisible();

    // Verify empty state is shown again (since we deleted the only trip)
    await expect(
      page.getByRole('heading', { name: /no trips/i }),
    ).toBeVisible();
  });

  // ============================================================================
  // Test Case 4: Navigates between trips
  // ============================================================================

  test('navigates between trips', async ({ page }) => {
    // Create the first trip
    await page.goto('/trips/new');
    await createTrip(page, TEST_TRIP);
    const firstTripId = await expectCalendarPage(page, TEST_TRIP.name);

    // Navigate back to trips list
    await page.goto('/trips');

    // Create the second trip
    await page.getByRole('button', { name: /new trip/i }).first().click();
    await createTrip(page, SECOND_TRIP);
    const secondTripId = await expectCalendarPage(page, SECOND_TRIP.name);
    expect(secondTripId).not.toBe(firstTripId);

    // Navigate back to trips list
    await page.goto('/trips');

    // Wait for trips to load
    await page.waitForLoadState('load');

    // Verify both trips are visible
    await expect(getTripCard(page, TEST_TRIP.name)).toBeVisible();
    await expect(getTripCard(page, SECOND_TRIP.name)).toBeVisible();

    // Click on the first trip — and land on *that* trip's calendar. Both of
    // these used to assert only `/trips/<something>/calendar`, so opening the
    // wrong trip was indistinguishable from opening the right one.
    await getTripCard(page, TEST_TRIP.name).click();
    expect(await expectCalendarPage(page, TEST_TRIP.name)).toBe(firstTripId);

    // Navigate back to trips list
    await page.goto('/trips');

    // Click on the second trip
    await getTripCard(page, SECOND_TRIP.name).click();
    expect(await expectCalendarPage(page, SECOND_TRIP.name)).toBe(secondTripId);

    // Verify correct trip is loaded by going to edit and checking the name
    await page.goto(`/trips/${secondTripId}/edit`);
    await expect(page.getByLabel(/trip name/i)).toHaveValue(SECOND_TRIP.name);
  });

  // ============================================================================
  // Test Case 5: Persists trip data across page reload
  // ============================================================================

  test('persists trip data across page reload', async ({ page }) => {
    // Create a trip
    await page.goto('/trips/new');
    await createTrip(page, TEST_TRIP);

    // Wait for navigation to calendar
    const createdTripId = await expectCalendarPage(page, TEST_TRIP.name);

    // Navigate to trips list to verify trip exists
    await page.goto('/trips');
    await expect(getTripCard(page, TEST_TRIP.name)).toBeVisible();

    // Reload the page completely
    await page.reload();

    // Wait for the page to load (trips should be fetched from IndexedDB)
    await page.waitForLoadState('load');

    // Verify the trip data persisted after reload
    // The trip card includes the location in its aria-label, so checking the card is sufficient
    await expect(getTripCard(page, TEST_TRIP.name)).toBeVisible();

    // Also verify by navigating to edit and checking the form values
    // Click the trip card to navigate to calendar first
    await getTripCard(page, TEST_TRIP.name).click();
    expect(await expectCalendarPage(page, TEST_TRIP.name)).toBe(createdTripId);

    await page.goto(`/trips/${createdTripId}/edit`);

    // Verify form is populated with correct data
    await expect(page.getByLabel(/trip name/i)).toHaveValue(TEST_TRIP.name);
    await expect(page.locator('#trip-location')).toHaveValue(TEST_TRIP.location);

    // Reload again from the edit page
    await page.reload();

    // Verify data is still there after another reload
    await expect(page.getByLabel(/trip name/i)).toHaveValue(TEST_TRIP.name);
    await expect(page.locator('#trip-location')).toHaveValue(TEST_TRIP.location);
  });

  // ============================================================================
  // Additional Edge Case Tests
  // ============================================================================

  test('cancels trip creation and returns to list', async ({ page }) => {
    // Navigate to trips page
    await page.goto('/trips');

    // Click new trip button from empty state
    await page.getByRole('button', { name: /new trip/i }).first().click();

    // Fill in some data
    await page.getByLabel(/trip name/i).fill('Cancelled Trip');

    // Click cancel
    await page.getByRole('button', { name: /cancel/i }).click();

    // Verify we returned to trips list — and that the list is on screen, not
    // merely in the address bar.
    await expect(page).toHaveURL('/trips');
    await expect(
      page.locator('main header').first().getByRole('heading', { level: 1 }),
    ).toHaveText(/my trips/i);

    // Verify the cancelled trip was not created
    await expect(getTripCard(page, 'Cancelled Trip')).not.toBeVisible();
    // Verify empty state is shown (no trips heading)
    await expect(
      page.getByRole('heading', { name: /no trips/i }),
    ).toBeVisible();
  });

  test('validates required fields on trip creation', async ({ page }) => {
    // Navigate to create trip page
    await page.goto('/trips/new');

    // Try to submit empty form
    await page.getByRole('button', { name: /save/i }).click();

    // Verify validation error appears for name (should show "Required")
    await expect(page.getByRole('alert').first()).toBeVisible();

    // Fill name but skip dates
    await page.getByLabel(/trip name/i).fill('Test Trip');
    await page.getByRole('button', { name: /save/i }).click();

    // Verify date validation errors appear (at least one alert for dates)
    await expect(page.getByRole('alert').first()).toBeVisible();

    // Still on the create page, still holding what was typed. The URL alone
    // was the last statement here, and a form that had unmounted itself into a
    // blank page would have satisfied it.
    await expect(page).toHaveURL('/trips/new');
    await expectTripFormPage(page, /new trip/i);
    await expect(page.getByLabel(/trip name/i)).toHaveValue('Test Trip');
  });

  test('cancels deletion when clicking cancel in dialog', async ({ page }) => {
    // Create a trip
    await page.goto('/trips/new');
    await createTrip(page, TEST_TRIP);
    const tripId = await expectCalendarPage(page, TEST_TRIP.name);

    await page.goto(`/trips/${tripId}/edit`);

    // Click delete to open confirmation dialog
    await page.getByRole('button', { name: /delete/i }).click();

    // Verify dialog is open
    await expect(
      page.getByText(/this will permanently delete the trip/i),
    ).toBeVisible();

    // Click cancel
    await page.getByRole('button', { name: /cancel/i }).click();

    // Verify dialog closed and we're still on edit page
    await expect(
      page.getByText(/this will permanently delete the trip/i),
    ).not.toBeVisible();
    await expect(page).toHaveURL(`/trips/${tripId}/edit`);
    // The edit form is still there, still on this trip: cancelling a deletion
    // must leave the page exactly as it was, and a URL cannot say that.
    await expectTripFormPage(page, /edit trip/i);
    await expect(page.getByLabel(/trip name/i)).toHaveValue(TEST_TRIP.name);

    // Verify trip still exists by going to trips list
    await page.goto('/trips');
    await expect(getTripCard(page, TEST_TRIP.name)).toBeVisible();
  });
});
