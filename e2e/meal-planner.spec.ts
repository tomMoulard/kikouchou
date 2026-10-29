/**
 * @fileoverview E2E cover for the meal planner.
 *
 * The unit tests render the page through the real providers on a fake
 * IndexedDB. Three claims are only true in a browser:
 *
 *   - the route is registered and its lazy chunk resolves;
 *   - the `meal-planner` flag hides the page and its navigation item, and the
 *     local override turns both on, which is how a device without a PostHog
 *     project reaches it;
 *   - a meal and a shopping line typed into the page reach the real Dexie
 *     schema (version 14), and come back after a reload.
 *
 * @module e2e/meal-planner
 */

import { expect, test, type Page } from '@playwright/test';

import { fixtureDate } from './support/fixture-dates';
import { waitForRoute } from './support/routes';
import { seedPerson, seedTrip } from './support/seed';

// ============================================================================
// Constants
// ============================================================================

/** Both locales, because the suite runs against whichever the browser asks for. */
const LABELS = {
  meals: /^meals$|^repas$/i,
  plan: /^(plan the|organiser le) (lunch|déjeuner)/i,
  menu: /^menu$/i,
  save: /^save$|^enregistrer$/i,
  shopping: /shopping list|liste de courses/i,
  item: /^item$|^article$/i,
  add: /^add$|^ajouter$/i,
  bought: (name: string) => new RegExp(`${name} (is bought|est acheté)`, 'i'),
} as const;

/** The local override `useFeatureFlag` reads before asking PostHog. */
const FLAG_KEY = 'kikouchou-flag:meal-planner';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Forces the flag for every page this test loads, before any script runs.
 */
async function setFlag(page: Page, value: 'on' | 'off'): Promise<void> {
  await page.addInitScript(
    ([key, flagValue]) => {
      window.localStorage.setItem(key, flagValue);
    },
    [FLAG_KEY, value] as const,
  );
}

/**
 * Seeds a two-day trip with one guest, then opens the meal planner.
 *
 * Every row is written before anything makes the trip current, for the
 * reason `vehicles.spec.ts` gives.
 */
async function openMeals(page: Page, search = ''): Promise<string> {
  const { tripId } = await seedTrip(page, {
    name: 'Meal Trip',
    startDate: fixtureDate(1),
    endDate: fixtureDate(2),
  });
  await seedPerson(page, tripId, 'Bob');

  await page.goto(`/trips/${tripId}/meals${search}`);
  await waitForRoute(page);

  return tripId;
}

/** Reads one store's rows of a trip straight out of IndexedDB. */
async function readRows(
  page: Page,
  store: 'meals' | 'shoppingItems',
  tripId: string,
): Promise<Record<string, unknown>[]> {
  return await page.evaluate(
    async ({ store, tripId }) =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const request = indexedDB.open('kikouchou');
        request.onerror = () => reject(new Error('Failed to open database'));
        request.onsuccess = () => {
          const db = request.result;
          const rows = db.transaction(store, 'readonly').objectStore(store).getAll();
          rows.onsuccess = () => {
            db.close();
            resolve(
              (rows.result as Record<string, unknown>[]).filter((row) => row.tripId === tripId),
            );
          };
          rows.onerror = () => {
            db.close();
            reject(new Error('Failed to read rows'));
          };
        };
      }),
    { store, tripId },
  );
}

// ============================================================================
// Tests
// ============================================================================

test.describe('Meal planner', () => {
  test('stays hidden, and sends a direct link to the calendar, while the flag is off', async ({
    page,
  }) => {
    await setFlag(page, 'off');
    const tripId = await openMeals(page);

    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/calendar`));
    await expect(page.getByRole('link', { name: LABELS.meals })).toHaveCount(0);
  });

  test('plans a lunch and keeps it after a reload', async ({ page, isMobile }) => {
    await setFlag(page, 'on');
    const tripId = await openMeals(page);

    // The sidebar lists every page. A phone's bar holds four, and the planner
    // is the sixth, so there it sits in the closed "More" sheet.
    if (!isMobile) {
      await expect(page.getByRole('link', { name: LABELS.meals }).first()).toBeVisible();
    }

    await page.getByRole('button', { name: LABELS.plan }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Bob/ }).click();
    await dialog.getByLabel(LABELS.menu).fill('Raclette');
    await dialog.getByRole('button', { name: LABELS.save }).click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(async () => (await readRows(page, 'meals', tripId)).map((row) => row.menu))
      .toEqual(['Raclette']);

    await page.reload();
    await waitForRoute(page);
    await expect(page.getByText('Raclette')).toBeVisible();
  });

  test('adds a shopping line and ticks it off', async ({ page }) => {
    await setFlag(page, 'on');
    const tripId = await openMeals(page, '?view=shopping');

    await page.getByLabel(LABELS.item).fill('Baguettes');
    await page.getByRole('button', { name: LABELS.add }).click();
    await expect(page.getByText('Baguettes')).toBeVisible();

    await page.getByRole('checkbox', { name: LABELS.bought('Baguettes') }).click();

    await expect
      .poll(async () => (await readRows(page, 'shoppingItems', tripId)).map((row) => row.checked))
      .toEqual([true]);
  });
});
