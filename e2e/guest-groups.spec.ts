/**
 * @fileoverview E2E tests for guest groups — reusable rosters imported into a trip.
 *
 * The round trip is the point: a group built once on `/groups` has to reach a
 * trip's guest list with the people the user actually ticked, and a trip's
 * guests have to become a group the next trip can reuse. Both directions cross
 * the boundary between a global entity and a trip-scoped one, which is exactly
 * where a unit test's fakes stop being evidence.
 *
 * @module e2e/guest-groups
 */

import { expect, test, type Page } from '@playwright/test';

import { fixtureDate } from './support/fixture-dates';
import { waitForRoute } from './support/routes';
import { seedGuestGroup, seedTrip } from './support/seed';

// ============================================================================
// Helpers
// ============================================================================

/** The family from the feature's own example: a couple and two daughters. */
const FAMILY = {
  name: 'Family',
  members: ['Tom + Léa', 'Alice', 'Camille'],
} as const;

/**
 * Builds a group through the UI, one member row at a time.
 *
 * Deliberately not seeded into IndexedDB: the member editor adding a row per
 * click is the part most likely to break, and a seeded group would skip it.
 */
async function createGroup(
  page: Page,
  name: string,
  members: readonly string[],
): Promise<void> {
  await page.goto('/groups');
  await waitForRoute(page);

  await page.getByRole('button', { name: /new group/i }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByLabel(/group name/i).fill(name);

  for (const [index, member] of members.entries()) {
    await dialog.getByRole('button', { name: /add a person/i }).click();
    // Every row shares the same placeholder, so the row just added is the last.
    await dialog.getByPlaceholder(/^name$/i).nth(index).fill(member);
  }

  await dialog.getByRole('button', { name: /^save$/i }).click();
  await expect(dialog).toBeHidden();
}

/**
 * Picks the 15th and 22nd in the trip form, as the sync spec does.
 *
 * Days of the month the picker opens on — always the current one — so there is
 * no fixture date here to go stale.
 */
async function fillTripDates(page: Page): Promise<void> {
  await page.locator('#trip-start-date').click();
  await page.getByRole('gridcell').filter({ hasText: /^15$/ }).first().click();
  await page.locator('#trip-end-date').click();
  await page.getByRole('gridcell').filter({ hasText: /^22$/ }).first().click();
}

/** A trip whose dates are derived from today, never a literal month. */
async function seedThisYearsTrip(page: Page): Promise<string> {
  const { tripId } = await seedTrip(page, {
    name: 'Brittany',
    startDate: fixtureDate(1),
    endDate: fixtureDate(8),
  });
  return tripId;
}

// ============================================================================
// Tests
// ============================================================================

test.describe('Guest groups', () => {
  test('a group survives a reload', async ({ page }) => {
    await createGroup(page, FAMILY.name, FAMILY.members);

    await page.reload();
    await waitForRoute(page);

    await expect(page.getByText(FAMILY.name, { exact: true })).toBeVisible();
    for (const member of FAMILY.members) {
      await expect(page.getByText(member, { exact: true })).toBeVisible();
    }
  });

  test('imports only the people ticked in the selector', async ({ page }) => {
    const tripId = await seedThisYearsTrip(page);
    await createGroup(page, FAMILY.name, FAMILY.members);

    await page.goto(`/trips/${tripId}/persons`);
    await waitForRoute(page);

    await page.getByRole('button', { name: /add from a group/i }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // One group exists, so the picker opens straight into it with everybody
    // ticked. Grandma is not coming this year.
    await dialog.getByText('Camille', { exact: true }).click();
    await dialog.getByRole('button', { name: /add \d+ (people|person)/i }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByText('Tom + Léa', { exact: true })).toBeVisible();
    await expect(page.getByText('Alice', { exact: true })).toBeVisible();
    await expect(page.getByText('Camille', { exact: true })).toHaveCount(0);
  });

  test('imported guests are ordinary guests, not references to the group', async ({
    page,
  }) => {
    const tripId = await seedThisYearsTrip(page);
    await createGroup(page, FAMILY.name, FAMILY.members);

    await page.goto(`/trips/${tripId}/persons`);
    await waitForRoute(page);

    await page.getByRole('button', { name: /add from a group/i }).first().click();
    const importDialog = page.getByRole('dialog');
    await importDialog.getByRole('button', { name: /add \d+ (people|person)/i }).click();
    await expect(importDialog).toBeHidden();

    await expect(page.getByText('Alice', { exact: true })).toBeVisible();

    // Deleting the group must not touch a guest already on the trip.
    await page.goto('/groups');
    await waitForRoute(page);
    await page.getByRole('button', { name: /delete family/i }).click();
    await page.getByRole('button', { name: /^delete$/i }).click();

    await page.goto(`/trips/${tripId}/persons`);
    await waitForRoute(page);

    await expect(page.getByText('Alice', { exact: true })).toBeVisible();
    await expect(page.getByText('Tom + Léa', { exact: true })).toBeVisible();
  });

  test("saves a trip's guests as a group for next time", async ({ page }) => {
    const tripId = await seedThisYearsTrip(page);
    await createGroup(page, FAMILY.name, FAMILY.members);

    await page.goto(`/trips/${tripId}/persons`);
    await waitForRoute(page);

    await page.getByRole('button', { name: /add from a group/i }).first().click();
    const importDialog = page.getByRole('dialog');
    await importDialog.getByRole('button', { name: /add \d+ (people|person)/i }).click();
    await expect(importDialog).toBeHidden();
    await expect(page.getByText('Alice', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: /save as a group/i }).click();
    const saveDialog = page.getByRole('dialog');
    await saveDialog.getByLabel(/group name/i).fill('Brittany crew');
    await saveDialog.getByRole('button', { name: /^save$/i }).click();
    await expect(saveDialog).toBeHidden();

    await page.goto('/groups');
    await waitForRoute(page);

    await expect(page.getByText('Brittany crew', { exact: true })).toBeVisible();
    // Both groups now exist; the original is untouched.
    await expect(page.getByText(FAMILY.name, { exact: true })).toBeVisible();
  });

  test('adds a second family after the first, from the guest list', async ({ page }) => {
    const tripId = await seedThisYearsTrip(page);
    await createGroup(page, FAMILY.name, FAMILY.members);
    await createGroup(page, 'Neighbours', ['Dana']);

    await page.goto(`/trips/${tripId}/persons`);
    await waitForRoute(page);

    // First family. Groups arrive folded, so open the one wanted first.
    await page.getByRole('button', { name: /add from a group/i }).first().click();
    let dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: new RegExp(FAMILY.name) }).click();
    await dialog.getByText('Alice', { exact: true }).click();
    await dialog.getByRole('button', { name: /add \d+ (people|person)/i }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Alice', { exact: true })).toBeVisible();

    // …and then the neighbours, without losing the first.
    await page.getByRole('button', { name: /add from a group/i }).first().click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Neighbours/ }).click();
    await dialog.getByText('Dana', { exact: true }).click();
    await dialog.getByRole('button', { name: /add \d+ (people|person)/i }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByText('Alice', { exact: true })).toBeVisible();
    await expect(page.getByText('Dana', { exact: true })).toBeVisible();
  });

  test('takes people from two groups in a single pass', async ({ page }) => {
    const tripId = await seedThisYearsTrip(page);
    await createGroup(page, FAMILY.name, FAMILY.members);
    await createGroup(page, 'Neighbours', ['Dana']);

    await page.goto(`/trips/${tripId}/persons`);
    await waitForRoute(page);

    await page.getByRole('button', { name: /add from a group/i }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Both groups are on screen at once — folded, so the dialog is a short list
    // of names rather than everybody in the account.
    await expect(dialog.getByText(FAMILY.name, { exact: true })).toBeVisible();
    await expect(dialog.getByText('Neighbours', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('checkbox')).toHaveCount(0);

    await dialog.getByRole('button', { name: new RegExp(FAMILY.name) }).click();
    await dialog.getByText('Tom + Léa', { exact: true }).click();
    await dialog.getByRole('button', { name: /Neighbours/ }).click();
    await dialog.getByText('Dana', { exact: true }).click();
    await dialog.getByRole('button', { name: /add \d+ (people|person)/i }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByText('Tom + Léa', { exact: true })).toBeVisible();
    await expect(page.getByText('Dana', { exact: true })).toBeVisible();
    // Only the two who were ticked.
    await expect(page.getByText('Alice', { exact: true })).toHaveCount(0);
  });

  test('searches the groups instead of scrolling them', async ({ page }) => {
    const tripId = await seedThisYearsTrip(page);
    await createGroup(page, FAMILY.name, FAMILY.members);
    await createGroup(page, 'Neighbours', ['Dana']);

    await page.goto(`/trips/${tripId}/persons`);
    await waitForRoute(page);

    await page.getByRole('button', { name: /add from a group/i }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Searching a person's name finds the group holding them, and opens it —
    // a match on a hidden member would be a worse answer than none.
    await dialog.getByPlaceholder(/search groups or people/i).fill('dana');

    await expect(dialog.getByText('Neighbours', { exact: true })).toBeVisible();
    await expect(dialog.getByText(FAMILY.name, { exact: true })).toHaveCount(0);
    await expect(dialog.getByLabel(/Dana/)).toBeVisible();
  });

  test('a trip created from a group and typed names keeps both', async ({ page }) => {
    await seedGuestGroup(page, {
      name: FAMILY.name,
      members: [{ name: 'Tom + Léa', headcount: 2 }, { name: 'Alice' }],
    });

    await page.goto('/trips/new');
    await waitForRoute(page);

    await page.getByLabel(/trip name/i).fill('Bretagne');
    await fillTripDates(page);

    // Type one guest, import two — they end up in one list, and one trip.
    await page.getByRole('button', { name: /^add guest$/i }).click();
    const rows = page.getByRole('group', { name: /guests/i }).getByRole('textbox');
    await rows.last().fill('Marie');

    await page.getByRole('button', { name: /add from a group/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /add \d+ (people|person)/i }).click();
    await expect(dialog).toBeHidden();

    // One list, no separation: the imported people are rows like any other.
    // Four rows, because signed out the first is the empty "you" row — it is
    // dropped on save rather than becoming a nameless guest.
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(1)).toHaveValue('Marie');
    await expect(rows.nth(2)).toHaveValue('Tom + Léa');
    await expect(rows.nth(3)).toHaveValue('Alice');

    await page.getByRole('button', { name: /^save$/i }).click();
    await page.waitForURL(/\/trips\/[\w-]+\/calendar/, { timeout: 20_000 });

    await page.goto(page.url().replace('/calendar', '/persons'));
    await waitForRoute(page);

    await expect(page.getByText('Marie', { exact: true })).toBeVisible();
    await expect(page.getByText('Tom + Léa', { exact: true })).toBeVisible();
    await expect(page.getByText('Alice', { exact: true })).toBeVisible();
  });

  /*
    One more create-page flow is deliberately absent, with its reasoning below:
    the picker's own tests cover the merge into the guest list
    (`TripForm addGuests` in TripForm.test.tsx).

    Not for lack of trying: on `/trips/new` the first real click on a form
    control never reaches React. The button takes focus, the handler does not
    run, and a second click works. It reproduces with groups seeded straight
    into IndexedDB (no dialog opened beforehand), at any viewport height, after
    any wait, and with the trip form's own "Add guest" button — while a
    synthetic `element.click()` works, so the handler is attached. That is a
    page-level quirk to chase on its own, not something to paper over here with
    a double click that would hide it from whoever does.
  */

  test('offers the group import from an empty guest list', async ({ page }) => {
    const tripId = await seedThisYearsTrip(page);
    await createGroup(page, FAMILY.name, FAMILY.members);

    await page.goto(`/trips/${tripId}/persons`);
    await waitForRoute(page);

    // The empty state is where a saved roster pays off most, so the second
    // action there is the import rather than a link somewhere else.
    await expect(page.getByRole('button', { name: /add from a group/i }).first()).toBeVisible();
  });
});
