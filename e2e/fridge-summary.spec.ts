/**
 * @fileoverview E2E cover for the printable trip summary.
 *
 * Two claims here cannot be checked anywhere else. The first is that the page
 * really is one sheet of the trip's own data — rooms, travel and guests, all
 * read out of IndexedDB. The second is what it looks like on paper: the header, the sidebar and the bottom bar are removed by `print:`
 * utilities and a `@media print` block in `index.css`, and only a real browser
 * asked to render print media can say whether that worked.
 *
 * @module e2e/fridge-summary
 */

import { expect, test, type Page } from '@playwright/test';

import { fixtureDate } from './support/fixture-dates';
import { waitForRoute } from './support/routes';
import { seedPerson, seedRoom, seedTransport, seedTrip } from './support/seed';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Both locales, because the suite runs against whichever the browser asks for.
 */
const LABELS = {
  print: /^print$|^imprimer$/i,
  rooms: /who sleeps where|qui dort où/i,
  travel: /arrivals and departures|arrivées et départs/i,
} as const;

/**
 * Seeds a trip with a room, a guest and an arrival, then opens its summary.
 *
 * Everything is written before the trip becomes current, the ordering every
 * other spec here follows: seeding into a loaded trip races the Yjs mirror.
 *
 * @param page - Playwright page object
 */
async function openSummary(page: Page): Promise<void> {
  const { tripId } = await seedTrip(page, {
    name: 'Fridge Door Trip',
    startDate: fixtureDate(1),
    endDate: fixtureDate(8),
  });

  const personId = await seedPerson(page, tripId, 'Marie');
  await seedRoom(page, { tripId, name: 'Master bedroom', capacity: 2 });
  await seedTransport(page, {
    tripId,
    personId,
    type: 'arrival',
    datetime: new Date(`${fixtureDate(1)}T14:30`).toISOString(),
    mode: 'train',
    location: 'Gare Montparnasse',
  });

  await page.goto(`/trips/${tripId}/summary`);
  await waitForRoute(page);
}

// ============================================================================
// Tests
// ============================================================================

test.describe('one page for the fridge door', () => {
  test('shows the rooms, the travel and the guests of the trip', async ({ page }) => {
    await openSummary(page);

    // Scoped to the sheet: the sidebar names the trip and lists tonight's
    // guests too, so an unscoped match would pass on the navigation alone.
    const sheet = page.getByRole('article');

    await expect(sheet.getByRole('heading', { name: 'Fridge Door Trip' })).toBeVisible();
    await expect(sheet.getByRole('heading', { name: LABELS.rooms })).toBeVisible();
    await expect(sheet.getByText('Master bedroom')).toBeVisible();
    await expect(sheet.getByRole('heading', { name: LABELS.travel })).toBeVisible();
    await expect(sheet.getByText('Gare Montparnasse')).toBeVisible();
    await expect(sheet.getByText('Marie').first()).toBeVisible();
  });

  test('prints the sheet without the navigation around it', async ({ page }) => {
    await openSummary(page);

    const printButton = page.getByRole('button', { name: LABELS.print });
    await expect(printButton).toBeVisible();

    await page.emulateMedia({ media: 'print' });

    // The chrome goes, the sheet stays.
    await expect(printButton).toBeHidden();
    await expect(page.getByRole('banner')).toBeHidden();
    await expect(page.getByRole('article').getByText('Master bedroom')).toBeVisible();

    await page.emulateMedia({ media: 'screen' });
  });
});
