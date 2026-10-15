/**
 * @fileoverview E2E tests for the sample trip seeded on a first open.
 *
 * The seed is skipped under automation (`navigator.webdriver`), so every other
 * spec opens an empty app. This one turns it back on with the force key before
 * the first page load, which is the only moment the seed can happen: the boot
 * that creates the settings row is the device's first open.
 *
 * @module e2e/sample-trip
 */

import { expect, test, type Page } from '@playwright/test';

import { guestCards, roomCards } from './support/page-regions';
import { waitForRoute } from './support/routes';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Turns the seed on and picks the language before anything loads.
 *
 * @param page - Playwright page object
 * @param language - The language the app is read in
 */
async function firstOpenIn(page: Page, language: 'en' | 'fr'): Promise<void> {
  await page.addInitScript((lng) => {
    localStorage.setItem('kikouchou-sample-trip', 'on');
    localStorage.setItem('i18nextLng', lng);
  }, language);
}

/**
 * Reads the sample trip id the seed recorded in the settings row.
 *
 * @param page - Playwright page object, on the app
 * @returns The sample trip id
 */
async function sampleTripId(page: Page): Promise<string> {
  const id = await page.evaluate(
    () =>
      new Promise<string | undefined>((resolve, reject) => {
        const open = indexedDB.open('kikouchou');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const read = open.result
            .transaction('settings', 'readonly')
            .objectStore('settings')
            .get('settings');
          read.onerror = () => reject(read.error);
          read.onsuccess = () => {
            resolve((read.result as { sampleTripId?: string } | undefined)?.sampleTripId);
            open.result.close();
          };
        };
      }),
  );
  expect(id).toBeTruthy();
  return id!;
}

// ============================================================================
// Tests
// ============================================================================

test.describe('Sample trip', () => {
  test('a first open still lands on the create form, with the sample in the list', async ({
    page,
  }) => {
    await firstOpenIn(page, 'en');

    await page.goto('/');
    await expect(page).toHaveURL(/\/trips\/new$/);

    await page.goto('/trips');
    await waitForRoute(page);
    await expect(page.getByText('Sample trip: summer in Provence')).toBeVisible();
  });

  test('the sample shows rooms, guests, transports and money', async ({ page }) => {
    await firstOpenIn(page, 'en');
    await page.goto('/');
    await expect(page).toHaveURL(/\/trips\/new$/);
    const tripId = await sampleTripId(page);

    await page.goto(`/trips/${tripId}/rooms`);
    await waitForRoute(page);
    await expect(roomCards(page).getByText('Main bedroom')).toBeVisible();

    await page.goto(`/trips/${tripId}/persons`);
    await waitForRoute(page);
    await expect(guestCards(page).getByText('Sam & Alex')).toBeVisible();

    await page.goto(`/trips/${tripId}/transports`);
    await waitForRoute(page);
    await expect(page.getByText('TGV 6105').first()).toBeVisible();

    await page.goto(`/trips/${tripId}/money`);
    await waitForRoute(page);
    await expect(page.getByText('House rental').first()).toBeVisible();
  });

  test('the sample follows the language of the first open', async ({ page }) => {
    await firstOpenIn(page, 'fr');

    await page.goto('/trips');
    await waitForRoute(page);

    await expect(page.getByText('Voyage exemple : l’été en Provence')).toBeVisible();
  });

  test('the sample is seeded once, and stays deleted', async ({ page }) => {
    await firstOpenIn(page, 'en');
    await page.goto('/trips');
    await waitForRoute(page);
    await expect(page.getByText('Sample trip: summer in Provence')).toBeVisible();

    // Delete it the way the database sees it, then open the app again.
    const tripId = await sampleTripId(page);
    await page.evaluate(
      (id) =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('kikouchou');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const tx = open.result.transaction('trips', 'readwrite');
            tx.objectStore('trips').delete(id);
            tx.oncomplete = () => {
              open.result.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
      tripId,
    );

    await page.reload();
    await waitForRoute(page);

    await expect(page.getByText('Sample trip: summer in Provence')).toHaveCount(0);
  });
});
