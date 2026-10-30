/**
 * @fileoverview E2E cover for the three places the accounts are read from
 * outside the money page: the currency label, the analytics figures and the
 * organiser's column.
 *
 * All three restate a number that is computed somewhere else, and that is
 * exactly the failure this spec exists for. The currency is stored on the trip
 * and handed to `Intl.NumberFormat` by four different components; the analytics
 * cards take their figures from `trip-stats`, which signs the three kinds of
 * line differently from the balances it also calls; and the glance panel is the
 * one card in that column that reads the database itself. A unit test on any
 * one of them passes while the page beside it prints a different answer.
 *
 * The lines are seeded rather than typed. Driving the form here would make
 * every assertion below depend on the form, which `money-expenses.spec.ts`
 * already covers.
 *
 * @module e2e/money-currency-and-stats
 */

import { expect, test, type Page } from '@playwright/test';

import { fixtureDate } from './support/fixture-dates';
import { waitForRoute } from './support/routes';
import { seedExpense, seedPerson, seedTrip } from './support/seed';

// ============================================================================
// Constants
// ============================================================================

/** Both locales, as everywhere in this suite. */
const LABELS = {
  moneyStands: /where the money stands|où en sont les comptes/i,
  openMoney: /open the money page|ouvrir la page des comptes/i,
  glanceEmpty: /nothing spent yet\.|rien de dépensé pour l'instant\./i,
  payments: /2 payments to make|2 remboursements à faire/i,
  mixedCurrencies: /different currencies|monnaies différentes|devises différentes/i,
} as const;

/** The guests, in the order the pages list them. */
const GUESTS = { alice: 'Alice', bob: 'Bob', cara: 'Cara' } as const;

/**
 * A window wide enough for the organiser's column, which starts at `xl`.
 *
 * Named here rather than inline because two describes need the same width and
 * a panel that is one pixel too narrow renders nothing at all.
 */
const WIDE_VIEWPORT = { width: 1440, height: 900 } as const;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Seeds a trip whose accounts hold one line of each kind.
 *
 * The three kinds are chosen so that every figure the pages print differs from
 * every other one. What the trip cost is 60, which is the 90 spent less the 30
 * that came back, and it is not the 110 the three lines add up to. What is
 * still owed is 20, and it is not the balance of any single line.
 *
 * @param page - Playwright page object
 * @param currency - ISO 4217 code for the trip
 * @returns The trip id
 */
async function seedTripWithAccounts(page: Page, currency: string): Promise<string> {
  const { tripId } = await seedTrip(page, {
    name: 'Accounts trip',
    startDate: fixtureDate(1),
    endDate: fixtureDate(8),
    currency,
  });

  const alice = await seedPerson(page, tripId, GUESTS.alice, '#3b82f6');
  const bob = await seedPerson(page, tripId, GUESTS.bob, '#ef4444');
  const cara = await seedPerson(page, tripId, GUESTS.cara, '#22c55e');
  const everyone = [alice, bob, cara].map((personId) => ({ personId, value: 1 }));

  // Alice paid 90 for the three of them.
  await seedExpense(page, {
    tripId,
    date: fixtureDate(2),
    title: 'Shopping',
    amount: 90,
    payerId: alice,
    category: 'groceries',
    splits: everyone,
  });

  // The deposit came back to Alice, and it belongs to the three of them.
  await seedExpense(page, {
    tripId,
    date: fixtureDate(3),
    title: 'Deposit back',
    amount: 30,
    payerId: alice,
    kind: 'income',
    splits: everyone,
  });

  // Bob has since paid Alice back, which is the group's own money moving.
  await seedExpense(page, {
    tripId,
    date: fixtureDate(4),
    title: 'Bob pays Alice back',
    amount: 20,
    payerId: bob,
    kind: 'transfer',
    splits: [{ personId: alice, value: 20 }],
  });

  return tripId;
}

/**
 * Reads one analytics stat card by its test id.
 *
 * @param page - Playwright page object
 * @param testId - The card's test id
 * @returns The locator holding the figure
 */
function stat(page: Page, testId: string) {
  return page.getByTestId(testId);
}

// ============================================================================
// Tests: the currency
// ============================================================================

test.describe('the trip currency', () => {
  test('labels every figure on the money page with the trip’s own code', async ({
    page,
  }) => {
    const tripId = await seedTripWithAccounts(page, 'USD');

    await page.goto(`/trips/${tripId}/money`);
    await waitForRoute(page);

    // The dollar rather than the default euro, and on the balances too.
    await expect(page.getByRole('button').filter({ hasText: 'Shopping' })).toContainText(
      /\$\s?90[.,]00|90[.,]00\s?\$/,
    );

    await page.getByRole('radio', { name: /^(settle up|remboursements)$/i }).click();
    await expect(page.getByRole('table')).toContainText(/\$|USD/);
    await expect(page.getByRole('table')).not.toContainText('€');
  });

  test('a trip written before the field existed reads as the default', async ({
    page,
  }) => {
    const { tripId } = await seedTrip(page, {
      name: 'Older trip',
      startDate: fixtureDate(1),
      endDate: fixtureDate(8),
    });
    const alice = await seedPerson(page, tripId, GUESTS.alice, '#3b82f6');
    await seedExpense(page, {
      tripId,
      date: fixtureDate(2),
      title: 'Shopping',
      amount: 90,
      payerId: alice,
      splits: [{ personId: alice, value: 1 }],
    });

    await page.goto(`/trips/${tripId}/money`);
    await waitForRoute(page);

    await expect(page.getByRole('button').filter({ hasText: 'Shopping' })).toContainText(
      /€\s?90[.,]00|90[.,]00\s?€/,
    );
  });
});

// ============================================================================
// Tests: the analytics figures
// ============================================================================

test.describe('the money figures on the analytics page', () => {
  test('the total is what the trip cost, not what the lines add up to', async ({
    page,
  }) => {
    const tripId = await seedTripWithAccounts(page, 'USD');

    await page.goto(`/trips/${tripId}/analytics`);
    await waitForRoute(page);

    // 90 spent less the 30 that came back. The transfer of 20 is the group
    // moving its own money, so it is not spending.
    await expect(stat(page, 'stat-spend')).toHaveText(/\$\s?60[.,]00|60[.,]00\s?\$/);
    await expect(stat(page, 'stat-spend-per-person')).toHaveText(
      /\$\s?20[.,]00|20[.,]00\s?\$/,
    );

    // Alice is up 20 once Bob has paid her back, and Cara still owes 20.
    await expect(stat(page, 'stat-unsettled')).toHaveText(
      /\$\s?20[.,]00|20[.,]00\s?\$/,
    );
  });

  test('a trip with no line reads zero rather than nothing', async ({ page }) => {
    const { tripId } = await seedTrip(page, {
      name: 'Quiet trip',
      startDate: fixtureDate(1),
      endDate: fixtureDate(8),
      currency: 'USD',
    });
    await seedPerson(page, tripId, GUESTS.alice, '#3b82f6');

    await page.goto(`/trips/${tripId}/analytics`);
    await waitForRoute(page);

    await expect(stat(page, 'stat-spend')).toHaveText(/0[.,]00/);
    await expect(stat(page, 'stat-unsettled')).toHaveText(/0[.,]00/);
  });

  test('two trips in two currencies are totalled without claiming one', async ({
    page,
  }) => {
    await seedTripWithAccounts(page, 'USD');

    const { tripId: swissTripId } = await seedTrip(page, {
      name: 'Swiss trip',
      startDate: fixtureDate(10),
      endDate: fixtureDate(12),
      currency: 'CHF',
    });
    const guest = await seedPerson(page, swissTripId, GUESTS.alice, '#3b82f6');
    await seedExpense(page, {
      tripId: swissTripId,
      date: fixtureDate(10),
      title: 'Fondue',
      amount: 40,
      payerId: guest,
      splits: [{ personId: guest, value: 1 }],
    });

    await page.goto('/analytics');
    await waitForRoute(page);

    // The reader asked for a total, so they get one — with no symbol over it,
    // and a line saying why.
    const spend = stat(page, 'stat-total-spend');
    await expect(spend).toHaveText(/100[.,]00/);
    await expect(spend).not.toHaveText(/[€$]/);
    await expect(page.getByText(LABELS.mixedCurrencies).first()).toBeVisible();
  });
});

// ============================================================================
// Tests: the organiser's column
// ============================================================================

test.describe('the money card in the organiser’s column', () => {
  test.use({ viewport: WIDE_VIEWPORT });

  test('names the guests who are not level, and the payments left', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'Mobile Chrome',
      'the column is a desktop layout, and a phone project keeps its touch emulation',
    );

    const { tripId } = await seedTrip(page, {
      name: 'Accounts trip',
      startDate: fixtureDate(1),
      endDate: fixtureDate(8),
      currency: 'USD',
    });
    const alice = await seedPerson(page, tripId, GUESTS.alice, '#3b82f6');
    const bob = await seedPerson(page, tripId, GUESTS.bob, '#ef4444');
    const cara = await seedPerson(page, tripId, GUESTS.cara, '#22c55e');

    await seedExpense(page, {
      tripId,
      date: fixtureDate(2),
      title: 'Shopping',
      amount: 90,
      payerId: alice,
      category: 'groceries',
      splits: [alice, bob, cara].map((personId) => ({ personId, value: 1 })),
    });

    // The calendar, because the column is the point rather than the page.
    await page.goto(`/trips/${tripId}/calendar`);
    await waitForRoute(page);

    const card = page.getByRole('list', { name: LABELS.moneyStands });
    await expect(card).toBeVisible();
    await expect(card).toContainText(GUESTS.bob);
    await expect(card).toContainText(/30[.,]00/);
    await expect(page.getByText(LABELS.payments)).toBeVisible();
  });

  test('says nothing was spent rather than that nobody owes anything', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'Mobile Chrome',
      'the column is a desktop layout, and a phone project keeps its touch emulation',
    );

    const { tripId } = await seedTrip(page, {
      name: 'Quiet trip',
      startDate: fixtureDate(1),
      endDate: fixtureDate(8),
    });
    await seedPerson(page, tripId, GUESTS.alice, '#3b82f6');

    await page.goto(`/trips/${tripId}/calendar`);
    await waitForRoute(page);

    await expect(page.getByText(LABELS.glanceEmpty)).toBeVisible();
  });

  test('is left off the pages that spend the whole width themselves', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'Mobile Chrome',
      'the column is a desktop layout, and a phone project keeps its touch emulation',
    );

    const { tripId } = await seedTrip(page, {
      name: 'Accounts trip',
      startDate: fixtureDate(1),
      endDate: fixtureDate(8),
    });
    await seedPerson(page, tripId, GUESTS.alice, '#3b82f6');

    // The transport list joined this group with the navigation change: it
    // holds a card grid that takes the width the column would have used.
    await page.goto(`/trips/${tripId}/transports`);
    await waitForRoute(page);
    await expect(page.getByRole('link', { name: LABELS.openMoney })).toHaveCount(0);

    await page.goto(`/trips/${tripId}/analytics`);
    await waitForRoute(page);
    await expect(page.getByRole('link', { name: LABELS.openMoney })).toHaveCount(0);

    // And it is on the money page itself, which is the same width as before.
    await page.goto(`/trips/${tripId}/money`);
    await waitForRoute(page);
    await expect(page.getByRole('link', { name: LABELS.openMoney })).toBeVisible();
  });
});
