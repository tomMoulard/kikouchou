/**
 * @fileoverview E2E tests for the cover photo of a trip and the photo of a room.
 *
 * A real Chromium decodes the picked file, draws it on a canvas and re-encodes
 * it, which jsdom cannot do, so this is where the whole pick-prepare-store path
 * runs at least once. The photo must then survive a reload: it is stored on
 * the device, not held by the page.
 *
 * @module e2e/trip-and-room-photos
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

/** An 8x8 red PNG: small, but a real image the browser has to decode. */
const RED_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGM4YWCAFTEMLQkAEHtKAfrZtRkAAAAASUVORK5CYII=',
  'base64',
);

const PHOTO_FILE = { name: 'red-room.png', mimeType: 'image/png', buffer: RED_PNG };

/**
 * Picks the cover photo on the trip settings page until it shows.
 *
 * The page can remount once while the trip is selected, and a pick that is
 * still being prepared at that moment is dropped with the old card. A person
 * picks a file seconds after the page opens; a test does it at once, so it
 * picks again rather than lose the run to that window.
 */
async function pickTripCover(page: Page): Promise<void> {
  await expect(async () => {
    await page.locator('input[type="file"]').setInputFiles(PHOTO_FILE);
    await expect(page.getByRole('img', { name: /photo trip/iu })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
}

async function seedFutureTrip(page: Page): Promise<string> {
  const { tripId } = await seedTrip(page, {
    name: 'Photo Trip',
    startDate: fixtureDate(3),
    endDate: fixtureDate(6),
  });
  return tripId;
}

// ============================================================================
// Tests
// ============================================================================

test.describe('Trip and room photos', () => {
  test.beforeEach(async ({ page }) => {
    await clearIndexedDB(page);
  });

  test('a room keeps the photo picked in its dialog', async ({ page }) => {
    const tripId = await seedFutureTrip(page);
    await seedRoom(page, { tripId, name: 'Red room', capacity: 2 });

    await page.goto(`/trips/${tripId}/rooms?view=card`);
    await waitForRoute(page);

    await page.getByLabel(/open menu|ouvrir le menu/iu).first().click();
    await page.getByRole('menuitem', { name: /^(edit|modifier)$/iu }).click();

    const dialog = page.getByRole('dialog');
    await dialog.locator('input[type="file"]').setInputFiles(PHOTO_FILE);
    // The preview is the prepared image, not the picked file.
    await expect(dialog.getByRole('img', { name: /red room/iu })).toBeVisible();
    await dialog.getByRole('button', { name: /^(save|enregistrer)$/iu }).click();
    await expect(dialog).toBeHidden();

    const photo = roomCards(page).getByRole('img', { name: /red room/iu });
    await expect(photo).toBeVisible();
    await expect(photo).toHaveAttribute('src', /^blob:/u);

    await page.reload();
    await waitForRoute(page);
    await expect(roomCards(page).getByRole('img', { name: /red room/iu })).toBeVisible();
  });

  test('a trip cover is saved from its settings and shown on the trip card', async ({ page }) => {
    const tripId = await seedFutureTrip(page);

    await page.goto(`/trips/${tripId}/edit`);
    await waitForRoute(page);

    await pickTripCover(page);

    await page.goto('/trips');
    await waitForRoute(page);
    await expect(page.getByRole('img', { name: /photo trip/iu })).toBeVisible();
  });

  test('a photo is removed with its button', async ({ page }) => {
    const tripId = await seedFutureTrip(page);

    await page.goto(`/trips/${tripId}/edit`);
    await waitForRoute(page);
    await pickTripCover(page);

    await page.getByRole('button', { name: /remove photo|retirer la photo/iu }).click();

    await expect(page.getByRole('img', { name: /photo trip/iu })).toHaveCount(0);
  });
});
