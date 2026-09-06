/**
 * @fileoverview E2E cover for "show me only the travel that concerns me".
 *
 * The browser is the only place this can be asserted, because the feature is
 * three separately-testable halves that have to agree on one guest id:
 *
 *   - Settings writes the identity into `AppSettings.myPersonIdByTripId`;
 *   - `useTripIdentity` resolves it out of Dexie on a *different* route;
 *   - the transport list turns it into a filter and persists the choice in the
 *     URL, where a reload reads it back.
 *
 * A unit test on any one of them stays green while the chain is broken — the
 * settings card can save an id nothing reads, and the list can filter by an id
 * nothing writes. This is the test that fails when the two ends disagree, and
 * the only place "the choice survives a reload" is a claim about real history
 * rather than about a mocked `useSearchParams`.
 *
 * The legs are departures on purpose: a seeded arrival carries `needsPickup`,
 * which raises the unassigned-pickup alert panel — deliberately *not* scoped,
 * because a request for a driver that only its own passenger can see gets
 * nobody collected — and that panel would name the very guest this spec is
 * asserting is hidden.
 *
 * @module e2e/transport-scope-filter
 */

import { expect, test, type Page } from '@playwright/test';

import { fixtureDate, fixtureDatetime } from './support/fixture-dates';
import { waitForRoute } from './support/routes';
import { seedPerson, seedRide, seedTransport, seedTrip } from './support/seed';

// ============================================================================
// Constants
// ============================================================================

/**
 * Both locales, because the suite runs against whichever the browser asks for.
 */
const LABELS = {
  identity: /who are you\?|qui êtes-vous \?/i,
  scopeMine: /only mine|seulement les miens/i,
  scopeAll: /everyone|tout le monde/i,
  hidden: /hidden|masqué/i,
} as const;

/**
 * Guest names carrying a suffix nothing else on the page uses.
 *
 * A bare "Alice" also appears in placeholder copy and in other fixtures; the
 * assertions below are about one specific row being gone, which is exactly the
 * claim a loose text match cannot make.
 */
const GUESTS = {
  me: 'Tom Scope',
  passenger: 'Guillaume Scope',
  stranger: 'Alice Scope',
} as const;

// ============================================================================
// Helpers
// ============================================================================

/** Ids the assertions need back from the seeding. */
interface ScopeFixture {
  readonly tripId: string;
  readonly myPersonId: string;
}

/**
 * Seeds a trip whose travel splits three ways for one guest.
 *
 * Every row is written **before** anything makes the trip current: `YjsTripSync`
 * projects its document over Dexie and a raw write made afterwards races that
 * projection.
 *
 * - Tom leaves on his own train — his own leg;
 * - Tom drives Guillaume to the airport — a car he is in charge of;
 * - Alice leaves separately — somebody else's logistics entirely.
 *
 * @param page - Playwright page object
 * @returns The trip and the guest this device will claim to be
 */
async function seedScopeTrip(page: Page): Promise<ScopeFixture> {
  const { tripId } = await seedTrip(page, {
    name: 'Scope Filter Trip',
    startDate: fixtureDate(1),
    endDate: fixtureDate(10),
  });

  const myPersonId = await seedPerson(page, tripId, GUESTS.me),
    passengerId = await seedPerson(page, tripId, GUESTS.passenger, '#f97316'),
    strangerId = await seedPerson(page, tripId, GUESTS.stranger, '#22c55e');

  const rideId = await seedRide(page, {
    tripId,
    direction: 'dropoff',
    meetDatetime: fixtureDatetime(8, '09:00:00.000Z'),
    location: 'Lyon Saint-Exupéry',
    driverId: myPersonId,
  });

  await seedTransport(page, {
    tripId,
    personId: myPersonId,
    type: 'departure',
    datetime: fixtureDatetime(9, '11:00:00.000Z'),
    location: 'Lyon Part-Dieu',
  });

  await seedTransport(page, {
    tripId,
    personId: passengerId,
    type: 'departure',
    datetime: fixtureDatetime(8, '09:30:00.000Z'),
    location: 'Lyon Saint-Exupéry',
    rideId,
  });

  await seedTransport(page, {
    tripId,
    personId: strangerId,
    type: 'departure',
    datetime: fixtureDatetime(10, '07:00:00.000Z'),
    location: 'Gare de Perrache',
  });

  return { tripId, myPersonId };
}

/**
 * Says "I am Tom" through the Settings card, the way a user would.
 *
 * Going through the UI rather than writing the setting directly is the point:
 * the card is the only thing that can create an identity for a trip's own
 * organiser, who never opens their own share link.
 *
 * @param page - Playwright page object
 */
async function chooseMyself(page: Page): Promise<void> {
  await page.goto('/settings');
  await waitForRoute(page);

  await page.getByRole('combobox', { name: LABELS.identity }).click();
  await page.getByRole('option', { name: GUESTS.me }).click();

  // The write is a Dexie round trip; the trigger showing the name is the
  // earliest point at which it has certainly landed.
  await expect(page.getByRole('combobox', { name: LABELS.identity })).toContainText(
    GUESTS.me,
  );
}

/**
 * Opens the transport list for a trip.
 *
 * @param page - Playwright page object
 * @param tripId - The trip to open
 * @param search - Optional query string, `?scope=…` included
 */
async function openTransports(
  page: Page,
  tripId: string,
  search = '',
): Promise<void> {
  await page.goto(`/trips/${tripId}/transports${search}`);
  await waitForRoute(page);

  // My own leg is in every scope, so waiting for it proves the trip is current
  // and its transports have arrived — which is what the Settings card needs
  // before it can offer a guest list at all.
  await expect(page.getByText(GUESTS.me).first()).toBeVisible();
}

// ============================================================================
// Tests
// ============================================================================

test.describe('transport scope filter', () => {
  test('with no identity, the whole trip is shown and the switch is not offered', async ({
    page,
  }) => {
    const { tripId } = await seedScopeTrip(page);

    // `?scope=mine` from a shared link, on a device that does not know who it
    // is. Hiding everything here is the failure this clamp exists to prevent.
    await openTransports(page, tripId, '?scope=mine');

    await expect(page.getByText(GUESTS.me).first()).toBeVisible();
    await expect(page.getByText(GUESTS.stranger).first()).toBeVisible();
    await expect(page.getByRole('radiogroup')).toHaveCount(0);
  });

  test('with an identity chosen, "mine" hides another guest and the switch brings her back', async ({
    page,
  }) => {
    const { tripId } = await seedScopeTrip(page);

    await openTransports(page, tripId);
    await chooseMyself(page);
    await openTransports(page, tripId, '?scope=mine');

    // My own leg, and the passenger in the car I am driving — his leg is not
    // mine, and collecting him is still my job.
    await expect(page.getByText(GUESTS.me).first()).toBeVisible();
    await expect(page.getByText(GUESTS.passenger).first()).toBeVisible();
    await expect(page.getByText(GUESTS.stranger)).toHaveCount(0);

    // What it is hiding, said out loud rather than left as a silently short list.
    await expect(page.getByRole('status').filter({ hasText: LABELS.hidden })).toBeVisible();

    await page.getByRole('radio', { name: LABELS.scopeAll }).click();

    await expect(page.getByText(GUESTS.stranger).first()).toBeVisible();
    await expect(page).toHaveURL(/[?&]scope=all/);
  });

  test('the choice rides in the URL, so a reload keeps it', async ({ page }) => {
    const { tripId } = await seedScopeTrip(page);

    await openTransports(page, tripId);
    await chooseMyself(page);
    await openTransports(page, tripId);

    // Nothing in the URL yet: an identified device defaults to its own travel.
    await expect(page.getByText(GUESTS.stranger)).toHaveCount(0);
    await expect(page.getByRole('radio', { name: LABELS.scopeMine })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await page.getByRole('radio', { name: LABELS.scopeAll }).click();
    await expect(page.getByText(GUESTS.stranger).first()).toBeVisible();

    await page.reload();
    await waitForRoute(page);

    await expect(page.getByText(GUESTS.stranger).first()).toBeVisible();
    await expect(
      page.getByRole('radio', { name: LABELS.scopeAll }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  test('"show everyone" in the hidden-count message is the same one tap', async ({
    page,
  }) => {
    const { tripId } = await seedScopeTrip(page);

    await openTransports(page, tripId);
    await chooseMyself(page);
    await openTransports(page, tripId, '?scope=mine');

    const status = page.getByRole('status').filter({ hasText: LABELS.hidden });
    await expect(status).toBeVisible();

    await status.getByRole('button', { name: LABELS.scopeAll }).click();

    await expect(page.getByText(GUESTS.stranger).first()).toBeVisible();
    await expect(status).toHaveCount(0);
  });
});
