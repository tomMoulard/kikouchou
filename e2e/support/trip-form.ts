/**
 * @fileoverview The trip creation form's guest list, for the six specs that
 * drive that form.
 *
 * The first guest row is required, so every path that submits the create form
 * has to fill it — and the suite runs signed out, where nothing pre-fills it.
 * One helper rather than the same line copied into each spec: a change to how
 * that row is labelled would otherwise break five files quietly and one loudly.
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
 * Fills the required first guest — the user themselves — on the create form.
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
