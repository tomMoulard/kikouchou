/**
 * @fileoverview The mobile bottom edge: nav bar, FABs, toasts, install prompt.
 *
 * A phone screen has four things anchored to its bottom edge and they have
 * shipped on top of each other three times already — the offline pill over
 * "New trip", a toast over the whole nav bar, the same toast over the FAB.
 * AGENTS.md names the check that catches it: **a hit test at the covered
 * element's own centre**, `document.elementFromPoint`, not a look at a
 * screenshot. A screenshot cannot say which of two overlapping boxes receives
 * the tap; `elementFromPoint` answers exactly that.
 *
 * Every assertion here is that hit test. They run at a phone viewport rather
 * than the project's own, because below `sm` is the only width at which the FAB
 * and the nav bar both exist.
 *
 * @module e2e/mobile-bottom-edge
 */

import { test, expect, type Locator, type Page } from '@playwright/test';

import {
  INSTALL_REGION_LABEL,
  fakeBeforeInstallPrompt,
} from './support/install-prompt';
import { waitForRoute } from './support/routes';
import { seedPerson, seedTransport, seedTrip } from './support/seed';

// ============================================================================
// Fixtures
// ============================================================================

/**
 * A phone: narrower than `sm` (40rem), so the FAB renders, and narrower than
 * `md` (48rem), so the bottom nav bar renders. Both projects that pick this
 * spec up (`chromium`, `Mobile Chrome`) then see the same geometry.
 */
test.use({ viewport: { width: 393, height: 852 } });

/**
 * Fixture dates two months out, so nothing seeded here is folded into a
 * "Past …" accordion as the calendar moves on — the trick
 * `phase16-ux-improvements.spec.ts` uses, for the same reason.
 */
const FIXTURE_MONTH = ((): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));
})();

/** `YYYY-MM-DD` for a 1-based day of the fixture month. */
function fixtureDate(dayOfMonth: number): string {
  const date = new Date(FIXTURE_MONTH);
  date.setUTCDate(dayOfMonth);
  return date.toISOString().slice(0, 10);
}

/**
 * The app's own language detection reads `localStorage` then the navigator, and
 * falls back to French — so a label can come back in either language depending
 * on the machine. Every name matched here therefore carries both.
 */
const MOBILE_NAV_LABEL = /mobile navigation|navigation mobile/i,
  MORE_BUTTON_LABEL = /^(more|plus)$/i;

// ============================================================================
// Locators
// ============================================================================

/**
 * The page's primary floating action button.
 *
 * Matched on the two classes that make it what it is — `fixed` and
 * `rounded-full` — rather than on its label, because `/trips` has a second FAB
 * above it and both list pages and page headers carry a button with the same
 * "New …" name. `.last()` is the primary one: the stacked QR button on `/trips`
 * renders before it.
 */
function fabOf(page: Page): Locator {
  return page.locator('button.fixed.rounded-full').last();
}

// ============================================================================
// The hit test
// ============================================================================

/**
 * What `document.elementFromPoint` returned at an element's own centre.
 */
interface CentreHit {
  /** True when the element itself, or a descendant, took the point. */
  readonly reachesSelf: boolean;
  /** The topmost element there, as `tag#id.class`, for the failure message. */
  readonly hit: string;
  /** The centre, in client coordinates. */
  readonly point: { readonly x: number; readonly y: number };
}

/**
 * Asks the browser who receives a tap at the centre of `locator`.
 *
 * The element is scrolled into view first: `elementFromPoint` is defined only
 * over the visual viewport and returns `null` for a point outside it, which
 * would read as "covered" and fail for the wrong reason.
 *
 * @param locator - The element to probe
 * @returns Who took the point, and where the point was
 */
async function hitTestCentre(locator: Locator): Promise<CentreHit> {
  await locator.scrollIntoViewIfNeeded();

  return await locator.evaluate((element: Element): CentreHit => {
    const describe = (node: Element | null): string => {
      if (node === null) {
        return '(nothing — the point is outside the viewport)';
      }
      const id = node.id === '' ? '' : `#${node.id}`,
        classes =
          typeof node.className === 'string' && node.className.trim() !== ''
            ? `.${node.className.trim().split(/\s+/).join('.')}`
            : '';
      return `${node.tagName.toLowerCase()}${id}${classes}`;
    };

    const rect = element.getBoundingClientRect(),
      point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      hit = document.elementFromPoint(point.x, point.y);

    return {
      reachesSelf: hit !== null && (hit === element || element.contains(hit)),
      hit: describe(hit),
      point,
    };
  });
}

/**
 * Asserts that a tap at the centre of `locator` reaches it.
 *
 * @param locator - The element that must receive the tap
 * @param what - Name used in the failure message
 */
async function expectTappable(locator: Locator, what: string): Promise<void> {
  const result = await hitTestCentre(locator);
  expect(
    result.reachesSelf,
    `${what} does not receive a tap at its own centre ` +
      `(${result.point.x}, ${result.point.y}); ` +
      `document.elementFromPoint returned ${result.hit}`,
  ).toBe(true);
}

/**
 * Scrolls the document to its very bottom — the state in which the last row of
 * a list and the FAB compete for the same pixels — and waits until it is there.
 *
 * @param page - Playwright page object
 */
async function scrollToBottom(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
  });

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Math.ceil(window.scrollY + window.innerHeight) >=
          document.documentElement.scrollHeight,
      ),
    )
    .toBe(true);
}

// ============================================================================
// Seeding
// ============================================================================

/**
 * Writes rows straight into one object store of the app's IndexedDB.
 *
 * `support/seed.ts` covers trips, guests and transports; rooms and activities
 * are seeded here because these are the only tests that need them. Same rule as
 * the shared helpers: seed a trip's rows **before** anything makes that trip
 * current, or `YjsTripSync`'s projection can drop them.
 *
 * @param page - Playwright page object
 * @param store - Object store name
 * @param rows - Rows to add
 */
async function seedRows(
  page: Page,
  store: string,
  rows: readonly Record<string, unknown>[],
): Promise<void> {
  await page.evaluate(
    async ({
      store,
      rows,
    }: {
      store: string;
      rows: readonly Record<string, unknown>[];
    }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('kikouchou');
        request.onerror = () =>
          reject(new Error(`Failed to open the database for ${store}`));
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction(store, 'readwrite'),
            objectStore = tx.objectStore(store);
          for (const row of rows) {
            objectStore.add(row);
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(new Error(`Failed to write ${store}`));
          };
        };
      }),
    { store, rows },
  );
}

/**
 * Seeds one trip carrying a row in every list the app has.
 *
 * @param page - Playwright page object
 * @returns The trip's id
 */
async function seedFullTrip(page: Page): Promise<string> {
  const suffix = Math.random().toString(36).slice(2, 10),
    { tripId } = await seedTrip(page, {
      name: 'Bottom Edge Trip',
      location: 'Brittany',
      startDate: fixtureDate(1),
      endDate: fixtureDate(10),
    }),
    personId = await seedPerson(page, tripId, 'Last Guest');

  await seedTransport(page, {
    tripId,
    personId,
    type: 'arrival',
    datetime: `${fixtureDate(2)}T09:00:00.000Z`,
    location: 'Gare Montparnasse',
  });

  await seedRows(page, 'rooms', [
    {
      id: `seed-room-${suffix}`,
      tripId,
      name: 'Last Room',
      capacity: 2,
      order: 0,
      icon: 'bed-double',
    },
  ]);

  await seedRows(page, 'activities', [
    {
      id: `seed-activity-${suffix}`,
      tripId,
      title: 'Last Activity',
      category: 'other',
      startDatetime: `${fixtureDate(3)}T10:00:00.000Z`,
      allDay: false,
      participantIds: [],
    },
  ]);

  return tripId;
}

// ============================================================================
// Tests
// ============================================================================

test.describe('mobile bottom edge', () => {
  test('every bottom nav control takes a tap at its own centre', async ({ page }) => {
    const tripId = await seedFullTrip(page);

    // A trip-scoped route, so the trip-scoped nav links are enabled: a disabled
    // one carries `pointer-events-none` and would fail this hit test by design.
    await page.goto(`/trips/${tripId}/rooms?view=card`);
    await waitForRoute(page);

    const nav = page.getByRole('navigation', { name: MOBILE_NAV_LABEL });
    await expect(nav).toBeVisible();

    const links = await nav.getByRole('link').all();
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      await expectTappable(link, 'a bottom nav link');
    }
    await expectTappable(
      nav.getByRole('button', { name: MORE_BUTTON_LABEL }),
      'the "More" button',
    );
  });

  test('the install prompt does not cover the FAB', async ({ page }) => {
    await seedTrip(page, {
      name: 'Install Prompt Overlap',
      startDate: fixtureDate(1),
      endDate: fixtureDate(10),
    });

    await page.goto('/trips');
    await waitForRoute(page);

    // `useInstallPrompt` only listens; no browser fires `beforeinstallprompt`
    // under automation, so the test fires it.
    await fakeBeforeInstallPrompt(page);

    const prompt = page.getByRole('region', { name: INSTALL_REGION_LABEL });
    await expect(prompt).toBeVisible({ timeout: 15_000 });

    // The prompt has an Install button, a "Not now" and a close button, so it
    // cannot be waved through with `pointer-events-none` the way the offline
    // pill is — it has to be positioned clear. This is that assertion.
    await expectTappable(fabOf(page), 'the FAB, with the install prompt up');

    // …and the prompt's own buttons still work where it does sit.
    await expectTappable(
      prompt.getByRole('button', { name: /install/i }).first(),
      'the install button',
    );
  });

  test('<main> reserves more bottom padding than the FAB is tall', async ({ page }) => {
    await seedTrip(page, {
      name: 'Main Padding',
      startDate: fixtureDate(1),
      endDate: fixtureDate(10),
    });

    await page.goto('/trips');
    await waitForRoute(page);

    const fab = fabOf(page);
    await expect(fab).toBeVisible();

    const fabTopAboveViewportBottom = await fab.evaluate(
        (element) => window.innerHeight - element.getBoundingClientRect().top,
      ),
      mainPaddingBottom = await page
        .locator('main#main-content')
        .evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom));

    // 152px against the FAB's 136px. This is `pb-bottom-stack`, and it is the
    // single number that keeps a page's last row out from under the button —
    // `pb-20` covered the `h-16` nav bar and stopped 56px short of the FAB.
    expect(mainPaddingBottom).toBeGreaterThan(fabTopAboveViewportBottom);
  });
});

test.describe('the last row of every list page takes a tap', () => {
  const LIST_PAGES: readonly {
    readonly name: string;
    readonly path: (tripId: string) => string;
  }[] = [
    { name: 'trips', path: () => '/trips' },
    { name: 'rooms', path: (tripId) => `/trips/${tripId}/rooms?view=card` },
    { name: 'guests', path: (tripId) => `/trips/${tripId}/persons` },
    { name: 'transports', path: (tripId) => `/trips/${tripId}/transports` },
    { name: 'activities', path: (tripId) => `/trips/${tripId}/activities` },
  ];

  for (const listPage of LIST_PAGES) {
    test(`${listPage.name}: the last item is not under the FAB`, async ({ page }) => {
      const tripId = await seedFullTrip(page);

      await page.goto(listPage.path(tripId));
      await waitForRoute(page);

      const items = page.getByRole('listitem');
      await expect(items.first()).toBeVisible({ timeout: 15_000 });

      await scrollToBottom(page);

      await expectTappable(items.last(), `the last item on /${listPage.name}`);

      // The FAB is the thing that would be covering it, so assert it is still
      // reachable itself: a page that "fixed" the overlap by moving the button
      // under the nav bar would otherwise pass.
      const fab = fabOf(page);
      await expect(fab).toBeVisible();
      await expectTappable(fab, `the FAB on /${listPage.name}`);
    });
  }
});
