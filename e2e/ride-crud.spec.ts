/**
 * @fileoverview E2E cover for arranging a car journey through the UI.
 *
 * `RideForm` and `RideDialog` were built with unit tests and then imported by
 * nothing, so for a while the app could resolve, render, group and warn about
 * rides that a user had no way to create in the first place — every one of them
 * had to be seeded into IndexedDB or inferred from a "volunteer to drive" tap.
 * A unit test cannot catch that: it renders the component it is testing.
 *
 * Three claims here are only true in a browser:
 *
 *   - the transport list actually mounts the ride dialog, and its button opens
 *     it in create mode;
 *   - what the form submits reaches Dexie through the real `RideProvider`, the
 *     real repository and the real v10 schema, and comes back out through the
 *     live query as a card;
 *   - the card's own menu reopens *that* ride rather than one of its legs, and
 *     an edit saved from it survives a reload.
 *
 * @module e2e/ride-crud
 */

import { expect, test, type Page } from '@playwright/test';

import { stubExternalMapServices } from './support/external-services';
import { fixtureDate } from './support/fixture-dates';
import { waitForRoute } from './support/routes';
import { seedPerson, seedRide, seedTransport, seedTrip } from './support/seed';

// ============================================================================
// Constants
// ============================================================================

/** Both locales, because the suite runs against whichever the browser asks for. */
const LABELS = {
  newRide: /^new ride$|^nouveau trajet$/i,
  newTransport: /^new transport$|^nouveau transport$/i,
  ride: /^ride$|^trajet$/i,
  guest: /participant|guest/i,
  confirmLocation: /^confirm$|^confirmer$/i,
  editRide: /^edit ride$|^modifier le trajet$/i,
  cancelRide: /^cancel ride$|^annuler le trajet$/i,
  meetingPoint: /meeting point|point de rendez-vous/i,
  meetDatetime: /meeting date and time|date et heure du rendez-vous/i,
  save: /^save$|^enregistrer$/i,
  confirmDelete: /^delete$|^supprimer$/i,
  actions: /^actions/i,
  dragToRide: /drag onto a ride|glisser vers un trajet/i,
} as const;

/** A meeting time inside the fixture month, as the datetime-local input wants it. */
const MEET_LOCAL = `${fixtureDate(4)}T15:00`;

/**
 * The one place the stubbed geocoder knows about.
 *
 * `LocationPicker` never reports a freely typed string: `onChange` fires only
 * when a search result is confirmed, so a test that types a meeting point and
 * saves submits an empty location and fails on "Required". Driving the real
 * search-and-confirm path is also the honest test — it is what a user does.
 */
const PLACE = {
  name: 'Gare de Vannes',
  lat: '47.6559',
  lon: '-2.7599',
} as const;

/** A second place, so an edit can change the meeting point to something else. */
const OTHER_PLACE = {
  name: 'Aeroport de Nantes',
  lat: '47.1532',
  lon: '-1.6107',
} as const;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Seeds a trip with one guest and opens its transport list.
 *
 * The guest is written **before** the trip becomes current: `YjsTripSync`
 * projects its document over Dexie, and a raw write afterwards races it.
 *
 * @param page - Playwright page object
 * @returns The seeded trip's id
 */
async function openTransports(page: Page): Promise<string> {
  // Before anything navigates: the meeting-point field debounces into a live
  // Nominatim search whose suggestion popover renders over the dialog's own
  // Save button and eats the click on it. Stubbed to an empty result rather
  // than dismissed afterwards, so the test never depends on the network being
  // reachable — or on what a real geocoder happens to return for "Gare de
  // Vannes" today.
  await stubExternalMapServices(page);

  // …then answer the meeting-point search with two known places, so the confirm
  // step below has something to click. `stubExternalMapServices` returns an
  // empty list, which would leave the picker with no result to select and no
  // way to report a location at all.
  await page.route('**/nominatim.openstreetmap.org/**', (route) => {
    const query = decodeURIComponent(new URL(route.request().url()).search),
      place = query.includes('Aeroport') ? OTHER_PLACE : PLACE;

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          place_id: 1,
          display_name: place.name,
          lat: place.lat,
          lon: place.lon,
          type: 'station',
          class: 'railway',
        },
      ]),
    });
  });

  const { tripId } = await seedTrip(page, {
    name: 'Ride CRUD Trip',
    startDate: fixtureDate(1),
    endDate: fixtureDate(10),
  });
  await seedPerson(page, tripId, 'Alice');

  await page.goto(`/trips/${tripId}/transports`);
  await waitForRoute(page);

  return tripId;
}

/**
 * Fills the open ride dialog's meeting point by searching and confirming.
 *
 * Both steps are necessary: typing only drives `LocationPicker`'s internal
 * state and a debounced search, and the location reaches the form only when a
 * result is confirmed on the map preview.
 *
 * @param page - Playwright page object
 * @param name - The place to type, which the stub above will return
 */
async function pickMeetingPoint(page: Page, name: string): Promise<void> {
  const field = page.getByLabel(LABELS.meetingPoint);

  // Typed rather than `fill`ed. `fill` works on an empty field but not on one
  // that already holds a place: the new text lands in the input and no
  // dropdown ever opens, so there is nothing to confirm and the location never
  // reaches the form. Why was not chased down — typing is what a person does,
  // and it works in both cases.
  await field.click();
  await field.press('ControlOrMeta+a');
  await field.pressSequentially(name, { delay: 20 });

  await page.getByRole('option', { name: new RegExp(name, 'i') }).first().click();
  await page.getByRole('button', { name: LABELS.confirmLocation }).click();
  await expect(page.getByRole('button', { name: LABELS.confirmLocation })).toHaveCount(0);
}

/**
 * Every ride stored for a trip, straight out of IndexedDB.
 *
 * Read through `expect.poll` rather than `waitForFunction`: a pending Promise
 * is truthy, so an async predicate there returns on its first poll having
 * asserted nothing at all.
 *
 * @param page - Playwright page object
 * @param tripId - The trip whose rides to read
 * @returns The stored rides, as `{ location, meetDatetime }` pairs
 */
async function storedRides(
  page: Page,
  tripId: string,
): Promise<{ location: string; meetDatetime: string }[]> {
  return page.evaluate((id: string) => {
    return new Promise<{ location: string; meetDatetime: string }[]>(
      (resolve, reject) => {
        const request = indexedDB.open('kikouchou');
        request.onerror = () => reject(new Error('Failed to open database'));
        request.onsuccess = () => {
          const database = request.result,
            rows = database
              .transaction('rides', 'readonly')
              .objectStore('rides')
              .getAll();

          rows.onsuccess = () => {
            const stored = (
              rows.result as {
                tripId: string;
                location: string;
                meetDatetime: string;
              }[]
            )
              .filter((row) => row.tripId === id)
              .map((row) => ({
                location: row.location,
                meetDatetime: row.meetDatetime,
              }));
            database.close();
            resolve(stored);
          };
          rows.onerror = () => {
            database.close();
            reject(new Error('Failed to read rides'));
          };
        };
      },
    );
  }, tripId);
}

// ============================================================================
// Tests
// ============================================================================

test.describe('arranging a car journey', () => {
  test('a pickup created from the transport list is stored and drawn', async ({
    page,
  }) => {
    const tripId = await openTransports(page);

    await page.getByRole('button', { name: LABELS.newRide }).first().click();

    await page.getByLabel(LABELS.meetDatetime).fill(MEET_LOCAL);
    await pickMeetingPoint(page, PLACE.name);
    await page.getByRole('button', { name: LABELS.save }).click();

    // Stored, not merely drawn. The card could come from component state; the
    // row is what the rest of the trip syncs and what a reload reads back.
    await expect
      .poll(async () => (await storedRides(page, tripId)).map((r) => r.location))
      .toEqual([PLACE.name]);

    await expect(page.getByText(PLACE.name).first()).toBeVisible();
  });

  test('the card menu reopens that ride, and the edit sticks across a reload', async ({
    page,
  }) => {
    const tripId = await openTransports(page);

    await page.getByRole('button', { name: LABELS.newRide }).first().click();
    await page.getByLabel(LABELS.meetDatetime).fill(MEET_LOCAL);
    await pickMeetingPoint(page, PLACE.name);
    await page.getByRole('button', { name: LABELS.save }).click();

    await expect
      .poll(async () => (await storedRides(page, tripId)).length)
      .toBe(1);

    // The card's own menu, not a passenger row's: this ride has no legs yet, so
    // anything that opened a leg here would find nothing to open.
    await page.getByRole('button', { name: LABELS.actions }).first().click();
    await page.getByRole('menuitem', { name: LABELS.editRide }).click();

    await pickMeetingPoint(page, OTHER_PLACE.name);
    await page.getByRole('button', { name: LABELS.save }).click();

    await expect
      .poll(async () => (await storedRides(page, tripId)).map((r) => r.location))
      .toEqual([OTHER_PLACE.name]);

    // One ride, edited — not a second one created by an edit that fell through
    // to the create path because the dialog never received an id.
    await page.reload();
    await waitForRoute(page);
    await expect(page.getByText(OTHER_PLACE.name).first()).toBeVisible();
    expect(await storedRides(page, tripId)).toHaveLength(1);
  });

  test('cancelling a ride removes it', async ({ page }) => {
    const tripId = await openTransports(page);

    await page.getByRole('button', { name: LABELS.newRide }).first().click();
    await page.getByLabel(LABELS.meetDatetime).fill(MEET_LOCAL);
    await pickMeetingPoint(page, PLACE.name);
    await page.getByRole('button', { name: LABELS.save }).click();

    await expect.poll(async () => (await storedRides(page, tripId)).length).toBe(1);

    await page.getByRole('button', { name: LABELS.actions }).first().click();
    await page.getByRole('menuitem', { name: LABELS.cancelRide }).click();
    await page.getByRole('button', { name: LABELS.confirmDelete }).click();

    await expect.poll(async () => (await storedRides(page, tripId)).length).toBe(0);
  });

  test('a ride can be made from inside the transport dialog, and is selected', async ({
    page,
  }) => {
    const tripId = await openTransports(page);

    await page.getByRole('button', { name: LABELS.newTransport }).first().click();

    // No ride exists yet, so the select says so rather than offering nothing
    // with no explanation.
    await expect(page.getByText(/no ride arranged|aucun trajet organis/i)).toBeVisible();

    // The way out is right there, and the transport dialog stays open behind
    // it — losing what has been typed to go and make a car is the whole reason
    // this exists.
    await page.getByRole('button', { name: LABELS.newRide }).click();
    await page.getByLabel(LABELS.meetDatetime).fill(MEET_LOCAL);
    await pickMeetingPoint(page, PLACE.name);
    await page.getByRole('button', { name: LABELS.save }).click();

    await expect
      .poll(async () => (await storedRides(page, tripId)).length)
      .toBe(1);

    // Back on the transport form, with the new ride already chosen: the point
    // is not merely that the ride now exists but that the leg is in it.
    const rideSelect = page.getByRole('combobox', { name: LABELS.ride });
    await expect(rideSelect).toBeVisible();
    await expect(rideSelect).toContainText(/no car chosen|aucune voiture/i);
  });

  test('a leg dragged onto a ride card joins it, and the two cards do not look alike', async ({
    page,
  }) => {
    await stubExternalMapServices(page);

    const { tripId } = await seedTrip(page, {
        name: 'Drag Trip',
        startDate: fixtureDate(1),
        endDate: fixtureDate(10),
      }),
      alice = await seedPerson(page, tripId, 'Alice'),
      guillaume = await seedPerson(page, tripId, 'Guillaume'),
      rideId = await seedRide(page, {
        tripId,
        meetDatetime: `${fixtureDate(4)}T15:00:00.000Z`,
        location: PLACE.name,
        driverId: guillaume,
      });

    // Alice's arrival, in no car: exactly the row the handle exists for.
    const transportId = await seedTransport(page, {
      tripId,
      personId: alice,
      type: 'arrival',
      datetime: `${fixtureDate(4)}T15:05:00.000Z`,
      location: PLACE.name,
    });

    await page.goto(`/trips/${tripId}/transports`);
    await waitForRoute(page);

    // Scoped to the chronological list. The pickup alert panel above it also
    // names Alice and also draws cards, and a page-wide match takes both.
    const list = page.getByRole('list', { name: /transport/i }),
      legCard = list.getByRole('article').filter({ hasText: 'Alice' }),
      rideCard = list
        .getByRole('article')
        .filter({ hasText: /pick-up|aller chercher/i });

    // The two rows mean different things and must not be the same rectangle: a
    // car journey is a container, a leg is a request to be carried.
    const [legStyle, rideStyle] = await Promise.all([
      legCard.evaluate((el) => {
        const s = getComputedStyle(el);
        return { style: s.borderLeftStyle, width: s.borderLeftWidth };
      }),
      rideCard.evaluate((el) => {
        const s = getComputedStyle(el);
        return { style: s.borderLeftStyle, width: s.borderLeftWidth };
      }),
    ]);
    expect(legStyle.style).toBe('dashed');
    expect(rideStyle.style).toBe('solid');
    expect(parseFloat(rideStyle.width)).toBeGreaterThan(parseFloat(legStyle.width));

    // Drag the leg's handle onto the car. dnd-kit only starts once the pointer
    // has moved past its activation distance, so this is a press, two moves and
    // a release rather than `dragTo` — one jump never crosses the threshold in
    // a way its sensor sees.
    const handle = legCard.getByRole('button', { name: LABELS.dragToRide }),
      from = await handle.boundingBox(),
      to = await rideCard.boundingBox();

    expect(from).not.toBeNull();
    expect(to).not.toBeNull();
    if (from === null || to === null) {
      throw new Error('the cards have no box to drag between');
    }

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2 + 20, {
      steps: 5,
    });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
    await page.mouse.up();

    // Stored on the *leg*, never as a list on the ride: membership is a scalar
    // so two guests joining the same car offline both survive the merge.
    await expect
      .poll(async () =>
        page.evaluate((id: string) => {
          return new Promise<string | undefined>((resolve, reject) => {
            const request = indexedDB.open('kikouchou');
            request.onerror = () => reject(new Error('Failed to open database'));
            request.onsuccess = () => {
              const database = request.result,
                row = database
                  .transaction('transports', 'readonly')
                  .objectStore('transports')
                  .get(id);
              row.onsuccess = () => {
                const stored = row.result as { rideId?: string } | undefined;
                database.close();
                resolve(stored?.rideId);
              };
              row.onerror = () => {
                database.close();
                reject(new Error('Failed to read the transport'));
              };
            };
          });
        }, transportId),
      )
      .toBe(rideId);
  });
});
