/**
 * @fileoverview E2E cover for the run sheet, and for the path that leads to it.
 *
 * Analytics counted "pickups needing a driver" long before any screen listed
 * them. These tests walk the loop the feature closes: the number on the
 * analytics card, the click that follows it, and the flagged line at the end.
 *
 * Rows are addressed through `data-testid` and `data-needs-driver` rather than
 * text: the app defaults to French, so matching wording would pass or fail by
 * locale.
 *
 * @module e2e/transport-run-sheet
 */

import { expect, test } from '@playwright/test';

import { waitForRoute } from './support/routes';
import { seedPerson, seedTransport, seedTrip } from './support/seed';
import { clearIndexedDB } from './support/storage';

// ============================================================================
// Helpers
// ============================================================================

/**
 * A day `daysFromToday` from now, as `yyyy-MM-dd`.
 *
 * @param daysFromToday - Days ahead (negative for the past)
 * @returns The local calendar day
 */
function isoDate(daysFromToday: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
}

/**
 * An instant at noon, `daysFromToday` from now.
 *
 * @param daysFromToday - Days ahead (negative for the past)
 * @returns An ISO datetime
 */
function isoDatetime(daysFromToday: number): string {
  return `${isoDate(daysFromToday)}T12:00:00.000Z`;
}

// ============================================================================
// Tests
// ============================================================================

test.describe('Transport run sheet', () => {
  test('lists every leg, and flags the arrival nobody drives yet', async ({ page }) => {
    await clearIndexedDB(page);

    // Seed everything BEFORE the trip is made current — see `support/seed`.
    const { tripId } = await seedTrip(page, {
      name: 'Run Sheet Trip',
      startDate: isoDate(30),
      endDate: isoDate(40),
    });
    const alice = await seedPerson(page, tripId, 'Alice');
    // `seedTransport` flags an arrival as needing a pickup and assigns no
    // driver, which is exactly the state this page exists to surface.
    await seedTransport(page, {
      tripId,
      personId: alice,
      type: 'arrival',
      datetime: isoDatetime(30),
    });
    await seedTransport(page, {
      tripId,
      personId: alice,
      type: 'departure',
      datetime: isoDatetime(40),
    });

    await page.goto(`/trips/${tripId}/transports/runsheet`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    const rows = page.getByTestId('run-sheet-row');
    await expect(rows).toHaveCount(2);
    await expect(page.locator('[data-needs-driver="true"]')).toHaveCount(1);
  });

  test('the analytics pickup count leads to the legs it counts', async ({ page }) => {
    await clearIndexedDB(page);

    const { tripId } = await seedTrip(page, {
      name: 'Run Sheet Trip',
      startDate: isoDate(30),
      endDate: isoDate(40),
    });
    const alice = await seedPerson(page, tripId, 'Alice');
    await seedTransport(page, {
      tripId,
      personId: alice,
      type: 'arrival',
      datetime: isoDatetime(30),
    });
    await seedTransport(page, {
      tripId,
      personId: alice,
      type: 'departure',
      datetime: isoDatetime(40),
    });

    await page.goto(`/trips/${tripId}/analytics`);
    await page.waitForLoadState('load');
    await waitForRoute(page);

    await expect(page.getByTestId('stat-pickups')).toHaveText('1');

    await page.getByTestId('stat-pickups').click();
    await page.waitForURL(/transports\/runsheet\?filter=needsDriver/);
    await waitForRoute(page);

    // Only the leg the badge counted, and it carries the flag.
    await expect(page.getByTestId('run-sheet-row')).toHaveCount(1);
    await expect(page.locator('[data-needs-driver="true"]')).toHaveCount(1);
  });
});
