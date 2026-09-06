/**
 * @fileoverview The six ride requirements, asserted together in a real browser.
 *
 * Every part of the ride feature has unit cover of its own, and every one of
 * those units can be green while the feature is broken. The reason is that a
 * ride is never rendered by the thing that stores it: `resolveRides()` joins
 * four Dexie tables, `summariseRideCapacity()` counts bodies through a headcount
 * resolver, `useTripIdentity()` answers from `localStorage` and a settings
 * singleton, and the transport list draws the result. A test that mocks any one
 * of those is testing its own fixture. Three failures this suite exists to catch
 * cannot be reproduced anywhere else:
 *
 * - **The row never reaches the screen.** Rides and vehicles were written to
 *   Dexie and never published to the shared Yjs document, so `YjsTripSync`
 *   projected the document back over Dexie and deleted them. Nothing below the
 *   browser noticed: the repositories wrote, the reducers read, and the car
 *   disappeared somewhere between them.
 * - **Two surfaces answer the same question differently.** The amber "nobody is
 *   driving yet" panel and the per-leg "needs pickup" badge asked it from two
 *   definitions, so one page contradicted itself — with each half's own unit
 *   test passing.
 * - **Rows are counted instead of people.** A guest row can stand for a couple,
 *   so "does this lot fit in that car" has a right and a wrong answer that agree
 *   on every fixture where each row is one person. The over-capacity scenario
 *   below seeds a `headcount: 2` guest precisely so the wrong answer fails.
 *
 * Requirement coverage, one scenario each: (1) only the driver is told when a
 * passenger moves, (2) "I am Tom" filters to what concerns me, (3) several
 * guests share one car, (4) a ride may be driven by one of its passengers,
 * (5) a child needs a seat the car may not carry, (6) a car has a capacity.
 *
 * @module e2e/transport-rides
 */

import { expect, test, type Page } from '@playwright/test';

import { fixtureDate, fixtureDatetime } from './support/fixture-dates';
import { waitForRoute } from './support/routes';
import {
  seedPerson,
  seedRide,
  seedTransport,
  seedTrip,
  seedTripIdentity,
  seedVehicle,
} from './support/seed';
import { clearIndexedDB } from './support/storage';

// ============================================================================
// Constants
// ============================================================================

/**
 * Every string this suite matches, in both locales.
 *
 * The suite runs against whichever language the browser asks for, and the app
 * defaults to French, so an English-only locator passes or fails by machine.
 * Each pattern is built from a translation key the ride foundation shipped in
 * `en` and `fr` together — the interpolated ones spell out the rendered
 * sentence rather than a fragment, so a card showing the wrong number fails.
 */
const TEXT = {
  /** `transports.needsPickup` — the per-leg badge. */
  needsPickup: /needs pickup|nécessite un transport/i,
  /**
   * `rides.driver` / `transports.driver` immediately followed by Tom's name.
   *
   * The label alone would be too weak — a card may legitimately print it for
   * somebody else — and the name alone far too weak, since Tom is in the car
   * either way. What must not appear is the pair: Tom described as the person
   * driving *for* the others.
   */
  tomAsChauffeur: /(driver|conducteur|chauffeur)\s*:?\s*tom\b/i,
  /** `rides.selfDriven`. */
  selfDriven: /driving themselves|conduisent eux-m[êe]mes/i,
  /** `rides.passengers` with three of them. */
  threePassengers: /3 passengers|3 passagers/i,
  /** `vehicles.overCapacity` for four people in a three-seat car. */
  overCapacityFourInThree: /4 people for 3 seats|4 personnes pour 3 places/i,
  /** `childSeats.missing` interpolated with `childSeats.booster`. */
  missingBooster: /missing 1 booster seat|il manque 1 r[ée]hausseur/i,
  /** `identity.scopeMine` / `identity.scopeAll`. */
  scopeMine: /only mine|seulement les miens/i,
  scopeAll: /everyone|tout le monde/i,
  /** `rides.legMismatch.after`, interpolated for Alice and 120 minutes. */
  aliceMovedTwoHours:
    /alice now arrives 120 min after this ride|alice arrive maintenant 120 min après ce trajet/i,
} as const;

/** The meeting time every fixture ride uses, and the legs that match it. */
const MEET_AT = fixtureDatetime(10, '10:00:00.000Z');

// ============================================================================
// Helpers
// ============================================================================

/**
 * Opens a trip's transport list and waits for its lazy chunk.
 *
 * `waitForLoadState('load')` is not enough on its own: every route is a lazy
 * chunk, so `load` fires while `main` still holds the suspense fallback and an
 * instant read reports the whole feature missing.
 *
 * @param page - Playwright page object
 * @param tripId - The trip whose transports to open
 */
async function openTransports(page: Page, tripId: string): Promise<void> {
  await page.goto(`/trips/${tripId}/transports`);
  await page.waitForLoadState('load');
  await waitForRoute(page);
}

/**
 * Seeds an empty trip, on a cleared profile.
 *
 * Every row a scenario needs must be written **before** anything makes the trip
 * current: `YjsTripSync` mounts a document per trip and projects it back over
 * Dexie, so a raw write racing that projection can be dropped. That is what
 * made the map's ARIA test flaky in CI, and it is why no helper here navigates
 * into a trip.
 *
 * @param page - Playwright page object
 * @param name - Trip name
 * @returns The trip's id and share id
 */
async function seedEmptyTrip(
  page: Page,
  name: string,
): Promise<{ tripId: string; shareId: string }> {
  await clearIndexedDB(page);

  return await seedTrip(page, {
    name,
    startDate: fixtureDate(1),
    endDate: fixtureDate(28),
  });
}

// ============================================================================
// Requirement 3 — several guests share one car
// ============================================================================

test.describe('a car shared by several guests', () => {
  test('a leg in a driven ride stops asking for a pickup', async ({ page }) => {
    // The anchor for everything below: it proves the seeded rows survive the
    // document projection and reach the screen, and it is the assertion that
    // caught the two surfaces answering "is anybody driving this leg?" from two
    // definitions — the panel went quiet while the leg's own card did not.
    const { tripId } = await seedEmptyTrip(page, 'Shared Car Trip');
    const alice = await seedPerson(page, tripId, 'Alice');
    const guillaume = await seedPerson(page, tripId, 'Guillaume');
    const vehicleId = await seedVehicle(page, {
      tripId,
      name: 'Espace de location',
      seatCount: 7,
    });
    const rideId = await seedRide(page, {
      tripId,
      meetDatetime: MEET_AT,
      location: 'Gare de Vannes',
      driverId: guillaume,
      vehicleId,
    });
    await seedTransport(page, {
      tripId,
      personId: alice,
      type: 'arrival',
      datetime: MEET_AT,
      location: 'Gare de Vannes',
      rideId,
    });

    await openTransports(page, tripId);

    // Alice's leg is on the page…
    await expect(page.getByText('Alice').first()).toBeVisible();
    // …and nothing on it still says nobody is collecting her.
    await expect(page.getByText(TEXT.needsPickup)).toHaveCount(0);
  });

  // Waiting on feat/rides-on-transport-list: nothing renders a ride card yet.
  test.fixme('three guests in one ride render as one car, not three', async ({ page }) => {
    const { tripId } = await seedEmptyTrip(page, 'Three Guests Trip');
    const alice = await seedPerson(page, tripId, 'Alice');
    const bruno = await seedPerson(page, tripId, 'Bruno');
    const chloe = await seedPerson(page, tripId, 'Chloé');
    const guillaume = await seedPerson(page, tripId, 'Guillaume');
    const vehicleId = await seedVehicle(page, {
      tripId,
      name: 'Espace de location',
      seatCount: 7,
    });
    const rideId = await seedRide(page, {
      tripId,
      meetDatetime: MEET_AT,
      location: 'Gare de Vannes',
      driverId: guillaume,
      vehicleId,
    });
    for (const personId of [alice, bruno, chloe]) {
      await seedTransport(page, {
        tripId,
        personId,
        type: 'arrival',
        datetime: MEET_AT,
        location: 'Gare de Vannes',
        rideId,
      });
    }

    await openTransports(page, tripId);

    // One car. The car's name is what says so: three legs rendered as three
    // separate journeys would print it three times, which is the failure this
    // count is here to catch rather than a stylistic preference.
    await expect(page.getByText('Espace de location')).toHaveCount(1);
    // …carrying all three, said as a number so a card listing one name and
    // "and 2 others" still has to get the total right.
    await expect(page.getByText(TEXT.threePassengers)).toBeVisible();
    // …and naming everybody, driver included.
    for (const name of ['Alice', 'Bruno', 'Chloé', 'Guillaume']) {
      await expect(page.getByText(name).first()).toBeVisible();
    }
  });
});

// ============================================================================
// Requirement 4 — a ride driven by one of its own passengers
// ============================================================================

test.describe('a ride driven by one of its passengers', () => {
  // Waiting on feat/rides-on-transport-list: nothing renders a ride card yet.
  test.fixme('reads as self-driven rather than naming a chauffeur', async ({ page }) => {
    // Tom and Aurélia fly in and take the hire car on from the airport. Nothing
    // stores "self-driven": it is derived from the driver owning one of the
    // legs, so a card that names Tom as somebody else's chauffeur has read the
    // arrangement wrong rather than merely worded it oddly.
    const { tripId } = await seedEmptyTrip(page, 'Hire Car Trip');
    const tom = await seedPerson(page, tripId, 'Tom');
    const aurelia = await seedPerson(page, tripId, 'Aurélia');
    const vehicleId = await seedVehicle(page, {
      tripId,
      name: 'Espace de location',
      seatCount: 7,
      isRental: true,
    });
    const rideId = await seedRide(page, {
      tripId,
      meetDatetime: MEET_AT,
      location: 'Aéroport de Nantes',
      driverId: tom,
      vehicleId,
    });
    for (const personId of [tom, aurelia]) {
      await seedTransport(page, {
        tripId,
        personId,
        type: 'arrival',
        datetime: MEET_AT,
        location: 'Aéroport de Nantes',
        rideId,
      });
    }

    await openTransports(page, tripId);

    await expect(page.getByText(TEXT.selfDriven)).toBeVisible();
    // And no "Driver: Tom" anywhere. Tom is not driving *for* anyone; he is one
    // of the two people in the car, and the whole point of deriving this rather
    // than storing it is that the card stops describing him as a chauffeur.
    await expect(page.getByText(TEXT.tomAsChauffeur)).toHaveCount(0);
  });
});

// ============================================================================
// Requirement 6 — a car has a capacity, and it counts people
// ============================================================================

test.describe('a car with a capacity', () => {
  // Waiting on feat/ride-capacity-warnings: no capacity surface renders yet.
  test.fixme('warns when the passengers outnumber the seats, counting people', async ({
    page,
  }) => {
    // Three seats. Guillaume drives and is not a passenger, so he takes one.
    // Alice's row stands for two people and Bruno's for one: four bodies.
    //
    // Counted as rows it is 2 legs + 1 driver = 3, which fits exactly and
    // raises nothing — so this scenario fails, loudly and with the wrong
    // number, the moment anybody counts rows instead of people.
    const { tripId } = await seedEmptyTrip(page, 'Small Car Trip');
    const alice = await seedPerson(page, tripId, 'Alice', '#3b82f6', { headcount: 2 });
    const bruno = await seedPerson(page, tripId, 'Bruno');
    const guillaume = await seedPerson(page, tripId, 'Guillaume');
    const vehicleId = await seedVehicle(page, {
      tripId,
      name: 'Clio de Guillaume',
      seatCount: 3,
    });
    const rideId = await seedRide(page, {
      tripId,
      meetDatetime: MEET_AT,
      location: 'Gare de Vannes',
      driverId: guillaume,
      vehicleId,
    });
    for (const personId of [alice, bruno]) {
      await seedTransport(page, {
        tripId,
        personId,
        type: 'arrival',
        datetime: MEET_AT,
        location: 'Gare de Vannes',
        rideId,
      });
    }

    await openTransports(page, tripId);

    await expect(page.getByText(TEXT.overCapacityFourInThree)).toBeVisible();
  });
});

// ============================================================================
// Requirement 5 — child seats, named rather than merely counted
// ============================================================================

test.describe('a child who needs a seat', () => {
  // Waiting on feat/ride-capacity-warnings: no child-seat shortfall renders yet.
  test.fixme('names the restraint the car is short of', async ({ page }) => {
    // Léa needs a booster and the Clio carries a rear-facing seat and nothing
    // else. "This car is not suitable" would be useless: the parent needs to
    // know *which* seat to put in the boot, so the shortfall is named.
    const { tripId } = await seedEmptyTrip(page, 'Child Seat Trip');
    const lea = await seedPerson(page, tripId, 'Léa', '#3b82f6', {
      childSeat: 'booster',
    });
    const guillaume = await seedPerson(page, tripId, 'Guillaume');
    const vehicleId = await seedVehicle(page, {
      tripId,
      name: 'Clio de Guillaume',
      seatCount: 5,
      childSeats: ['rearFacing'],
    });
    const rideId = await seedRide(page, {
      tripId,
      meetDatetime: MEET_AT,
      location: 'Gare de Vannes',
      driverId: guillaume,
      vehicleId,
    });
    await seedTransport(page, {
      tripId,
      personId: lea,
      type: 'arrival',
      datetime: MEET_AT,
      location: 'Gare de Vannes',
      rideId,
    });

    await openTransports(page, tripId);

    await expect(page.getByText(TEXT.missingBooster)).toBeVisible();
  });
});

// ============================================================================
// Requirement 2 — "I am Tom", and the scope that follows from it
// ============================================================================

test.describe('an identified guest filtering to their own travel', () => {
  // Waiting on feat/transport-scope-filter: the scope switch does not exist yet.
  test.fixme('the mine scope hides another guest\'s leg, and the switch brings it back', async ({
    page,
  }) => {
    const { tripId, shareId } = await seedEmptyTrip(page, 'Scope Trip');
    const alice = await seedPerson(page, tripId, 'Alice');
    const bruno = await seedPerson(page, tripId, 'Bruno');
    // Departures, so neither leg needs collecting: an arrival would also list
    // both names in the amber "nobody is driving yet" panel, and a name hidden
    // from the list but still sitting in the panel would read as a pass here
    // while the guest still saw somebody else's travel.
    await seedTransport(page, {
      tripId,
      personId: alice,
      type: 'departure',
      datetime: MEET_AT,
      location: 'Gare de Vannes',
    });
    await seedTransport(page, {
      tripId,
      personId: bruno,
      type: 'departure',
      datetime: fixtureDatetime(11, '15:00:00.000Z'),
      location: 'Aéroport de Nantes',
    });
    // Told before the trip is opened, so the first paint already knows who this
    // device is. An identity arriving after the list has rendered is a
    // different scenario, and not one a filter should have to survive.
    await seedTripIdentity(page, { shareId, tripId, personId: alice });

    await openTransports(page, tripId);

    await page.getByRole('radio', { name: TEXT.scopeMine }).click();
    await expect(page.getByText('Alice').first()).toBeVisible();
    await expect(page.getByText('Bruno')).toHaveCount(0);

    await page.getByRole('radio', { name: TEXT.scopeAll }).click();
    await expect(page.getByText('Bruno').first()).toBeVisible();
    await expect(page.getByText('Alice').first()).toBeVisible();
  });
});

// ============================================================================
// Requirement 1 — the driver, and only the driver, hears about a change
// ============================================================================

test.describe('a passenger moving their pickup time', () => {
  /**
   * Seeds one car meeting two guests, with Alice's train two hours late.
   *
   * Two hours is deliberately outside `RIDE_MATCH_WINDOW_MINUTES`: an hour
   * either side is the window the app's own pickup grouping uses to suggest
   * that several legs could share a car, so a group the app proposed itself
   * must never come back flagged.
   *
   * @param page - Playwright page object
   * @returns The trip, its share id and the two people in the car
   */
  async function seedMovedLeg(page: Page): Promise<{
    tripId: string;
    shareId: string;
    driver: string;
    passenger: string;
  }> {
    const { tripId, shareId } = await seedEmptyTrip(page, 'Moved Leg Trip');
    const alice = await seedPerson(page, tripId, 'Alice');
    const guillaume = await seedPerson(page, tripId, 'Guillaume');
    const vehicleId = await seedVehicle(page, {
      tripId,
      name: 'Espace de location',
      seatCount: 7,
    });
    const rideId = await seedRide(page, {
      tripId,
      meetDatetime: MEET_AT,
      location: 'Gare de Vannes',
      driverId: guillaume,
      vehicleId,
    });
    // Guillaume is driving and is not a passenger, so the only leg in this car
    // is Alice's — and it now lands two hours after the car is due.
    await seedTransport(page, {
      tripId,
      personId: alice,
      type: 'arrival',
      datetime: fixtureDatetime(10, '12:00:00.000Z'),
      location: 'Gare de Vannes',
      rideId,
    });

    return { tripId, shareId, driver: guillaume, passenger: alice };
  }

  // Waiting on feat/pickup-change-feed: no moved-leg notice renders yet.
  test.fixme('is reported to the driver, who is the only one who can act on it', async ({
    page,
  }) => {
    const { tripId, shareId, driver } = await seedMovedLeg(page);
    await seedTripIdentity(page, { shareId, tripId, personId: driver });

    await openTransports(page, tripId);

    await expect(page.getByText(TEXT.aliceMovedTwoHours)).toBeVisible();
  });

  // Waiting on feat/pickup-change-feed too, and fixme'd although it is green:
  // with no notice rendered anywhere the assertion cannot fail, and a test that
  // cannot fail is worse than one that says why it is skipped.
  test.fixme('is not reported to a passenger, who would only be alarmed by it', async ({
    page,
  }) => {
    // The other half of the rule, and the half a one-sided test cannot see: a
    // notice rendered unconditionally passes the driver's test perfectly.
    const { tripId, shareId, passenger } = await seedMovedLeg(page);
    await seedTripIdentity(page, { shareId, tripId, personId: passenger });

    await openTransports(page, tripId);

    await expect(page.getByText(TEXT.aliceMovedTwoHours)).toHaveCount(0);
  });
});
