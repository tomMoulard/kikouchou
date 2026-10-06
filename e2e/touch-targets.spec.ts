/**
 * @fileoverview E2E checks on the size of the things you tap.
 *
 * These assertions read `boundingBox()` — the box the browser actually laid
 * out — rather than the class list. A Tailwind class that never made it into
 * the generated stylesheet, or one cancelled by `tailwind-merge` at the call
 * site, still shows up in `class`; only the measured box tells you whether the
 * button is big enough to hit.
 *
 * Both directions are asserted. The mobile floor is the fix; the desktop
 * ceiling is the regression guard, because the floor is expressed as a
 * `max-md:` utility and a mistake there would silently inflate every icon
 * button and menu row on desktop too.
 *
 * @module e2e/touch-targets
 */

import { test, expect, type Locator, type Page } from '@playwright/test';

import { seedPerson, seedTransport, seedTrip } from './support/seed';
import { waitForRoute } from './support/routes';
import { clearIndexedDB } from './support/storage';

// ============================================================================
// Constants
// ============================================================================

/**
 * The minimum touch target this app commits to, in CSS pixels.
 *
 * 44 is the number the codebase already reached for by hand (`size-11`) before
 * the rule was moved into the button and menu primitives. It is the Apple HIG
 * figure and WCAG 2.5.5 (AAA); WCAG 2.5.8 (AA) only asks for 24.
 */
const MIN_TOUCH_TARGET_PX = 44;

/**
 * Sub-pixel slack on the floor above.
 *
 * A device-pixel-ratio viewport can report 43.99 for a box the stylesheet puts
 * at exactly 44. Half a pixel absorbs that without coming anywhere near letting
 * a 32px row through.
 */
const SUBPIXEL_SLACK_PX = 0.5;

/** What a target must actually measure to count as passing. */
const MEASURED_FLOOR_PX = MIN_TOUCH_TARGET_PX - SUBPIXEL_SLACK_PX;

/** Pixel-ish portrait phone. */
const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

/** Ordinary laptop, comfortably past the `md` breakpoint at 768px. */
const DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;

/**
 * Comfortably in the future: the transport list files anything already past
 * into a collapsed "Past transports" group, where its card — and so the menu
 * button being measured — is not rendered at all.
 */
const TRIP = {
  name: 'Touch Target Trip',
  location: 'Somewhere',
  startDate: '2099-05-01',
  endDate: '2099-05-08',
} as const;

const GUEST_NAME = 'Tap Target Guest';

// ============================================================================
// Helpers
// ============================================================================

/**
 * The rendered size of one element.
 */
interface Box {
  readonly width: number;
  readonly height: number;
}

/**
 * Waits for every running CSS animation and transition on the page to finish.
 *
 * Radix opens a menu with `data-[state=open]:zoom-in-95`, so a box read the
 * moment a row becomes visible measures a mid-flight, *scaled* box — 44 x 0.95
 * is 41.8. That cuts both ways, and the second way is worse: a desktop
 * regression guard asserting `toBeLessThan(44)` would pass on a 44px row caught
 * mid-zoom and report green while the bug was present.
 *
 * `getAnimations()` covers CSS animations and transitions alike, and settles
 * rejected ones too, since a cancelled animation rejects `finished`.
 */
async function waitForAnimations(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
}

/**
 * Measures a locator's rendered box once it has genuinely stopped moving.
 *
 * Three hazards, all hit while writing this.
 *
 * `boundingBox()` returns `null` for anything not rendered, and `null?.height`
 * would quietly compare `undefined` and assert nothing — the
 * assertion-that-cannot-fail this suite has been bitten by before.
 *
 * The open animation above, which `waitForAnimations` handles.
 *
 * And the stability poll itself: Playwright's `expect.poll` runs its callback
 * immediately and only sleeps *after* a failed attempt, so "two consecutive
 * reads" taken back to back land inside a single frame and prove nothing. Each
 * comparison here is separated by two real animation frames.
 *
 * Width and height are both settled, because callers assert both.
 */
async function boxOf(page: Page, locator: Locator): Promise<Box> {
  await expect(locator).toBeVisible();
  await waitForAnimations(page);

  /** Hundredths of a pixel as integers, so two reads compare exactly. */
  const read = async (): Promise<{ w: number; h: number } | null> => {
    const box = await locator.boundingBox();
    return box === null
      ? null
      : { w: Math.round(box.width * 100), h: Math.round(box.height * 100) };
  };

  const nextFrame = async (): Promise<void> => {
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => { resolve(); }));
        }),
    );
  };

  let settled: { w: number; h: number } | null = null;
  await expect
    .poll(
      async () => {
        const first = await read();
        await nextFrame();
        const second = await read();
        if (
          first === null ||
          second === null ||
          first.w !== second.w ||
          first.h !== second.h
        ) {
          settled = null;
          return false;
        }
        settled = second;
        return true;
      },
      { message: 'element never stopped resizing', timeout: 10_000 },
    )
    .toBe(true);

  const box: { w: number; h: number } | null = settled;
  expect(box, 'element has no layout box').not.toBeNull();
  return { width: box!.w / 100, height: box!.h / 100 };
}

/**
 * Seeds a trip with one guest and their arrival, and lands on the transport
 * list.
 *
 * That card carries the overflow menu which is the edit/delete affordance on
 * nearly every card in this app, so it is the honest place to measure both the
 * trigger and the rows it opens.
 */
async function gotoTransportList(page: Page): Promise<string> {
  await clearIndexedDB(page);
  const { tripId } = await seedTrip(page, TRIP);
  const personId = await seedPerson(page, tripId, GUEST_NAME);
  await seedTransport(page, {
    tripId,
    personId,
    type: 'arrival',
    datetime: `${TRIP.startDate}T14:00:00.000Z`,
    location: 'Tap Target Station',
  });

  await page.goto(`/trips/${tripId}/transports`);
  await waitForRoute(page);
  await expect(page.getByText(GUEST_NAME).first()).toBeVisible();

  return tripId;
}

/**
 * The overflow-menu trigger on a card.
 *
 * Matched on `data-size`, which `Button` stamps from its variant, rather than
 * on the localised `aria-label`: this suite runs with whatever locale the
 * browser reports, and the point of the test is geometry, not copy. Not on
 * `data-slot` either — Radix's `asChild` trigger spreads its own `data-slot`
 * over the button's.
 */
function cardMenuTrigger(page: Page): Locator {
  return page.locator('button[data-size="icon"][aria-haspopup="menu"]').first();
}

/**
 * Opens the language select on `/settings` and returns its option rows.
 *
 * The cheapest honest surface for `SelectItem`: no seeding, one navigation,
 * and a call site that passes no `className` at all — which is every one of
 * the sixteen `SelectItem` call sites in the app.
 *
 * Located by `data-slot`, not by the trigger's `aria-label`: the label is
 * translated and this suite runs in whatever locale the browser reports.
 */
async function settingsLanguageOptions(page: Page): Promise<Locator> {
  await clearIndexedDB(page);
  await page.goto('/settings');
  await waitForRoute(page);

  const trigger = page.locator('[data-slot="select-trigger"]').first();
  await expect(trigger).toBeVisible();
  await trigger.click();

  const options = page.getByRole('option');
  await expect(options.first()).toBeVisible();

  return options;
}

/**
 * Opens the transport edit dialog on the seeded card and returns the option
 * rows of its guest select.
 *
 * `TransportForm` is where six of the sixteen `SelectItem` call sites live,
 * and unlike `/settings` its select opens inside a dialog — a portal within a
 * portal. Worth measuring separately: a floor that the dialog's own layout
 * cancelled would still pass on the settings page.
 */
async function transportFormGuestOptions(page: Page): Promise<Locator> {
  await gotoTransportList(page);

  await cardMenuTrigger(page).click();
  // The first row of that menu is Edit; matched by position rather than by its
  // translated label, for the same reason as the trigger above.
  await page.getByRole('menuitem').first().click();

  // The id `TransportForm` puts on the guest select's trigger. Stable, unique
  // in the dialog, and not a string a translator can change.
  const trigger = page.locator('#transport-person');
  await expect(trigger).toBeVisible();
  await trigger.click();

  const options = page.getByRole('option');
  await expect(options.first()).toBeVisible();

  return options;
}

/**
 * Asserts every one of a set of rows clears the touch floor.
 *
 * @param page - Playwright page object
 * @param rows - The rows to measure
 * @param label - What the rows are, for the failure message
 */
async function expectEveryRowClearsTheFloor(
  page: Page,
  rows: Locator,
  label: string,
): Promise<void> {
  const count = await rows.count();
  // Without this a locator that matched nothing would loop zero times and the
  // test would pass having measured nothing at all.
  expect(count, `no ${label} rendered`).toBeGreaterThan(0);

  for (let index = 0; index < count; index += 1) {
    const box = await boxOf(page, rows.nth(index));
    expect(
      box.height,
      `${label} ${index} is ${box.height}px tall`,
    ).toBeGreaterThanOrEqual(MEASURED_FLOOR_PX);
  }
}

// ============================================================================
// Tests
// ============================================================================

test.describe('Touch targets on mobile', () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test('the card overflow menu button is at least 44px square', async ({ page }) => {
    await gotoTransportList(page);

    const box = await boxOf(page, cardMenuTrigger(page));

    expect(box.width, `trigger is ${box.width}px wide`).toBeGreaterThanOrEqual(
      MEASURED_FLOOR_PX,
    );
    expect(box.height, `trigger is ${box.height}px tall`).toBeGreaterThanOrEqual(
      MEASURED_FLOOR_PX,
    );
  });

  test('every row of that menu is at least 44px tall', async ({ page }) => {
    await gotoTransportList(page);

    await cardMenuTrigger(page).click();

    const items = page.getByRole('menuitem');
    await expect(items.first()).toBeVisible();

    const count = await items.count();
    expect(count).toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const box = await boxOf(page, items.nth(index));
      expect(
        box.height,
        `menu row ${index} is ${box.height}px tall`,
      ).toBeGreaterThanOrEqual(MEASURED_FLOOR_PX);
    }
  });

  test('the calendar month arrows are at least 44px square', async ({ page }) => {
    await clearIndexedDB(page);
    const { tripId } = await seedTrip(page, TRIP);

    await page.goto(`/trips/${tripId}/calendar?view=card`);
    await waitForRoute(page);

    // The month arrows are the outline icon buttons on this page. Both used to
    // carry an ad-hoc `size-11 md:size-8`, which the button variant now
    // supplies for every icon button instead of these two.
    const arrows = page.locator(
      '[data-slot="button"][data-size="icon"][data-variant="outline"]',
    );
    await expect(arrows.first()).toBeVisible();

    const count = await arrows.count();
    expect(count).toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const box = await boxOf(page, arrows.nth(index));
      expect(box.width, `arrow ${index} is ${box.width}px wide`).toBeGreaterThanOrEqual(
        MEASURED_FLOOR_PX,
      );
      expect(box.height, `arrow ${index} is ${box.height}px tall`).toBeGreaterThanOrEqual(
        MEASURED_FLOOR_PX,
      );
    }
  });

  test("the date picker's month arrows are at least 44px square", async ({ page }) => {
    await clearIndexedDB(page);
    await page.goto('/trips/new');
    await waitForRoute(page);

    // The name field is autofocused, and blurring it while empty inserts a
    // "required" message that pushes the date buttons down between pointerdown
    // and pointerup. Filling it first keeps this test about arrow geometry.
    await page.locator('#trip-name').fill('Touch Target Trip');
    await page.locator('#trip-start-date').click();

    // A different set of arrows from the ones above: these come from
    // react-day-picker, not from `Button`, so they carry no `data-size` to
    // match on. `rdp-nav` is the library's own class name — stable, and unlike
    // the buttons' `aria-label` not something a translation can change.
    const arrows = page.locator('[data-slot="popover-content"] .rdp-nav button');
    await expect(arrows.first()).toBeVisible();

    // They matter more than most: with a start date a few months out, every
    // day the end picker opens on is disabled, and these arrows are the only
    // control on the popover that does anything at all.
    const count = await arrows.count();
    expect(count, 'no month arrows rendered').toBe(2);

    for (let index = 0; index < count; index += 1) {
      const box = await boxOf(page, arrows.nth(index));
      expect(box.width, `arrow ${index} is ${box.width}px wide`).toBeGreaterThanOrEqual(
        MEASURED_FLOOR_PX,
      );
      expect(box.height, `arrow ${index} is ${box.height}px tall`).toBeGreaterThanOrEqual(
        MEASURED_FLOOR_PX,
      );
    }
  });

  test('every option of a select is at least 44px tall', async ({ page }) => {
    // Stock shadcn's `SelectItem` is `py-1.5 text-sm` and nothing else — 6 +
    // 20 + 6 = 32px — and not one of the sixteen call sites in this app
    // overrides it, so before the floor moved into the primitive every picker
    // in the app was a 32px row. This is the plainest of them.
    await expectEveryRowClearsTheFloor(
      page,
      await settingsLanguageOptions(page),
      'language option',
    );
  });

  test('a select inside a dialog is at least 44px per option too', async ({ page }) => {
    await expectEveryRowClearsTheFloor(
      page,
      await transportFormGuestOptions(page),
      'guest option',
    );
  });
});

test.describe('Desktop density is unchanged', () => {
  test.use({ viewport: DESKTOP_VIEWPORT });

  test('icon buttons and menu rows stay compact past the md breakpoint', async ({ page }) => {
    await gotoTransportList(page);

    const trigger = cardMenuTrigger(page);
    const triggerBox = await boxOf(page, trigger);
    expect(
      triggerBox.height,
      'the mobile floor leaked past `md` and inflated desktop',
    ).toBeLessThan(MIN_TOUCH_TARGET_PX);

    await trigger.click();

    const itemBox = await boxOf(page, page.getByRole('menuitem').first());
    expect(
      itemBox.height,
      'the mobile floor leaked past `md` and inflated the menu',
    ).toBeLessThan(MIN_TOUCH_TARGET_PX);
  });

  test('select options stay compact past the md breakpoint', async ({ page }) => {
    const options = await settingsLanguageOptions(page);

    const count = await options.count();
    expect(count, 'no language options rendered').toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const box = await boxOf(page, options.nth(index));
      // The whole reason the floor is written `max-md:` rather than
      // `min-h-11 md:min-h-0`. Written the obvious way, an unprefixed class at
      // a call site would cancel the base and leave the `md:` half applying on
      // its own, and every select in the app would grow a third taller on
      // desktop. This assertion is what would catch that.
      expect(
        box.height,
        `option ${index} is ${box.height}px tall — the mobile floor leaked past \`md\``,
      ).toBeLessThan(MIN_TOUCH_TARGET_PX);
    }
  });

  test('the date picker stays compact past the md breakpoint', async ({ page }) => {
    await clearIndexedDB(page);
    await page.goto('/trips/new');
    await waitForRoute(page);

    await page.locator('#trip-name').fill('Touch Target Trip');
    await page.locator('#trip-start-date').click();

    // The mobile floor here is a `max-md:` override of `--cell-size`, which
    // drives the caption height, the arrows and the day columns all at once.
    // Written without the `max-` it would widen the popover on every desktop.
    const arrowBox = await boxOf(
      page,
      page.locator('[data-slot="popover-content"] .rdp-nav button').first(),
    );
    expect(
      arrowBox.height,
      'the mobile cell size leaked past `md` and inflated the date picker',
    ).toBeLessThan(MIN_TOUCH_TARGET_PX);
  });
});
