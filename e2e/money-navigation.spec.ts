/**
 * @fileoverview E2E cover for where the accounts sit in the navigation.
 *
 * The bottom bar holds four trip sections and a "More" sheet, and which four
 * is a product decision rather than a detail: a section in the sheet is two
 * taps away, and the accounts are opened as often as the beds. The bar is
 * derived from two arrays in `Layout`, so a section can be moved by editing
 * either one, and nothing in a unit test on the component says which four a
 * phone ends up with once the CSS has hidden the rest.
 *
 * The floating button is here for the same reason: the header button that adds
 * a line is hidden below `sm`, so on a phone the floating one is the only way
 * in, and it renders on one of the two views only.
 *
 * @module e2e/money-navigation
 */

import { expect, test } from '@playwright/test';

import { fixtureDate } from './support/fixture-dates';
import { waitForRoute } from './support/routes';
import { seedPerson, seedTrip } from './support/seed';

// ============================================================================
// Constants
// ============================================================================

/**
 * A phone, narrower than `md`, so the bottom bar renders.
 *
 * Both projects run this file, and the desktop one would otherwise assert a
 * bar that its own layout does not draw.
 */
test.use({ viewport: { width: 393, height: 852 } });

/** Both locales, as everywhere in this suite. */
const LABELS = {
  mobileNav: /mobile navigation|navigation mobile/i,
  more: /^(more|plus)$/i,
  money: /^(money|argent)$/i,
  transports: /^(transport|transports)$/i,
  newLine: /new line|nouvelle ligne/i,
  balancesView: /^(settle up|remboursements)$/i,
} as const;

// ============================================================================
// Tests
// ============================================================================

test.describe('the accounts in the navigation', () => {
  test('the bottom bar offers the accounts, and keeps transport in the sheet', async ({
    page,
  }) => {
    const { tripId } = await seedTrip(page, {
      name: 'Accounts trip',
      startDate: fixtureDate(1),
      endDate: fixtureDate(8),
    });
    await seedPerson(page, tripId, 'Alice', '#3b82f6');

    await page.goto(`/trips/${tripId}/calendar`);
    await waitForRoute(page);

    const nav = page.getByRole('navigation', { name: LABELS.mobileNav });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: LABELS.money })).toBeVisible();

    // The bar holds four trip sections and the sheet button, and no more: a
    // sixth makes the labels wrap on a small phone.
    await expect(nav.getByRole('link')).toHaveCount(4);

    // The sheet takes what the bar could not: transport moved into it when the
    // accounts took its slot. Its entries close the sheet before they navigate,
    // so they are buttons rather than links.
    await nav.getByRole('button', { name: LABELS.more }).click();
    const sheet = page.getByRole('navigation', {
      name: /more navigation|navigation plus/i,
    });
    await expect(sheet.getByRole('button', { name: LABELS.transports })).toBeVisible();
    await expect(sheet.getByRole('button', { name: LABELS.money })).toHaveCount(0);
  });

  test('the floating button adds a line, and only where a line can be added', async ({
    page,
  }) => {
    const { tripId } = await seedTrip(page, {
      name: 'Accounts trip',
      startDate: fixtureDate(1),
      endDate: fixtureDate(8),
    });
    await seedPerson(page, tripId, 'Alice', '#3b82f6');

    await page.goto(`/trips/${tripId}/money?view=balances`);
    await waitForRoute(page);

    // Nothing on the settle-up view takes a new line, so nothing offers one.
    await expect(page.getByRole('button', { name: LABELS.newLine })).toHaveCount(0);

    await page.getByRole('radio', { name: /^(expenses|dépenses)$/i }).click();
    await page.getByRole('button', { name: LABELS.newLine }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
