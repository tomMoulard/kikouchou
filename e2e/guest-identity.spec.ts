/**
 * @fileoverview E2E cover for the "which guest am I?" card on `/settings`.
 *
 * The card's whole value is a contract with code it never calls: the share
 * wizard writes `kikouchou_guest_<shareId>`, and the agenda reads it back to
 * decide whose sign-ups to offer. A unit test can only prove the card called
 * the helper it was given; these assert the key the rest of the app actually
 * looks for, through a real browser and a real reload.
 *
 * Locators go through `data-testid` rather than label text: the app defaults to
 * French, so matching the accessible name would pass or fail by locale. Guest
 * names are fixture data and are safe to match.
 *
 * @module e2e/guest-identity
 */

import { expect, test, type Page } from '@playwright/test';

import { waitForRoute } from './support/routes';
import { seedPerson, seedTrip } from './support/seed';
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

/**
 * Reads the guest identity the app has stored for a share link.
 *
 * @param page - Playwright page object
 * @param shareId - The trip's share ID
 * @returns The parsed identity, or null when nothing is stored
 */
async function storedIdentity(
  page: Page,
  shareId: string,
): Promise<{ personId: string; tripId: string } | null> {
  return await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as { personId: string; tripId: string });
  }, `kikouchou_guest_${shareId}`);
}

/**
 * Opens the identity picker and clicks one of its options.
 *
 * @param page - Playwright page object
 * @param option - Locator-ready name of the option, or `null` for "nobody"
 */
async function pickIdentity(page: Page, option: string | null): Promise<void> {
  await page.getByTestId('guest-identity-select').click();
  await (option === null
    ? page.getByTestId('guest-identity-none')
    : page.getByRole('option', { name: option })
  ).click();
}

// ============================================================================
// Tests
// ============================================================================

test.describe('Guest identity', () => {
  test('picks a guest, keeps it across a reload, and gives it back up', async ({
    page,
  }) => {
    await clearIndexedDB(page);

    // Seed everything BEFORE the trip is made current — see `support/seed`.
    const { tripId, shareId } = await seedTrip(page, {
      name: 'Identity Trip',
      startDate: isoDate(30),
      endDate: isoDate(40),
    });
    await seedPerson(page, tripId, 'Alice');
    const bob = await seedPerson(page, tripId, 'Bob');

    // Selecting the trip is what puts it in front of the settings page.
    await openRoute(page, `/trips/${tripId}/calendar`);
    await openRoute(page, '/settings');

    // Nothing stored yet: the card offers the guests without claiming to be one.
    expect(await storedIdentity(page, shareId)).toBeNull();

    await pickIdentity(page, 'Bob');

    await expect
      .poll(() => storedIdentity(page, shareId))
      .toEqual({ personId: bob, tripId });

    // The point of storing it: a reload still knows who this browser is.
    await openRoute(page, '/settings');
    await expect(page.getByTestId('guest-identity-select')).toHaveText(/Bob/);

    await pickIdentity(page, null);

    // Absent, not blanked — an identity with an empty personId still parses,
    // so every other reader would go on believing this browser is somebody.
    await expect.poll(() => storedIdentity(page, shareId)).toBeNull();
  });

  test('offers the guest list instead of an empty menu when the trip has none', async ({
    page,
  }) => {
    await clearIndexedDB(page);

    const { tripId } = await seedTrip(page, {
      name: 'Guestless Trip',
      startDate: isoDate(30),
      endDate: isoDate(40),
    });

    await openRoute(page, `/trips/${tripId}/calendar`);
    await openRoute(page, '/settings');

    await expect(page.getByTestId('guest-identity-select')).toHaveCount(0);

    await page.getByTestId('guest-identity-open-guests').click();
    await waitForRoute(page);

    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/persons$`));
  });
});
