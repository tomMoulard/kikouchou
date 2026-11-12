/**
 * @fileoverview E2E cover for several guests on one train.
 *
 * Each guest keeps a leg of their own, and the legs are one train because the
 * later ones carry the first one's id (`Transport.sharedLegId`). Only a browser
 * holds real rows, runs the live queries and paints the card, so the claims
 * "one train is one card" and "a guest can join a train from the form" are
 * checked here as written.
 *
 * @module e2e/transport-shared-leg
 */

import { expect, test, type Page } from '@playwright/test';

import { stubExternalMapServices } from './support/external-services';
import { fixtureDate, fixtureDatetime } from './support/fixture-dates';
import { waitForRoute } from './support/routes';
import { seedPerson, seedTransport, seedTrip } from './support/seed';

test.use({ timezoneId: 'UTC' });

const LABELS = {
  transportList: /^transports?$/i,
  newTransport: /^new transport$|^nouveau transport$/i,
  sharedLeg: /same train or flight as|même train ou vol que/i,
  save: /^save$|^enregistrer$/i,
  actions: /^actions/i,
  edit: /^edit$|^modifier$/i,
} as const;

const STATION = 'Gare de Lyon';

/**
 * Seeds a trip with three guests and Alice's arrival on the TGV.
 *
 * Every row is written before the trip is opened, for the reason
 * `transport-rides-list.spec.ts` gives: a raw write made after the trip's
 * document mounts races the projection.
 */
async function seedTrain(page: Page): Promise<{
  readonly tripId: string;
  readonly aliceLegId: string;
}> {
  await stubExternalMapServices(page);
  const { tripId } = await seedTrip(page, {
    name: 'Train Trip',
    startDate: fixtureDate(1),
    endDate: fixtureDate(10),
  });
  const alice = await seedPerson(page, tripId, 'Alice Aubert', '#3b82f6');
  await seedPerson(page, tripId, 'Bruno Blanc', '#ef4444');
  await seedPerson(page, tripId, 'Chloe Caron', '#22c55e');
  const aliceLegId = await seedTransport(page, {
    tripId,
    personId: alice,
    type: 'arrival',
    datetime: fixtureDatetime(5, '14:30:00.000Z'),
    mode: 'train',
    location: STATION,
  });
  return { tripId, aliceLegId };
}

async function openTransportList(page: Page, tripId: string): Promise<void> {
  await page.goto(`/trips/${tripId}/transports`);
  await waitForRoute(page);
}

/** The legs of a trip, read straight from IndexedDB. */
async function storedLegs(
  page: Page,
  tripId: string,
): Promise<{ id: string; personId: string; sharedLegId?: string; location: string }[]> {
  return page.evaluate(
    async (id) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('kikouchou');
        request.onerror = () => reject(new Error('Failed to open database'));
        request.onsuccess = () => {
          const db = request.result;
          const read = db
            .transaction('transports', 'readonly')
            .objectStore('transports')
            .index('tripId')
            .getAll(id);
          read.onsuccess = () => {
            db.close();
            resolve(read.result);
          };
          read.onerror = () => reject(new Error('Failed to read transports'));
        };
      }),
    tripId,
  );
}

function listCards(page: Page) {
  return page.getByRole('list', { name: LABELS.transportList }).getByRole('article');
}

test.describe('several guests on one train', () => {
  test('a guest joins a train from the form, and the train stays one card', async ({
    page,
  }) => {
    const { tripId, aliceLegId } = await seedTrain(page);
    await openTransportList(page, tripId);
    await expect(listCards(page)).toHaveCount(1);

    await page.getByRole('button', { name: LABELS.newTransport }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#transport-person').click();
    await page.getByRole('option', { name: 'Bruno Blanc' }).click();
    await dialog.getByRole('combobox', { name: LABELS.sharedLeg }).click();
    await page.getByRole('option', { name: new RegExp(STATION) }).click();
    await dialog.getByRole('button', { name: LABELS.save }).click();

    await expect
      .poll(async () => (await storedLegs(page, tripId)).length)
      .toBe(2);
    const bruno = (await storedLegs(page, tripId)).find((leg) => leg.id !== aliceLegId);
    expect(bruno?.sharedLegId).toBe(aliceLegId);
    expect(bruno?.location).toBe(STATION);

    await expect(listCards(page)).toHaveCount(1);
    const card = listCards(page).first();
    await expect(card.getByText('Alice Aubert')).toBeVisible();
    await expect(card.getByText('Bruno Blanc')).toBeVisible();
  });

  test('ticking a guest in "Travelling with" puts them on the train', async ({ page }) => {
    const { tripId } = await seedTrain(page);
    await openTransportList(page, tripId);

    await listCards(page).first().getByRole('button', { name: LABELS.actions }).click();
    await page.getByRole('menuitem', { name: LABELS.edit }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox', { name: 'Chloe Caron' }).click();
    await dialog.getByRole('button', { name: LABELS.save }).click();

    await expect
      .poll(async () => (await storedLegs(page, tripId)).length)
      .toBe(2);
    await expect(listCards(page)).toHaveCount(1);
    await expect(listCards(page).first().getByText('Chloe Caron')).toBeVisible();
  });
});
