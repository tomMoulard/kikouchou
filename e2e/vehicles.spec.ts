/**
 * @fileoverview E2E cover for the trip's car list.
 *
 * A unit test renders `VehicleListPage` against a mocked `RideContext`, so it
 * can say the page draws a car it was handed and nothing more. Three claims
 * this feature makes are only true in a browser:
 *
 *   - the route is actually registered and its lazy chunk resolves, which no
 *     unit test touches — `vehicleRoutes` is spread into `src/router.tsx` and a
 *     page whose import path is wrong renders the suspense fallback for ever;
 *   - a car typed into the form reaches IndexedDB, through the real
 *     `RideProvider`, the real repository and the real Dexie schema. The
 *     `vehicles` table only exists from DB v10, and a version mismatch is
 *     invisible to a mocked context;
 *   - a car seeded straight into IndexedDB comes back out through the live
 *     query, which is the same round trip a synced car makes.
 *
 * @module e2e/vehicles
 */

import { expect, test, type Page } from '@playwright/test';

import { fixtureDate } from './support/fixture-dates';
import { waitForRoute } from './support/routes';
import { seedPerson, seedTrip, seedVehicle } from './support/seed';

// ============================================================================
// Constants
// ============================================================================

/**
 * Both locales, because the suite runs against whichever the browser asks for.
 */
const LABELS = {
  addCar: /add car|ajouter une voiture/i,
  cars: /^cars$|^voitures$/i,
  carName: /^name|^nom/i,
  save: /^save$|^enregistrer$/i,
  delete: /^delete$|^supprimer$/i,
  seatsUnknown: /seats not set|places non renseignées/i,
  deleteNamed: (name: string) => new RegExp(`(delete|supprimer) ${name}`, 'i'),
} as const;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Seeds a trip with one guest and, optionally, one car, then opens the car list.
 *
 * Every row is written **before** anything makes the trip current: `YjsTripSync`
 * projects its document over Dexie, and a raw write made afterwards races that
 * projection.
 *
 * @param page - Playwright page object
 * @param options - Whether to seed a car alongside the trip
 * @returns The seeded trip's id
 */
async function openVehicles(
  page: Page,
  options: { readonly withVehicle?: boolean } = {},
): Promise<string> {
  const { tripId } = await seedTrip(page, {
    name: 'Vehicle Trip',
    startDate: fixtureDate(1),
    endDate: fixtureDate(10),
  });

  const personId = await seedPerson(page, tripId, 'Bob');

  if (options.withVehicle === true) {
    await seedVehicle(page, {
      tripId,
      name: 'Espace de location',
      seatCount: 7,
      childSeats: ['booster', 'booster'],
      ownerId: personId,
    });
  }

  await page.goto(`/trips/${tripId}/transports/vehicles`);
  await waitForRoute(page);

  return tripId;
}

/**
 * Reads the trip's cars straight out of IndexedDB.
 *
 * Through `expect.poll`, never `page.waitForFunction`: a pending Promise is
 * truthy, so an async predicate there returns on its first poll having asserted
 * nothing at all.
 *
 * @param page - Playwright page object
 * @param tripId - The trip whose cars to read
 * @returns The stored rows, name and seat count only
 */
async function readStoredVehicles(
  page: Page,
  tripId: string,
): Promise<{ name: string; seatCount: number | undefined }[]> {
  return await page.evaluate(async (tripId: string) => {
    return new Promise<{ name: string; seatCount: number | undefined }[]>(
      (resolve, reject) => {
        const request = indexedDB.open('kikouchou');
        request.onerror = () => reject(new Error('Failed to open database'));
        request.onsuccess = () => {
          const db = request.result;
          const rows = db
            .transaction('vehicles', 'readonly')
            .objectStore('vehicles')
            .getAll();

          rows.onsuccess = () => {
            const stored = (rows.result as { tripId: string; name: string; seatCount?: number }[])
              .filter((row) => row.tripId === tripId)
              .map((row) => ({ name: row.name, seatCount: row.seatCount }));
            db.close();
            resolve(stored);
          };
          rows.onerror = () => {
            db.close();
            reject(new Error('Failed to read vehicles'));
          };
        };
      },
    );
  }, tripId);
}

// ============================================================================
// Tests
// ============================================================================

test.describe('the trip’s cars', () => {
  test('the route mounts and lists a seeded car', async ({ page }) => {
    await openVehicles(page, { withVehicle: true });

    await expect(page.getByText('Espace de location')).toBeVisible();
    // The owner comes off the same row as the name, so it missing means the
    // card is rendering a different car than the one stored.
    await expect(page.getByText('Bob')).toBeVisible();
  });

  test('an unmeasured car says so rather than showing no seats', async ({ page }) => {
    const { tripId } = await seedTrip(page, {
      name: 'Unmeasured Trip',
      startDate: fixtureDate(1),
      endDate: fixtureDate(10),
    });
    await seedVehicle(page, { tripId, name: 'La Clio' });

    await page.goto(`/trips/${tripId}/transports/vehicles`);
    await waitForRoute(page);

    await expect(page.getByText('La Clio')).toBeVisible();
    await expect(page.getByText(LABELS.seatsUnknown)).toBeVisible();
  });

  test('a car created through the form appears and is stored', async ({ page }) => {
    const tripId = await openVehicles(page);

    await page.getByRole('button', { name: LABELS.addCar }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(LABELS.carName).fill('La Clio');
    await dialog.getByRole('button', { name: LABELS.save }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText('La Clio')).toBeVisible();

    // In IndexedDB, not merely on screen — and with no seat count, because the
    // field was left empty and "not measured" is not zero.
    await expect
      .poll(async () => await readStoredVehicles(page, tripId))
      .toEqual([{ name: 'La Clio', seatCount: undefined }]);
  });

  test('a car survives a reload, so the list is not local component state', async ({
    page,
  }) => {
    await openVehicles(page, { withVehicle: true });

    await page.reload();
    await waitForRoute(page);

    await expect(page.getByText('Espace de location')).toBeVisible();
  });

  test('deleting a car takes it off the list', async ({ page }) => {
    const tripId = await openVehicles(page, { withVehicle: true });

    await page
      .getByRole('button', { name: LABELS.deleteNamed('Espace de location') })
      .click();

    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: LABELS.delete }).click();

    // Scoped to the list: the confirmation names the car too, so a bare text
    // match resolves to two elements while the dialog animates away.
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Espace de location' }),
    ).toHaveCount(0);
    await expect.poll(async () => await readStoredVehicles(page, tripId)).toEqual([]);
  });

  test('is reached from the transport list, and is not in the navigation', async ({
    page,
  }) => {
    const { tripId } = await seedTrip(page, {
      name: 'Cars Route Trip',
      startDate: fixtureDate(1),
      endDate: fixtureDate(10),
    });
    await seedVehicle(page, { tripId, name: 'La Clio' });

    await page.goto(`/trips/${tripId}/transports`);
    await waitForRoute(page);

    // Not in the sidebar or the mobile bar. Asserted against the navigation
    // landmarks rather than the whole page, because the transport list itself
    // carries the button we are about to press and a page-wide query would
    // match that and pass while the nav entry was still there.
    for (const nav of await page.getByRole('navigation').all()) {
      await expect(nav.getByRole('link', { name: LABELS.cars })).toHaveCount(0);
    }

    await page.getByRole('button', { name: LABELS.cars }).first().click();
    await waitForRoute(page);

    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/transports/vehicles$`));
    await expect(page.getByText('La Clio')).toBeVisible();
  });
});
