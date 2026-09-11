/**
 * @fileoverview Every modal is centred on a phone-width screen.
 *
 * The bug this pins: `dialogContentClassName` paired `inset-x-4` with
 * `w-full`, and a percentage width on a fixed element resolves against the
 * viewport rather than against the box the insets leave behind. `left: 1rem`,
 * `right: 1rem` and `width: 100vw` over-constrain the box, so the browser kept
 * `left`, dropped `right`, and pinned `margin-left` to 0 because the equal
 * margins `mx-auto` asked for would have been negative. Below ~544px of
 * viewport every dialog therefore sat 16px from the left edge and hung 16px off
 * the right one — a gutter on one side only.
 *
 * It is measured here rather than asserted as a class string because only a
 * browser resolves that over-constraint: the classes looked deliberate, and the
 * unit test alongside them can only say the spelling has not come back. The
 * check is the pair of gutters, left against right, the way
 * `mobile-bottom-edge.spec.ts` hit-tests a point rather than reading a
 * screenshot.
 *
 * @module e2e/dialog-narrow-gutters
 */

import { expect, test, type Locator, type Page } from '@playwright/test';

import { fixtureDate } from './support/fixture-dates';
import { waitForRoute } from './support/routes';
import { seedPerson, seedTrip } from './support/seed';

// ============================================================================
// Constants
// ============================================================================

/** Both locales, because the suite runs against whichever the browser asks for. */
const LABELS = {
  newLine: /new line|nouvelle ligne/i,
  title: /^(title|intitulé)\s*\*?$/i,
} as const;

/**
 * The widths a phone actually is, up to the last one below the breakpoint at
 * which the old geometry started centring itself again.
 *
 * 320 is an iPhone SE in portrait, 375 the iPhone mini/X family, 414 the Plus
 * and Max family, and 527 is the top end of the broken range — the dialog is
 * 512px wide there at the most, so the box still fits and the gutters still
 * have to match.
 */
const PHONE_WIDTHS = [320, 375, 414, 527] as const;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Seeds a trip with one guest and opens its money page.
 *
 * Rows go in before anything makes the trip current, for the reason
 * `seedPerson` documents.
 *
 * @param page - Playwright page object
 */
async function openMoneyPage(page: Page): Promise<void> {
  const { tripId } = await seedTrip(page, {
    name: 'Gutter trip',
    startDate: fixtureDate(1),
    endDate: fixtureDate(8),
  });
  await seedPerson(page, tripId, 'Alice', '#3b82f6');

  await page.goto(`/trips/${tripId}/money?view=expenses`);
  await waitForRoute(page);
}

/**
 * Asserts a modal is horizontally centred, and inside the viewport.
 *
 * Equal gutters or none: a box exactly as wide as the screen is centred too.
 * One pixel of slack, because a fractional viewport width splits into two
 * gutters that differ in the last decimal.
 *
 * @param page - Playwright page object
 * @param modal - The dialog or alert dialog box
 * @param what - Name for the failure message
 */
async function expectCentred(
  page: Page,
  modal: Locator,
  what: string,
): Promise<void> {
  const box = await modal.boundingBox();
  expect(box, `${what} has no box`).not.toBeNull();
  if (box === null) {
    return;
  }

  const viewport = page.viewportSize();
  expect(viewport, 'no viewport').not.toBeNull();
  if (viewport === null) {
    return;
  }

  const left = box.x;
  const right = viewport.width - (box.x + box.width);

  expect(
    Math.abs(left - right),
    `${what} at ${viewport.width}px: ${left}px of gutter on the left, ${right}px on the right`,
  ).toBeLessThanOrEqual(1);
  // A negative gutter is the other half of the same bug: the box hung off the
  // right edge, which is what made the left one look like padding.
  expect(left, `${what} at ${viewport.width}px starts off-screen`).toBeGreaterThanOrEqual(0);
  expect(right, `${what} at ${viewport.width}px runs off-screen`).toBeGreaterThanOrEqual(-1);
}

// ============================================================================
// Tests
// ============================================================================

test.describe('a modal on a narrow screen', () => {
  for (const width of PHONE_WIDTHS) {
    test(`centres the new-line dialog at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await openMoneyPage(page);

      await page.getByRole('button', { name: LABELS.newLine }).first().click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expectCentred(page, dialog, 'the new-line dialog');
    });
  }

  test('centres an alert dialog too, which is dressed from the same classes', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await openMoneyPage(page);

    await page.getByRole('button', { name: LABELS.newLine }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // A half-typed line, so closing it raises the unsaved-changes alert.
    await dialog.getByRole('textbox', { name: LABELS.title }).fill('Half typed');
    await page.keyboard.press('Escape');

    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toBeVisible();
    await expectCentred(page, confirm, 'the unsaved-changes alert');
  });
});
