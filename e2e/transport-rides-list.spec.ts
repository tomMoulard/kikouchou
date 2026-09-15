/**
 * @fileoverview E2E cover for the ride cards on the transport list.
 *
 * "Three guests in one car are one card" is a claim about the whole read path,
 * and every part of it lives somewhere else: membership is a scalar on each
 * leg (`Transport.rideId`), the car and the meeting time are a `Ride` row in a
 * different Dexie table, the guests are a third, and `resolveRides` is the only
 * thing that joins them. A unit test on the card is handed the finished
 * journey, so it can pass while the page hands it three journeys of one; a unit
 * test on the resolver never renders anything. Only a browser holds real rows
 * in IndexedDB, runs the live queries over them and paints the result, so this
 * is the only place the sentence can be checked as written.
 *
 * The second claim is the one that is easy to break by accident: a leg with no
 * ride and nobody driving must still render as its own transport card. Folding
 * everything into rides would be an easy over-reach, and the failure looks
 * identical to success from the resolver's side.
 *
 * @module e2e/transport-rides-list
 */

import { expect, test, type Page } from '@playwright/test';

import { fixtureDate, fixtureDatetime } from './support/fixture-dates';
import { waitForRoute } from './support/routes';
import {
  seedPerson,
  seedRide,
  seedTransport,
  seedTrip,
  seedVehicle,
} from './support/seed';

// ============================================================================
// Constants
// ============================================================================

/**
 * The browser's clock, pinned.
 *
 * A card renders its meeting time in the viewer's timezone, so a spec that
 * names a wall clock has to say which one it means. Seeding in UTC and reading
 * in UTC lets these assertions state the exact minute without encoding the
 * runner's own offset — the mistake `AGENTS.md` calls out for date fixtures,
 * one layer further out.
 */
test.use({ timezoneId: 'UTC' });

/**
 * Both locales, because the suite runs against whichever the browser asks for.
 *
 * Guest names are seeded by this spec and so are locale-independent; only the
 * app's own words need the alternation.
 */
const LABELS = {
  transportList: /^transports?$/i,
  pickup: /pick-?up|aller chercher/i,
  meetAt: /meeting at 14:30|rendez-vous à 14:30/i,
  leaveAt: /leave at 13:45|départ à 13:45/i,
  passengers: /3 passengers|3 passagers/i,
  noCar: /no car chosen|aucune voiture choisie/i,
} as const;

/** Where the car meets the three of them. */
const MEETING_POINT = 'Paris CDG Terminal 2E';

/** The car itself, named so the assertion cannot match anything else. */
const CAR_NAME = 'Rented Espace';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Seeds a trip whose three arrivals share one driven car.
 *
 * Every row is written **before** anything makes the trip current:
 * `YjsTripSync` mounts a document per trip and projects it back over Dexie, so
 * a raw write made after that races the projection and can simply vanish. That
 * is what made the map's ARIA test flaky in CI.
 *
 * @param page - Playwright page object
 * @returns The trip id and the guests' names
 */
async function seedSharedCarTrip(page: Page): Promise<{
  readonly tripId: string;
  readonly driverName: string;
  readonly passengerNames: readonly string[];
}> {
  const { tripId } = await seedTrip(page, {
    name: 'Shared Car Trip',
    startDate: fixtureDate(1),
    endDate: fixtureDate(10),
  });

  const alice = await seedPerson(page, tripId, 'Alice Aubert', '#3b82f6'),
    bruno = await seedPerson(page, tripId, 'Bruno Blanc', '#ef4444'),
    chloe = await seedPerson(page, tripId, 'Chloe Caron', '#22c55e'),
    diane = await seedPerson(page, tripId, 'Diane Dupont', '#a855f7');

  const vehicleId = await seedVehicle(page, {
    tripId,
    name: CAR_NAME,
    seatCount: 7,
  });

  // 45 minutes of lead time against a 14:30 rendez-vous, so the driver leaves
  // at 13:45 — a number no default could produce by accident.
  const rideId = await seedRide(page, {
    tripId,
    meetDatetime: fixtureDatetime(5, '14:30:00.000Z'),
    location: MEETING_POINT,
    direction: 'pickup',
    leadTimeMinutes: 45,
    driverId: diane,
    vehicleId,
  });

  // Membership lives on the leg: three transports, one shared `rideId`.
  await seedTransport(page, {
    tripId,
    personId: alice,
    type: 'arrival',
    datetime: fixtureDatetime(5, '14:15:00.000Z'),
    location: MEETING_POINT,
    rideId,
  });
  await seedTransport(page, {
    tripId,
    personId: bruno,
    type: 'arrival',
    datetime: fixtureDatetime(5, '14:30:00.000Z'),
    location: MEETING_POINT,
    rideId,
  });
  await seedTransport(page, {
    tripId,
    personId: chloe,
    type: 'arrival',
    datetime: fixtureDatetime(5, '14:45:00.000Z'),
    location: MEETING_POINT,
    rideId,
  });

  return {
    tripId,
    driverName: 'Diane Dupont',
    passengerNames: ['Alice Aubert', 'Bruno Blanc', 'Chloe Caron'],
  };
}

/**
 * Opens a trip's transport list and waits for the lazy route to arrive.
 *
 * @param page - Playwright page object
 * @param tripId - The trip to open
 */
async function openTransportList(page: Page, tripId: string): Promise<void> {
  await page.goto(`/trips/${tripId}/transports`);
  await waitForRoute(page);
}

// ============================================================================
// Tests
// ============================================================================

test.describe('rides on the transport list', () => {
  test('three guests in one car render as one card naming the driver and all three', async ({
    page,
  }) => {
    const { tripId, driverName, passengerNames } = await seedSharedCarTrip(page);

    await openTransportList(page, tripId);

    const list = page.getByRole('list', { name: LABELS.transportList }),
      cards = list.getByRole('article');

    // One card for the car. Three would be the bug this whole unit exists for.
    await expect(cards).toHaveCount(1);

    const card = cards.first();

    // The driver, named once, and every passenger beside them.
    await expect(card.getByText(driverName)).toBeVisible();
    for (const name of passengerNames) {
      await expect(card.getByText(name)).toBeVisible();
    }
    await expect(card.getByText(LABELS.passengers)).toBeVisible();
  });

  test('the card states where and when the car meets, and when to leave', async ({
    page,
  }) => {
    const { tripId } = await seedSharedCarTrip(page);

    await openTransportList(page, tripId);

    const card = page
      .getByRole('list', { name: LABELS.transportList })
      .getByRole('article')
      .first();

    await expect(card.getByText(LABELS.pickup)).toBeVisible();
    await expect(card.getByText(MEETING_POINT)).toBeVisible();
    await expect(card.getByText(LABELS.meetAt)).toBeVisible();
    // 14:30 minus the ride's own 45 minutes: derived here, not stored anywhere.
    await expect(card.getByText(LABELS.leaveAt)).toBeVisible();
    await expect(card.getByText(CAR_NAME)).toBeVisible();
  });

  test('every passenger keeps their own arrival time inside the shared card', async ({
    page,
  }) => {
    const { tripId } = await seedSharedCarTrip(page);

    await openTransportList(page, tripId);

    const card = page
      .getByRole('list', { name: LABELS.transportList })
      .getByRole('article')
      .first();

    // Three different landings in one car. A single shared time would be wrong
    // for two of the three people standing at the terminal.
    await expect(card.getByText('14:15', { exact: true })).toBeVisible();
    await expect(card.getByText('14:45', { exact: true })).toBeVisible();
  });

  test('a leg with no ride and nobody driving still gets its own card', async ({
    page,
  }) => {
    const { tripId } = await seedSharedCarTrip(page);

    // A departure, so it raises no pickup alert of its own — the amber panel
    // draws cards too, and this test is counting the list's.
    const solo = await seedPerson(page, tripId, 'Solo Sam', '#f97316');
    await seedTransport(page, {
      tripId,
      personId: solo,
      type: 'departure',
      datetime: fixtureDatetime(9, '09:00:00.000Z'),
      location: 'Gare de Lyon',
    });

    await openTransportList(page, tripId);

    const list = page.getByRole('list', { name: LABELS.transportList }),
      cards = list.getByRole('article');

    // The car, plus the lone traveller. Not four cards, and not one.
    await expect(cards).toHaveCount(2);

    const soloCard = cards.filter({ hasText: 'Solo Sam' });
    await expect(soloCard).toHaveCount(1);
    await expect(soloCard.getByText('Gare de Lyon')).toBeVisible();
    // It is a transport card, not a journey: nothing here talks about a car.
    await expect(soloCard.getByText(LABELS.noCar)).toHaveCount(0);
    await expect(soloCard.getByText('Alice Aubert')).toHaveCount(0);
  });
});
