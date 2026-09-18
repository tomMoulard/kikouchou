/**
 * @fileoverview The trip creation form's guest list.
 *
 * Every row is optional, so the specs that merely need *a* trip ignore this
 * entirely and submit the form with nobody on the list. These are for the tests
 * that are about the guest list itself.
 *
 * @module e2e/support/trip-form
 */

import type { Page } from '@playwright/test';

// ============================================================================
// Constants
// ============================================================================

/**
 * Who the suite is, on trips it creates through the form.
 *
 * Deliberately not a name any fixture guest uses, so an assertion about "the
 * guests I added" never accidentally matches the organiser.
 */
export const ORGANISER_NAME = 'Test Organiser';

// ============================================================================
// Public API
// ============================================================================

/**
 * Fills the first guest row — the user's own — on the create form.
 *
 * Matched on the row's `aria-label` rather than an id: the rows are a list, so
 * only the first one carries this label and it stays stable as rows are added.
 *
 * @param page - Playwright page sitting on `/trips/new`
 * @param name - The organiser's name (defaults to {@link ORGANISER_NAME})
 */
export async function fillTripOrganiser(
  page: Page,
  name: string = ORGANISER_NAME,
): Promise<void> {
  await page.getByLabel(/your name/i).fill(name);
}

/**
 * Empties the first guest row, taking the signed-in user off the trip.
 *
 * Signed in, that row pre-fills from the account — so a spec that signs in and
 * then creates a trip through the form gets a guest named after the account
 * whether it asked for one or not. Clearing it is what somebody who hosts
 * rather than travels does, and it is the only way to submit the form with an
 * empty guest list while signed in.
 *
 * Safe whether or not the prefill has landed yet: this fires an input event, and
 * the form stops following the account for that row as soon as the user touches
 * it.
 *
 * @param page - Playwright page sitting on `/trips/new`
 */
export async function clearTripOrganiser(page: Page): Promise<void> {
  await page.getByLabel(/your name/i).clear();
}

/**
 * Adds one further guest row per name and fills it.
 *
 * @param page - Playwright page sitting on `/trips/new`
 * @param names - Guests to add after the organiser
 */
export async function addTripGuests(
  page: Page,
  names: readonly string[],
): Promise<void> {
  // Sequential by necessity: the input only exists once the click that adds its
  // row has rendered, and the row numbering depends on how many came before.
  //
  // Matched as an exact textbox rather than by label: each row's remove button
  // is labelled "Remove guest N", so a loose `getByLabel(/guest 2/i)` matches
  // the input and the button beside it and fails strict mode.
  for (const [index, name] of names.entries()) {
    await page.getByRole('button', { name: /add guest/i }).click();
    await page
      .getByRole('textbox', { name: `Guest ${index + 2}`, exact: true })
      .fill(name);
  }
}
