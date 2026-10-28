/**
 * @fileoverview The activities as a day-by-day planning, on the calendar and
 * on the activities page.
 *
 * Both pages used to draw one band per category ("Meals", "Sport") across the
 * trip's days, which did not answer "what are we doing on Saturday?". They now
 * list each day with its activities in the order they happen, and a multi-day
 * activity on every day it covers.
 *
 * @module e2e/activity-planning
 */

import { test, expect, type Locator, type Page } from '@playwright/test';

import { fixtureDate } from './support/fixture-dates';
import { waitForRoute } from './support/routes';
import { seedActivity, seedPerson, seedTrip } from './support/seed';

// ============================================================================
// Fixtures
// ============================================================================

const PLANNING_HEADING = /^(schedule|planning)$/i;

/**
 * Seeds a trip with three activities over two days: a two-day trek, and on
 * its second day a dinner and a horse ride entered out of order.
 *
 * Times are local wall-clock times, so the day they fall on does not depend on
 * the browser's timezone.
 */
async function seedPlannedTrip(page: Page): Promise<string> {
  const { tripId } = await seedTrip(page, {
    name: 'Planning Trip',
    startDate: fixtureDate(1),
    endDate: fixtureDate(6),
  });
  await seedPerson(page, tripId, 'Jules');

  await seedActivity(page, {
    tripId,
    title: 'Dinner at the Bastide',
    category: 'meal',
    startDatetime: `${fixtureDate(3)}T20:00:00`,
  });
  await seedActivity(page, {
    tripId,
    title: 'Horse ride',
    category: 'sport',
    startDatetime: `${fixtureDate(3)}T09:00:00`,
    location: 'Le Haras',
  });
  await seedActivity(page, {
    tripId,
    title: 'Mountain trek',
    category: 'hike',
    startDatetime: `${fixtureDate(2)}T08:00:00`,
    endDatetime: `${fixtureDate(3)}T17:00:00`,
  });

  return tripId;
}

function agendaDay(page: Page, dateKey: string): Locator {
  return page.getByTestId(`activity-agenda-day-${dateKey}`);
}

/**
 * Asserts the second day lists the trek first, as carried over, then the two
 * timed activities by their start.
 */
async function expectSecondDayInOrder(page: Page): Promise<void> {
  const entries = agendaDay(page, fixtureDate(3)).getByRole('button');
  await expect(entries).toHaveCount(3);
  await expect(entries.nth(0)).toContainText('Mountain trek');
  await expect(entries.nth(0)).toContainText(/day 2 of 2|jour 2 sur 2/i);
  await expect(entries.nth(1)).toContainText('Horse ride');
  await expect(entries.nth(1)).toContainText('Le Haras');
  await expect(entries.nth(2)).toContainText('Dinner at the Bastide');
}

// ============================================================================
// Tests
// ============================================================================

test.describe('activity planning', () => {
  test('the calendar lists the activities day by day under the guests', async ({ page }) => {
    const tripId = await seedPlannedTrip(page);

    await page.goto(`/trips/${tripId}/calendar?view=timeline`);
    await waitForRoute(page);

    await expect(page.getByRole('heading', { level: 2, name: PLANNING_HEADING })).toBeVisible();
    await expect(agendaDay(page, fixtureDate(2)).getByRole('button')).toHaveText(/Mountain trek/);
    await expectSecondDayInOrder(page);

    // The activities are no longer drawn on the guests' day axis.
    const timeline = page.getByRole('region', { name: /timeline calendar|calendrier en chronologie/i });
    await expect(timeline.getByText('Horse ride')).toHaveCount(0);

    await agendaDay(page, fixtureDate(3)).getByRole('button', { name: /Horse ride/ }).click();
    await expect(page.getByRole('dialog')).toContainText('Horse ride');
  });

  test('the activities page opens on the same planning', async ({ page }) => {
    const tripId = await seedPlannedTrip(page);

    await page.goto(`/trips/${tripId}/activities`);
    await waitForRoute(page);

    await expect(page.getByRole('radio', { name: PLANNING_HEADING })).toBeChecked();
    await expectSecondDayInOrder(page);

    await agendaDay(page, fixtureDate(3)).getByRole('button', { name: /Dinner/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
