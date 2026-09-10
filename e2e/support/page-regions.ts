/**
 * @fileoverview The lists a trip page draws, as locators.
 *
 * A page's own names are no longer unique in the document. From `xl` up the
 * trip pages carry the organiser's column beside them, and that column repeats
 * the very things the page lists: the rooms and how full they are, the guests
 * with no bed, the guests who are not level. `page.getByText('Attic')` then
 * matches twice and fails on strict mode, which says nothing about the room
 * and everything about the layout.
 *
 * Naming the page's own list is the fix, and it is a better assertion anyway:
 * "the rooms list holds Attic" is the claim, where "the document holds the
 * word Attic somewhere" never was.
 *
 * @module e2e/support/page-regions
 */

import type { Locator, Page } from '@playwright/test';

// ============================================================================
// Constants
// ============================================================================

/** Both locales, because the suite runs against whichever the browser asks for. */
const LIST_LABELS = {
  rooms: /^(rooms|chambres|room rows|lignes de chambres)$/i,
  guests: /^(guests|participants)$/i,
  timelineRows: /^(room rows|lignes de chambres)$/i,
} as const;

// ============================================================================
// Regions
// ============================================================================

/**
 * The rooms on `/trips/:tripId/rooms`, in whichever view is on screen.
 *
 * Both views are covered by one name because a caller rarely cares: the cards
 * grid is labelled "Rooms" and the timeline's rows are labelled "Room rows",
 * and only one of them is ever rendered. {@link timelineRows} is the narrower
 * one, for an assertion that is about the timeline itself.
 *
 * @param page - Playwright page object
 * @returns The list the page draws its rooms in
 */
export function roomCards(page: Page): Locator {
  return page.getByRole('list', { name: LIST_LABELS.rooms });
}

/**
 * The guest cards on `/trips/:tripId/persons`.
 *
 * @param page - Playwright page object
 * @returns The grid the page lists its guests in
 */
export function guestCards(page: Page): Locator {
  return page.getByRole('list', { name: LIST_LABELS.guests });
}

/**
 * The room rows of the timeline view on `/trips/:tripId/rooms?view=timeline`.
 *
 * @param page - Playwright page object
 * @returns The rows the timeline draws, one per room
 */
export function timelineRows(page: Page): Locator {
  return page.getByRole('list', { name: LIST_LABELS.timelineRows });
}
