/**
 * @fileoverview E2E cover for the two analytics pages.
 *
 * The routes had no end-to-end cover at all, which is how the two pages came to
 * count the same rows two different ways: `/trips/:tripId/analytics` read
 * through the trip-scoped contexts and `/analytics` read Dexie. These tests
 * seed one set of rows and assert both pages report the same numbers, including
 * straight after a trip switch — the moment the contexts lag the URL.
 *
 * The assertions go through `data-testid` on the numbers rather than the card
 * labels: the app defaults to French, so matching label text would pass or fail
 * by locale.
 *
 * @module e2e/analytics
 */

import { expect, test, type Page } from '@playwright/test';

import { waitForRoute } from './support/routes';
import {
  seedPerson,
  seedRide,
  seedTransport,
  seedTrip,
  seedVehicle,
} from './support/seed';
import { clearIndexedDB } from './support/storage';

// ============================================================================
// Helpers
// ============================================================================

/** Dates are derived from today so the fixture never falls into the past. */
function isoDate(daysFromToday: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
}

/** An ISO timestamp at noon, `daysFromToday` from now. */
function isoDatetime(daysFromToday: number): string {
  return `${isoDate(daysFromToday)}T12:00:00.000Z`;
}

/**
 * Writes one guest standing for several real people.
 *
 * Headcount is what separates the two numbers this spec is about: a guest row
 * can stand for a couple, so "people" and "guests" are not the same count. This
 * used to be a private copy of `seedPerson` because the shared helper could not
 * express the field; it can, so this is a name rather than a fork.
 *
 * Same ordering rule as the shared helpers: seed before the trip is current.
 *
 * @param page - Playwright page object
 * @param tripId - The trip the guest belongs to
 * @param name - Guest name
 * @param headcount - How many real people the row stands for
 * @returns The new guest's id
 */
async function seedGuestWithHeadcount(
  page: Page,
  tripId: string,
  name: string,
  headcount: number,
): Promise<string> {
  return await seedPerson(page, tripId, name, '#3b82f6', { headcount });
}

/**
 * Opens a route and waits for its lazy chunk and its live query to settle.
 *
 * @param page - Playwright page object
 * @param path - Path to open
 */
async function openRoute(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('load');
  await waitForRoute(page);
}

// ============================================================================
// Tests
// ============================================================================

test.describe('Analytics', () => {
  test('both analytics pages report the same numbers for one trip', async ({
    page,
  }) => {
    await clearIndexedDB(page);

    // Seed everything BEFORE the trip is made current — see `support/seed`.
    const { tripId } = await seedTrip(page, {
      name: 'Analytics Trip',
      startDate: isoDate(30),
      endDate: isoDate(40),
    });
    const alice = await seedGuestWithHeadcount(page, tripId, 'Alice', 2);
    await seedGuestWithHeadcount(page, tripId, 'Bob', 3);
    await seedTransport(page, {
      tripId,
      personId: alice,
      type: 'arrival',
      datetime: isoDatetime(30),
    });
    await seedTransport(page, {
      tripId,
      personId: alice,
      type: 'departure',
      datetime: isoDatetime(40),
    });

    // The all-trips page: one trip, so its totals are that trip's numbers.
    await openRoute(page, '/analytics');
    await expect(page.getByTestId('stat-trips')).toHaveText('1');
    // Five people across two guest rows — the distinction the labels now make.
    await expect(page.getByTestId('stat-total-people')).toHaveText('5');
    await expect(page.getByTestId('stat-total-transports')).toHaveText('2');
    await expect(page.getByTestId('stat-total-rooms')).toHaveText('0');
    await expect(page.getByTestId('stat-total-assignments')).toHaveText('0');

    // The trip's own page must agree, field for field.
    await openRoute(page, `/trips/${tripId}/analytics`);
    await expect(page.getByTestId('stat-people')).toHaveText('5');
    await expect(page.getByTestId('stat-transports')).toHaveText('2');
    await expect(page.getByTestId('stat-rooms')).toHaveText('0');
    await expect(page.getByTestId('stat-assignments')).toHaveText('0');
    // One future arrival, seeded with needsPickup and no driver.
    await expect(page.getByTestId('stat-pickups')).toHaveText('1');
  });

  test('counts a shared car once, beside the legs it serves', async ({ page }) => {
    await clearIndexedDB(page);

    // One car meets two trains. Both pages must show one ride, one car and two
    // legs: a reader who added the ride total to the leg total would see three
    // journeys where the trip has one car making one trip to the station.
    const { tripId } = await seedTrip(page, {
      name: 'Rides Analytics Trip',
      startDate: isoDate(30),
      endDate: isoDate(40),
    });
    const alice = await seedPerson(page, tripId, 'Alice');
    const bruno = await seedPerson(page, tripId, 'Bruno');
    const guillaume = await seedPerson(page, tripId, 'Guillaume');
    const vehicleId = await seedVehicle(page, {
      tripId,
      name: 'Espace de location',
      seatCount: 7,
    });
    const rideId = await seedRide(page, {
      tripId,
      meetDatetime: isoDatetime(30),
      location: 'Gare de Vannes',
      driverId: guillaume,
      vehicleId,
    });
    await seedTransport(page, {
      tripId,
      personId: alice,
      type: 'arrival',
      datetime: isoDatetime(30),
      rideId,
    });
    await seedTransport(page, {
      tripId,
      personId: bruno,
      type: 'arrival',
      datetime: isoDatetime(30),
      rideId,
    });

    await openRoute(page, `/trips/${tripId}/analytics`);
    await expect(page.getByTestId('stat-rides')).toHaveText('1');
    await expect(page.getByTestId('stat-vehicles')).toHaveText('1');
    await expect(page.getByTestId('stat-transports')).toHaveText('2');
    // Both legs sit in a ride somebody is driving, so nothing needs a driver.
    await expect(page.getByTestId('stat-pickups')).toHaveText('0');

    // The all-trips page reads the same rows through the same function.
    await openRoute(page, '/analytics');
    await expect(page.getByTestId('stat-total-rides')).toHaveText('1');
    await expect(page.getByTestId('stat-total-vehicles')).toHaveText('1');
    await expect(page.getByTestId('stat-total-transports')).toHaveText('2');
  });

  test('a trip holding only a car is not called empty', async ({ page }) => {
    await clearIndexedDB(page);

    // The hire car is booked long before anybody's train times are known.
    const { tripId } = await seedTrip(page, {
      name: 'Car Only Trip',
      startDate: isoDate(30),
      endDate: isoDate(40),
    });
    await seedVehicle(page, { tripId, name: 'Espace de location', seatCount: 7 });

    await openRoute(page, `/trips/${tripId}/analytics`);

    await expect(page.getByTestId('stat-vehicles')).toHaveText('1');
    await expect(
      page.getByRole('button', { name: /new guest|nouveau participant/i }),
    ).toHaveCount(0);
  });

  test('switching trips reports the trip in the URL, not the previous one', async ({
    page,
  }) => {
    await clearIndexedDB(page);

    const first = await seedTrip(page, {
      name: 'First Trip',
      startDate: isoDate(30),
      endDate: isoDate(35),
    });
    await seedGuestWithHeadcount(page, first.tripId, 'Alice', 2);

    const second = await seedTrip(page, {
      name: 'Second Trip',
      startDate: isoDate(60),
      endDate: isoDate(65),
    });
    await seedGuestWithHeadcount(page, second.tripId, 'Bob', 7);

    await openRoute(page, `/trips/${first.tripId}/analytics`);
    await expect(page.getByTestId('stat-people')).toHaveText('2');

    // A client-side navigation through the scope switcher, so the contexts are
    // still holding the first trip's rows when the next page first renders.
    await page.getByRole('radio', { checked: false }).first().click();
    // Assert where we landed: without this the click could hit some other
    // radio and the rest of the test would still "pass" on the same page.
    await expect(page).toHaveURL(/\/analytics$/);
    await waitForRoute(page);
    await expect(page.getByTestId('stat-total-people')).toHaveText('9');

    await openRoute(page, `/trips/${second.tripId}/analytics`);
    await expect(page.getByTestId('stat-people')).toHaveText('7');
  });

  test('a trip with nothing in it shows an empty state, not a wall of zeros', async ({
    page,
  }) => {
    await clearIndexedDB(page);

    const { tripId } = await seedTrip(page, {
      name: 'Empty Trip',
      startDate: isoDate(30),
      endDate: isoDate(35),
    });

    await openRoute(page, `/trips/${tripId}/analytics`);

    // Retry on the empty state's action first — an instant read of the absent
    // stat card would pass while the lazy route was still mounting.
    await expect(
      page.getByRole('button', { name: /new guest|nouveau participant/i }),
    ).toBeVisible();
    await expect(page.getByTestId('stat-people')).toHaveCount(0);
  });
});
