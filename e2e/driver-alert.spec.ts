/**
 * @fileoverview E2E cover for the driver's "you need to leave" banner.
 *
 * Three of the four claims below can only be made in a browser.
 *
 * The banner is assembled from four sources that no unit test holds together:
 * the legs (`TransportContext`), the cars (`RideContext`), the guests
 * (`PersonContext`) and *which guest this device is*, which is resolved from
 * `localStorage` and Dexie by `useTripIdentity`. A component test mocks all
 * four, so it can prove the copy is right and prove nothing at all about the
 * wiring reaching real rows.
 *
 * And the fourth claim is a claim about layout that only a real renderer can
 * settle: **the banner must not eat taps**. Three separate bugs in this repo
 * were a fixed overlay swallowing clicks along a strip nobody could see —
 * `OfflineIndicator` made "New trip" unclickable while offline, and the toaster
 * covered first the mobile nav bar and then the FAB. A screenshot shows none of
 * them. The check is a hit test at the target's own centre, followed by a click
 * that has to actually navigate.
 *
 * @module e2e/driver-alert
 */

import { expect, test, type Page } from '@playwright/test';

import { fixtureDate } from './support/fixture-dates';
import { waitForRoute } from './support/routes';
import { seedPerson, seedRide, seedTransport, seedTrip } from './support/seed';

// ============================================================================
// Constants
// ============================================================================

/**
 * Both locales, because the suite runs against whichever the browser asks for.
 *
 * The French drop-off and self-driven headlines share the prefix "Partez
 * maintenant pour", so the self-driven case is asserted by what it says
 * *instead* — the place — and separately by the absence of "aller chercher".
 */
const LABELS = {
  banner: /you are driving|vous conduisez/i,
  leaveNowPickup: /leave now to pick up|partez maintenant pour aller chercher/i,
  leaveNowForPlace: /leave now for CDG|partez maintenant pour CDG/i,
  pickUpSomebody: /to pick up|aller chercher/i,
  calendar: /calendar|calendrier/i,
  mobileNav: /mobile navigation|navigation mobile/i,
} as const;

/**
 * The lead time every ride below is seeded with, in minutes.
 *
 * Stated rather than defaulted so the arithmetic in each test is visible: a
 * meeting `MEETING_MINUTES_AHEAD` from now with this lead means the driver
 * should already have set off.
 */
const LEAD_TIME_MINUTES = 30;

/** How far ahead the meeting is placed, so the lead window is already open. */
const MEETING_MINUTES_AHEAD = 10;

// ============================================================================
// Helpers
// ============================================================================

/**
 * An ISO instant a given number of minutes from now.
 *
 * Deliberately *not* from `fixture-dates`: those name a month ahead of today,
 * which is the right answer for a trip's dates and the wrong one for a ride
 * that has to be due within the hour. The rule the fixture module encodes is
 * "derive from today, never a literal month", and this does exactly that — it
 * simply derives a much shorter offset.
 *
 * @param minutes - Minutes ahead of now
 * @returns The UTC ISO instant
 */
function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/**
 * The wall-clock `HH:mm` the app will print for an instant.
 *
 * Node and the browser share this machine's timezone — nothing in
 * `playwright.config.ts` sets `timezoneId` — so the two agree, and CI runs both
 * at UTC. What must never appear here is a hard-coded offset.
 *
 * @param isoInstant - The instant to render
 * @returns The 24-hour local time, e.g. `16:32`
 */
function localClock(isoInstant: string): string {
  return new Date(isoInstant).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** What {@link seedDrivenRide} hands back to the assertions. */
interface SeededRide {
  readonly tripId: string;
  /** The trip's share id — the key guest identities are filed under. */
  readonly shareId: string;
  readonly driverId: string;
  readonly passengerId: string;
  /** The instant the driver must set off, ISO. */
  readonly leaveAt: string;
}

/**
 * Seeds a trip with one car the driver is late for.
 *
 * Every row is written **before** anything makes the trip current, which is not
 * tidiness: `YjsTripSync` mounts a document per trip and projects it back over
 * Dexie, so a raw write made after that document has loaded races the mirror
 * and can be dropped on the next projection. That is what made the map's ARIA
 * test flaky in CI.
 *
 * @param page - Playwright page object
 * @param options - Whether the driver is also the passenger, and where to
 *   Ride direction and place, so the self-driven wording can be exercised
 * @returns The ids and the departure instant
 */
async function seedDrivenRide(
  page: Page,
  options: {
    readonly selfDriven?: boolean;
    readonly direction?: 'pickup' | 'dropoff';
    readonly location?: string;
  } = {},
): Promise<SeededRide> {
  const location = options.location ?? 'Lyon Part-Dieu';
  const meetDatetime = minutesFromNow(MEETING_MINUTES_AHEAD);

  const { tripId, shareId } = await seedTrip(page, {
    name: 'Driver Alert Trip',
    startDate: fixtureDate(1),
    endDate: fixtureDate(10),
  });

  const driverId = await seedPerson(page, tripId, 'Guillaume');
  const otherId = await seedPerson(page, tripId, 'Alice', '#f97316');
  const passengerId = options.selfDriven === true ? driverId : otherId;

  const rideId = await seedRide(page, {
    tripId,
    meetDatetime,
    location,
    direction: options.direction ?? 'pickup',
    leadTimeMinutes: LEAD_TIME_MINUTES,
    driverId,
  });

  await seedTransport(page, {
    tripId,
    personId: passengerId,
    type: options.direction === 'dropoff' ? 'departure' : 'arrival',
    datetime: meetDatetime,
    location,
    rideId,
  });

  return {
    tripId,
    shareId,
    driverId,
    passengerId: otherId,
    leaveAt: minutesFromNow(MEETING_MINUTES_AHEAD - LEAD_TIME_MINUTES),
  };
}

/**
 * Tells this browser which guest it is, the way the share wizard does.
 *
 * `useTripIdentity` reads this before it reads anything in Dexie, and it is the
 * only source that needs no account and no join — which makes it the cheapest
 * honest way to put a driver behind the wheel in a test.
 *
 * @param page - Playwright page object
 * @param seeded - The seeded trip, for its id and share id
 * @param personId - The guest this browser is
 */
async function identifyAs(
  page: Page,
  seeded: SeededRide,
  personId: string,
): Promise<void> {
  await page.evaluate(
    ({ shareId, tripId, personId }) => {
      // Filed under the *share* id, which is how the wizard writes it and how
      // `getTripGuestPersonId` looks it up; the payload names the trip so a
      // stale entry from another trip is ignored rather than believed.
      window.localStorage.setItem(
        `kikouchou_guest_${shareId}`,
        JSON.stringify({ personId, tripId }),
      );
    },
    { shareId: seeded.shareId, tripId: seeded.tripId, personId },
  );
}

/**
 * Opens the transport list for a trip, once every row is in place.
 *
 * @param page - Playwright page object
 * @param tripId - The trip to open
 */
async function openTransports(page: Page, tripId: string): Promise<void> {
  await page.goto(`/trips/${tripId}/transports`);
  await waitForRoute(page);
}

// ============================================================================
// Tests
// ============================================================================

test.describe('driver departure alert', () => {
  test('tells the driver to leave, and says the clock time', async ({ page }) => {
    const seeded = await seedDrivenRide(page);
    await identifyAs(page, seeded, seeded.driverId);

    await openTransports(page, seeded.tripId);

    const banner = page.getByRole('region', { name: LABELS.banner });
    await expect(banner).toBeVisible();
    await expect(banner.getByText(LABELS.leaveNowPickup)).toBeVisible();

    // The whole point of requirement 2: an actual wall-clock time, so the card
    // still means something on a screenshot or on a phone left on the table.
    await expect(banner).toContainText(localClock(seeded.leaveAt));
  });

  test('says nothing to the passenger of that same car', async ({ page }) => {
    const seeded = await seedDrivenRide(page);
    await identifyAs(page, seeded, seeded.passengerId);

    await openTransports(page, seeded.tripId);

    // The transport list itself is up — so this is "the banner is absent",
    // not "the page never rendered".
    await expect(
      page.getByRole('heading', { name: /^transports?$/i }).first(),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: LABELS.banner })).toBeHidden();
  });

  test('drops the pick-up wording when the driver is one of the travellers', async ({
    page,
  }) => {
    const seeded = await seedDrivenRide(page, {
      selfDriven: true,
      direction: 'dropoff',
      location: 'CDG',
    });
    await identifyAs(page, seeded, seeded.driverId);

    await openTransports(page, seeded.tripId);

    const banner = page.getByRole('region', { name: LABELS.banner });
    await expect(banner).toBeVisible();
    await expect(banner.getByText(LABELS.leaveNowForPlace)).toBeVisible();
    // Tom and Aurélia taking the hire car to the airport *are* the passengers.
    await expect(banner.getByText(LABELS.pickUpSomebody)).toHaveCount(0);
  });

  test.describe('on a phone', () => {
    // The mobile nav bar is `md:hidden`, so the bug this file exists to catch
    // only exists at a phone width.
    test.use({ viewport: { width: 390, height: 844 } });

    test('does not eat taps meant for the navigation bar', async ({ page }) => {
      const seeded = await seedDrivenRide(page);
      await identifyAs(page, seeded, seeded.driverId);

      await openTransports(page, seeded.tripId);

      await expect(page.getByRole('region', { name: LABELS.banner })).toBeVisible();

      const navigation = page.getByRole('navigation', { name: LABELS.mobileNav });
      const calendarLink = navigation.getByRole('link', { name: LABELS.calendar });
      await expect(calendarLink).toBeVisible();

      // The hit test proper: whatever the browser hands back at the link's own
      // centre has to be the link, not something painted over it. `expect.poll`
      // rather than `page.waitForFunction`, which does not await an async
      // predicate — a pending Promise is truthy, so it asserts nothing.
      await expect
        .poll(async () => {
          const box = await calendarLink.boundingBox();
          if (box === null) {
            return 'no box';
          }
          return await page.evaluate(
            ({ x, y }) => {
              const hit = document.elementFromPoint(x, y);
              return hit === null ? 'nothing' : (hit.closest('a') ?? hit).tagName;
            },
            { x: box.x + box.width / 2, y: box.y + box.height / 2 },
          );
        })
        .toBe('A');

      // And the tap itself has to arrive. Playwright's own actionability check
      // fails a click that another element intercepts, so this is the same
      // assertion from the other side — plus proof the route actually changed.
      await calendarLink.click();
      await waitForRoute(page);

      await expect(page).toHaveURL(new RegExp(`/trips/${seeded.tripId}/calendar`));
    });
  });
});
