/**
 * @fileoverview E2E cover for the trip accounts: the form, the list and the
 * balances the two of them add up to.
 *
 * The arithmetic already has unit tests, and they are the right place for it:
 * `balances.test.ts` divides a hundred by three faster than any browser can.
 * What they cannot see is the sentence the feature actually promises — "type
 * what the group paid, and the app says who pays whom" — because every step of
 * it lives somewhere else. The form holds the split rule and the beneficiaries,
 * `createExpense` writes the row, a live query reads it back through
 * `loadTripMoney`, `computeBalances` turns the rows into balances, and
 * `settleBalances` turns those into payments. Only a browser runs all five over
 * real rows in IndexedDB.
 *
 * The one claim that is easy to break by accident is the round trip in the
 * middle: recording a suggested payment writes an ordinary transfer, and that
 * transfer has to cancel exactly the debt it was made against. A unit test on
 * either half passes while the two disagree.
 *
 * @module e2e/money-expenses
 */

import { expect, test, type Page } from '@playwright/test';

import { fixtureDate } from './support/fixture-dates';
import { waitForRoute } from './support/routes';
import { seedPerson, seedTrip } from './support/seed';

// ============================================================================
// Constants
// ============================================================================

/**
 * Both locales, because the suite runs against whichever the browser asks for.
 *
 * Guest names are seeded here and so are locale-independent; only the app's own
 * words need the alternation.
 */
const LABELS = {
  newLine: /new line|nouvelle ligne/i,
  title: /^(title|intitulé)\s*\*?$/i,
  amount: /^(amount|montant)\s*\*?$/i,
  paidBy: /paid by|payé par/i,
  kind: /kind of line|type de ligne/i,
  splitMode: /^(split|partage)\s*$/i,
  transferFrom: /^(from|de)\s*\*?$/i,
  transferTo: /^(to|à)\s*\*?$/i,
  save: /^(save|enregistrer)$/i,
  delete: /^(delete|supprimer)$/i,
  deleteLine: /delete this line|supprimer cette ligne/i,
  expensesView: /^(expenses|dépenses)$/i,
  balancesView: /^(settle up|remboursements)$/i,
  recordPayment: /^(record it|enregistrer)$/i,
  empty: /nothing spent yet|rien de dépensé/i,
  settled: /everybody is level|tout le monde est à jour/i,
  settleSection: /payments to make|remboursements à faire/i,
  amountsDoNotAddUp: /must add up to the total|doivent faire le total/i,
  recipientIsPayer: /other than the payer|autre que le payeur/i,
  discard: /^(discard|abandonner)$/i,
} as const;

/** The guests, in the order the money page lists them. */
const GUESTS = { alice: 'Alice', bob: 'Bob', cara: 'Cara' } as const;

// ============================================================================
// Helpers
// ============================================================================

/**
 * A money figure, in either locale.
 *
 * `Intl.NumberFormat` puts the symbol in front in English and behind it in
 * French, and it uses a comma for the decimal separator in French. Both are
 * the same figure, and a spec that named one of them would pass or fail by
 * which language the runner's browser asks for.
 *
 * Fixtures stay under a thousand: a French group separator is a narrow no-break
 * space, which is not the character anybody types into a regular expression.
 *
 * @param amount - The figure, as the page computes it
 * @returns A pattern matching the figure in both locales
 */
function money(amount: number): RegExp {
  const [whole = '0', cents = '00'] = amount.toFixed(2).split('.');
  const escaped = whole.replace('-', '-?');
  return new RegExp(`(?:[€$]\\s?)?${escaped}[.,]${cents}(?:\\s?[€$])?`);
}

/**
 * Seeds a trip with three guests and opens its money page.
 *
 * Every row is written **before** anything makes the trip current, for the
 * reason `seedPerson` documents: `YjsTripSync` projects its document back over
 * Dexie, so a raw write made after that races the projection.
 *
 * @param page - Playwright page object
 * @param currency - ISO 4217 code for the trip, when the spec asserts one
 * @returns The trip id and the guests' ids
 */
async function seedMoneyTrip(
  page: Page,
  currency?: string,
): Promise<{
  readonly tripId: string;
  readonly personIds: Record<keyof typeof GUESTS, string>;
}> {
  const { tripId } = await seedTrip(page, {
    name: 'Accounts trip',
    startDate: fixtureDate(1),
    endDate: fixtureDate(8),
    ...(currency === undefined ? {} : { currency }),
  });

  const alice = await seedPerson(page, tripId, GUESTS.alice, '#3b82f6');
  const bob = await seedPerson(page, tripId, GUESTS.bob, '#ef4444');
  const cara = await seedPerson(page, tripId, GUESTS.cara, '#22c55e');

  return { tripId, personIds: { alice, bob, cara } };
}

/**
 * Opens one of the money page's two views.
 *
 * @param page - Playwright page object
 * @param tripId - The trip to open
 * @param view - The view to land on, as the query parameter names it
 */
async function openMoneyPage(
  page: Page,
  tripId: string,
  view: 'expenses' | 'balances' = 'expenses',
): Promise<void> {
  await page.goto(`/trips/${tripId}/money?view=${view}`);
  await waitForRoute(page);
}

/**
 * Picks a value in one of the form's dropdowns.
 *
 * The options are rendered in a portal at the end of the document, so they are
 * looked up on the page rather than inside the dialog.
 *
 * @param page - Playwright page object
 * @param field - Accessible name of the dropdown
 * @param option - Accessible name of the option to pick
 */
async function chooseOption(
  page: Page,
  field: RegExp,
  option: string | RegExp,
): Promise<void> {
  await page.getByRole('dialog').getByRole('combobox', { name: field }).click();
  await page.getByRole('option', { name: option }).click();
}

/**
 * Opens the new-line dialog.
 *
 * Two controls carry the same name on an empty page — the header button and
 * the one in the empty state — and on a phone the floating button replaces the
 * header one. Any of them opens the same dialog.
 *
 * @param page - Playwright page object
 * @returns The dialog, ready to be filled in
 */
async function openNewLineDialog(page: Page) {
  await page.getByRole('button', { name: LABELS.newLine }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * Types a plain expense and saves it.
 *
 * The defaults do the rest: a new line is split equally between everybody, on
 * today's day when the trip is running and on its first day otherwise.
 *
 * @param page - Playwright page object
 * @param line - What was paid, how much, and by whom
 */
async function addExpense(
  page: Page,
  line: { readonly title: string; readonly amount: string; readonly payer: string },
): Promise<void> {
  const dialog = await openNewLineDialog(page);

  await dialog.getByRole('textbox', { name: LABELS.title }).fill(line.title);
  await dialog.getByRole('spinbutton', { name: LABELS.amount }).fill(line.amount);
  await chooseOption(page, LABELS.paidBy, line.payer);

  await dialog.getByRole('button', { name: LABELS.save }).click();
  await expect(dialog).toBeHidden();
}

/**
 * One row of the balances table, by the guest it belongs to.
 *
 * @param page - Playwright page object
 * @param name - The guest's name
 * @returns The row locator
 */
function balanceRow(page: Page, name: string) {
  return page.getByRole('row').filter({ hasText: name });
}

// ============================================================================
// Tests
// ============================================================================

test.describe('the trip accounts', () => {
  test('a line typed into the form lands in the list and moves every balance', async ({
    page,
  }) => {
    const { tripId } = await seedMoneyTrip(page);
    await openMoneyPage(page, tripId);

    await expect(page.getByRole('heading', { name: LABELS.empty })).toBeVisible();

    await addExpense(page, { title: 'Shopping', amount: '90', payer: GUESTS.alice });

    // The list: the line as the group will read it back.
    const card = page.getByRole('button').filter({ hasText: 'Shopping' });
    await expect(card).toBeVisible();
    await expect(card).toContainText(money(90));
    await expect(card).toContainText(GUESTS.alice);

    // The balances: 90 paid by one guest, owed by three.
    await page.getByRole('radio', { name: LABELS.balancesView }).click();

    await expect(balanceRow(page, GUESTS.alice)).toContainText(money(60));
    await expect(balanceRow(page, GUESTS.bob)).toContainText(money(-30));
    await expect(balanceRow(page, GUESTS.cara)).toContainText(money(-30));

    // And the payments that clear them: two guests, one creditor.
    const payments = page.getByRole('button', { name: LABELS.recordPayment });
    await expect(payments).toHaveCount(2);
  });

  test('a suggested payment is recorded in one tap and clears that debt', async ({
    page,
  }) => {
    const { tripId } = await seedMoneyTrip(page);
    await openMoneyPage(page, tripId);

    await addExpense(page, { title: 'Shopping', amount: '90', payer: GUESTS.alice });
    await page.getByRole('radio', { name: LABELS.balancesView }).click();

    // The payment naming Bob, whoever the settlement put first.
    const bobPays = page
      .getByRole('listitem')
      .filter({ hasText: GUESTS.bob })
      .filter({ hasText: GUESTS.alice });
    await bobPays.getByRole('button', { name: LABELS.recordPayment }).click();

    // The debt it was made against is gone, and Cara's is untouched.
    await expect(balanceRow(page, GUESTS.bob)).toContainText(money(0));
    await expect(balanceRow(page, GUESTS.cara)).toContainText(money(-30));
    await expect(balanceRow(page, GUESTS.alice)).toContainText(money(30));

    // It is an ordinary line afterwards, in the list with the others.
    await page.getByRole('radio', { name: LABELS.expensesView }).click();
    const transfer = page
      .getByRole('button')
      .filter({ hasText: GUESTS.bob })
      .filter({ hasText: GUESTS.alice });
    await expect(transfer.first()).toContainText(money(30));
  });

  test('an equal split of 100 between three still adds up to 100', async ({ page }) => {
    const { tripId } = await seedMoneyTrip(page);
    await openMoneyPage(page, tripId);

    const dialog = await openNewLineDialog(page);
    await dialog.getByRole('textbox', { name: LABELS.title }).fill('Dinner');
    await dialog.getByRole('spinbutton', { name: LABELS.amount }).fill('100');

    // The leftover cent goes to one guest rather than to nobody: 33.34 and two
    // of 33.33 come to 100.00, where three of 33.33 come to 99.99.
    await expect(dialog.getByText(money(33.34))).toBeVisible();
    await expect(dialog.getByText(money(33.33))).toHaveCount(2);
  });

  test('amounts that do not add up are refused, and the total says by how much', async ({
    page,
  }) => {
    const { tripId } = await seedMoneyTrip(page);
    await openMoneyPage(page, tripId);

    const dialog = await openNewLineDialog(page);
    await dialog.getByRole('textbox', { name: LABELS.title }).fill('Dinner');
    await dialog.getByRole('spinbutton', { name: LABELS.amount }).fill('100');
    await chooseOption(page, LABELS.paidBy, GUESTS.alice);
    await chooseOption(page, LABELS.splitMode, /by amount|par montant/i);

    for (const name of [GUESTS.alice, GUESTS.bob, GUESTS.cara]) {
      await dialog
        .getByRole('spinbutton', { name: new RegExp(`(amount|montant).*${name}`, 'i') })
        .fill('30');
    }

    // The running total is shown against the amount while it is typed, so
    // nobody has to re-add the column to find the twenty they mistyped.
    await expect(dialog.getByRole('alert').filter({ hasText: money(90) })).toBeVisible();

    await dialog.getByRole('button', { name: LABELS.save }).click();
    await expect(dialog.getByText(LABELS.amountsDoNotAddUp)).toBeVisible();
    await expect(dialog).toBeVisible();

    // Corrected, the same line saves.
    await dialog
      .getByRole('spinbutton', { name: new RegExp(`(amount|montant).*${GUESTS.alice}`, 'i') })
      .fill('40');
    await dialog.getByRole('button', { name: LABELS.save }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button').filter({ hasText: 'Dinner' })).toBeVisible();
  });

  test('a transfer asks who is paid, and refuses the payer', async ({ page }) => {
    const { tripId } = await seedMoneyTrip(page);
    await openMoneyPage(page, tripId);

    const dialog = await openNewLineDialog(page);
    await chooseOption(page, LABELS.kind, /payment between guests|remboursement entre invités/i);

    // A transfer is one guest paying another, so there is nothing to divide.
    await expect(
      dialog.getByRole('combobox', { name: LABELS.splitMode }),
    ).toHaveCount(0);

    await dialog.getByRole('textbox', { name: LABELS.title }).fill('Payback');
    await dialog.getByRole('spinbutton', { name: LABELS.amount }).fill('20');
    // A transfer renames the payer field, because "paid by" is not what one
    // guest handing another twenty euros is called.
    await chooseOption(page, LABELS.transferFrom, GUESTS.bob);
    await chooseOption(page, LABELS.transferTo, GUESTS.bob);

    await dialog.getByRole('button', { name: LABELS.save }).click();
    await expect(dialog.getByText(LABELS.recipientIsPayer)).toBeVisible();

    await chooseOption(page, LABELS.transferTo, GUESTS.alice);
    await dialog.getByRole('button', { name: LABELS.save }).click();
    await expect(dialog).toBeHidden();

    // Bob paid Alice 20, so Bob is up and Alice is down by the same figure.
    await page.getByRole('radio', { name: LABELS.balancesView }).click();
    await expect(balanceRow(page, GUESTS.bob)).toContainText(money(20));
    await expect(balanceRow(page, GUESTS.alice)).toContainText(money(-20));
  });

  test('the chosen view survives a reload and the back button', async ({ page }) => {
    const { tripId } = await seedMoneyTrip(page);
    await openMoneyPage(page, tripId);

    await page.getByRole('radio', { name: LABELS.balancesView }).click();
    await expect(page).toHaveURL(/view=balances/);

    await page.reload();
    await waitForRoute(page);
    await expect(page.getByRole('radio', { name: LABELS.balancesView })).toBeChecked();

    // A view nobody offers is not an error page: the default answers instead.
    await page.goto(`/trips/${tripId}/money?view=nonsense`);
    await waitForRoute(page);
    await expect(page.getByRole('radio', { name: LABELS.expensesView })).toBeChecked();
  });

  test('a line is edited and then deleted from its own dialog', async ({ page }) => {
    const { tripId } = await seedMoneyTrip(page);
    await openMoneyPage(page, tripId);

    await addExpense(page, { title: 'Shopping', amount: '90', payer: GUESTS.alice });

    const card = page.getByRole('button').filter({ hasText: 'Shopping' });
    await card.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('textbox', { name: LABELS.title })).toHaveValue(
      'Shopping',
    );

    await dialog.getByRole('spinbutton', { name: LABELS.amount }).fill('120');
    await dialog.getByRole('button', { name: LABELS.save }).click();
    await expect(dialog).toBeHidden();
    await expect(card).toContainText(money(120));

    // The balances follow the edit rather than the figure that was saved first.
    await page.getByRole('radio', { name: LABELS.balancesView }).click();
    await expect(balanceRow(page, GUESTS.alice)).toContainText(money(80));

    await page.getByRole('radio', { name: LABELS.expensesView }).click();
    await card.click();
    await dialog.getByRole('button', { name: LABELS.deleteLine }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: LABELS.delete })
      .click();

    await expect(page.getByRole('heading', { name: LABELS.empty })).toBeVisible();
  });

  test('an unsaved edit is not thrown away without a word', async ({ page }) => {
    const { tripId } = await seedMoneyTrip(page);
    await openMoneyPage(page, tripId);

    const dialog = await openNewLineDialog(page);
    await dialog.getByRole('textbox', { name: LABELS.title }).fill('Half typed');
    await page.keyboard.press('Escape');

    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: LABELS.discard }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { name: LABELS.empty })).toBeVisible();
  });

  test('the accounts of a trip with no line say so, on both views', async ({ page }) => {
    const { tripId } = await seedMoneyTrip(page);

    await openMoneyPage(page, tripId, 'balances');
    await expect(
      page.getByText(/no line yet|aucune ligne pour l'instant/i),
    ).toBeVisible();

    await page.getByRole('radio', { name: LABELS.expensesView }).click();
    await expect(page.getByRole('heading', { name: LABELS.empty })).toBeVisible();
  });

  test('a group that has settled up is told so rather than shown a payment', async ({
    page,
  }) => {
    const { tripId } = await seedMoneyTrip(page);
    await openMoneyPage(page, tripId);

    // One guest pays for himself alone: money moved, and no balance did.
    const dialog = await openNewLineDialog(page);
    await dialog.getByRole('textbox', { name: LABELS.title }).fill('His own beer');
    await dialog.getByRole('spinbutton', { name: LABELS.amount }).fill('12');
    await chooseOption(page, LABELS.paidBy, GUESTS.bob);
    await dialog.getByRole('button', { name: /^(everyone|tout le monde)$/i }).click();
    for (const name of [GUESTS.alice, GUESTS.cara]) {
      await dialog.getByRole('button', { name, pressed: true }).click();
    }
    await dialog.getByRole('button', { name: LABELS.save }).click();
    await expect(dialog).toBeHidden();

    // Scoped to the section, because the organiser's column says the same
    // sentence about the same accounts one element over.
    const settleSection = page.getByRole('region', { name: LABELS.settleSection });
    await page.getByRole('radio', { name: LABELS.balancesView }).click();
    await expect(settleSection.getByText(LABELS.settled)).toBeVisible();
    await expect(page.getByRole('button', { name: LABELS.recordPayment })).toHaveCount(0);
  });
});
