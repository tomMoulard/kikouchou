/**
 * @fileoverview E2E tests for Trip Lifecycle in Kikouchou PWA.
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
import { fixtureDate } from './support/fixture-dates';
import { addTripGuests, fillTripOrganiser, ORGANISER_NAME } from './support/trip-form';

// ============================================================================
// Test Configuration & Helpers
// ============================================================================

/**
 * Test data for creating trips.
 *
 * Every date is derived from today. These were pinned to July 2024, which was
 * not merely stale — it was unreachable. `navigateToMonth` walks the picker one
 * month at a time from today under a 24-click ceiling, and July 2024 was 26
 * months behind: the walk ran out of clicks, returned without a word, and
 * `selectDate` then clicked the 15th of whatever month was on screen. Every
 * test below that calls `createTrip` was creating a trip with dates it never
 * asked for, and none of them looked, so the suite stayed green while getting
 * one month more wrong every month. See `support/fixture-dates`.
 */
const TEST_TRIP = {
  name: 'Summer Vacation',
  location: 'Beach House, Cornwall',
  startDate: fixtureDate(15),
  endDate: fixtureDate(22),
} as const;

/** A second trip, a month after the first, so the two are distinguishable. */
const SECOND_TRIP = {
  name: 'Winter Ski Trip',
  location: 'Alps Chalet',
  startDate: fixtureDate(20, 3),
  endDate: fixtureDate(27, 3),
} as const;

/** The edit widens `TEST_TRIP` at both ends, so both pickers must move. */
const UPDATED_TRIP = {
  name: 'Summer Vacation - Extended',
  startDate: fixtureDate(14),
  endDate: fixtureDate(25),
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

  // Address the cell by the date it *is*, not by the digits it prints.
  //
  // react-day-picker stamps every gridcell with `data-day="yyyy-MM-dd"` and
  // marks the ones borrowed from the neighbouring months `data-outside`. The
  // old `button` + `/^15$/` + `.first()` matched on text alone, so it could not
  // tell the 25th of the month it wanted from the 25th that leads the grid as a
  // greyed-out day of the previous month — and, worse, it happily clicked a day
  // of the wrong month entirely when `navigateToMonth` had not arrived. Matching
  // the ISO date means a failed walk fails here, loudly, on a cell that is not
  // in the DOM.
  const dayButton = calendar
    .locator(`td[data-day="${dateString}"]:not([data-outside])`)
    .locator('button');

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
 * @throws Error if the target month is not reached within `maxAttempts` clicks
 */
async function navigateToMonth(
  page: Page,
  targetDate: Date,
  calendar: ReturnType<Page['locator']>,
): Promise<void> {
  // Get the currently displayed month from the calendar caption
  // The caption shows the month name and year
  const maxAttempts = 24; // Safety limit (2 years of navigation)

  // Remembered for the failure message: the point of throwing is to say which
  // month the walk actually reached, which is the one fact that identifies a
  // fixture the picker can no longer get to.
  let captionText: string | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Check if we're on the right month by looking at the caption
    captionText = await calendar.locator('.rdp-month_caption').textContent();

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
        // Both groups are mandatory in the pattern that just matched, so this
        // cannot fire. It throws rather than defaulting because the quiet
        // alternative is worse than the loud one: an empty `yearStr` makes
        // `currentYear` NaN, every comparison below false, and the helper
        // returns as though the calendar were already on the target month —
        // after which the test clicks a day in the wrong month and fails
        // somewhere with nothing to do with the cause.
        if (monthName === undefined || yearStr === undefined) {
          throw new Error(
            `Calendar caption matched but yielded no month/year: ${captionText}`,
          );
        }
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

  // Running out of clicks used to be a silent `return`, and that is the whole
  // bug this file was carrying: the caller then clicked a day of the month the
  // walk happened to stop on and asserted nothing about the result. Say so.
  const wanted = `${targetDate.toLocaleString('en', { month: 'long' })} ${targetDate.getFullYear()}`;
  throw new Error(
    `navigateToMonth: gave up after ${maxAttempts} clicks — wanted ${wanted}, ` +
      `calendar is showing ${captionText?.trim() ?? '(no caption)'}. ` +
      'The picker opens on the current month, so a fixture more than two years ' +
      'away cannot be reached: derive it from today with support/fixture-dates.',
  );
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
  tripData: {
    name: string;
    location?: string;
    startDate: string;
    endDate: string;
    organiser?: string;
    guests?: readonly string[];
  },
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

  // Both opt-in: the guest list is optional in full, so the tests that are not
  // about it leave it alone and create a trip with nobody on it.
  if (tripData.organiser) {
    await fillTripOrganiser(page, tripData.organiser);
  }
  if (tripData.guests) {
    await addTripGuests(page, tripData.guests);
  }

  // Submit the form
  await page.getByRole('button', { name: /save/i }).click();
}

/**
 * Asserts which date one of the trip form's pickers is holding.
 *
 * This is the assertion whose absence hid the broken date picker. Every test
 * here fed `createTrip` a start and an end date and then checked only that the
 * URL had changed — so a picker that selected a day of the wrong month, or of
 * the wrong year, produced a trip that passed. Read the date back.
 *
 * Read through the calendar rather than the trigger button: the button prints
 * the date with date-fns `PPP` in the active locale, which would make this
 * assertion a statement about i18n. react-day-picker marks the chosen gridcell
 * `data-selected="true"` and stamps every cell with `data-day="yyyy-MM-dd"`.
 *
 * The walk to the month is not optional. `getInitialMonth` is
 * `month || defaultMonth || today` and `TripForm` passes neither, so the picker
 * opens on the *current* month however far away its own selection is — the
 * selected cell is simply not in the DOM until you navigate to it. Asserting
 * that this particular cell is the selected one is the stronger statement
 * anyway: `mode="single"` has exactly one, so if this is it, that is the date.
 *
 * @param page - Playwright page object
 * @param triggerId - `#trip-start-date` or `#trip-end-date`
 * @param isoDate - The date the form is expected to hold (YYYY-MM-DD)
 */
async function expectSelectedDate(
  page: Page,
  triggerId: string,
  isoDate: string,
): Promise<void> {
  await page.locator(triggerId).click();

  const popover = page.locator('[data-radix-popper-content-wrapper]:visible');
  await popover.waitFor({ state: 'visible' });
  const calendar = popover.locator('[data-slot="calendar"]');

  await navigateToMonth(page, new Date(isoDate + 'T12:00:00'), calendar);

  await expect(
    calendar.locator(`td[data-day="${isoDate}"]:not([data-outside])`),
  ).toHaveAttribute('data-selected', 'true');

  // Leave the form as it was found — the next picker has to open over nothing.
  await page.keyboard.press('Escape');
  await popover.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {
    // Already closed, which is the same outcome.
  });
}

/**
 * The trip id out of a `/trips/:id/calendar` URL, or a failure that says why.
 *
 * @param page - Playwright page object, expected to be on a trip calendar
 * @returns The trip id
 * @throws Error if the page is not on a trip calendar URL
 */
function tripIdFromCalendarUrl(page: Page): string {
  const tripId = page.url().match(/\/trips\/([^/]+)\/calendar/)?.[1];
  if (!tripId) {
    throw new Error(`Expected a trip calendar URL, got ${page.url()}`);
  }
  return tripId;
}

/**
 * Reads one trip's stored dates straight out of IndexedDB.
 *
 * The other half of the missing assertion, and the cheap half: it needs no
 * navigation, so it can be dropped into a test that is already near its 60 s
 * budget. It also asserts the value the app *stored* rather than a rendering of
 * it — `expectSelectedDate` covers the rendering, on a page a test is visiting
 * anyway.
 *
 * @param page - Playwright page object, on a page where the app has booted
 * @param tripId - The trip to read
 * @returns Its `startDate` and `endDate`, both `YYYY-MM-DD`
 */
async function readTripDates(
  page: Page,
  tripId: string,
): Promise<{ startDate: string; endDate: string }> {
  return await page.evaluate(
    async (id) =>
      new Promise<{ startDate: string; endDate: string }>((resolve, reject) => {
        const request = indexedDB.open('kikouchou');
        request.onerror = () => reject(new Error('Failed to open database'));
        request.onsuccess = () => {
          const db = request.result;
          const read = db.transaction('trips', 'readonly').objectStore('trips').get(id);
          read.onsuccess = () => {
            db.close();
            const trip = read.result as { startDate: string; endDate: string } | undefined;
            if (!trip) {
              reject(new Error(`No trip ${id} in IndexedDB`));
              return;
            }
            resolve({ startDate: trip.startDate, endDate: trip.endDate });
          };
          read.onerror = () => {
            db.close();
            reject(new Error(`Failed to read trip ${id}`));
          };
        };
      }),
    tripId,
  );
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

    const tripId = tripIdFromCalendarUrl(page);

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

    // And verify the trip carries the dates the form was given.
    //
    // A URL and a name were the whole of this test's evidence, and neither says
    // anything about the two fields the form spends most of its effort on. The
    // date picker was selecting days of the wrong month for months on end —
    // measured at two months wrong today, three next month — without a single
    // test noticing.
    expect(await readTripDates(page, tripId)).toEqual({
      startDate: TEST_TRIP.startDate,
      endDate: TEST_TRIP.endDate,
    });
  });

  // ============================================================================
  // Test Case 1b: The create form's guest list reaches the Guests page
  // ============================================================================

  test('creates the guests typed on the create form', async ({ page }) => {
    await page.goto('/trips/new');
    await expectTripFormPage(page, /new trip/i);

    await createTrip(page, {
      ...TEST_TRIP,
      organiser: ORGANISER_NAME,
      guests: ['Marie', 'Camille'],
    });
    await expectCalendarPage(page, TEST_TRIP.name);

    await page.getByRole('link', { name: /guests/i }).first().click();
    await page.waitForURL(/\/persons/);

    // The organiser among them: the first row is the user's own, and filling it
    // is how they put themselves on the trip they are creating.
    for (const guestName of [ORGANISER_NAME, 'Marie', 'Camille']) {
      await expect(page.getByText(guestName).first()).toBeVisible();
    }
  });

  test('creates a trip the organiser is not on', async ({ page }) => {
    await page.goto('/trips/new');
    await expectTripFormPage(page, /new trip/i);

    // Somebody who hosts rather than travels — an Airbnb owner arranging a trip
    // for their guests — leaves their own row blank.
    await createTrip(page, { ...TEST_TRIP, guests: ['Marie', 'Camille'] });
    await expectCalendarPage(page, TEST_TRIP.name);

    await page.getByRole('link', { name: /guests/i }).first().click();
    await page.waitForURL(/\/persons/);

    // Counted, not merely matched by name: the point of this test is that a
    // third guest — the organiser — was *not* created.
    const guests = page.getByRole('list', { name: /guests/i }).getByRole('listitem');
    await expect(guests).toHaveCount(2);
    await expect(page.getByText('Marie').first()).toBeVisible();
    await expect(page.getByText('Camille').first()).toBeVisible();
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

    // Verify the form is pre-filled with existing data — dates included, which
    // also fixes the starting point this test's own edit is measured against.
    await expect(page.getByLabel(/trip name/i)).toHaveValue(TEST_TRIP.name);
    await expectSelectedDate(page, '#trip-start-date', TEST_TRIP.startDate);
    await expectSelectedDate(page, '#trip-end-date', TEST_TRIP.endDate);

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

    // The name was the only edited field this test looked at. Both dates moved
    // too — the start back a day, the end forward three — so read them back.
    expect(await readTripDates(page, tripId)).toEqual({
      startDate: UPDATED_TRIP.startDate,
      endDate: UPDATED_TRIP.endDate,
    });
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
