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
});
