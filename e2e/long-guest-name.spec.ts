/**
 * @fileoverview A guest name with no spaces in it stays on the screen.
 *
 * The bug this pins: a name typed without spaces (a keyboard mash, a name in
 * a script the phone's keyboard does not break) is one unbreakable word. On
 * the guest list it widened its card, because a grid item and a flex item are
 * both as wide as their content by default, and `truncate` on the title had
 * nothing to truncate against. The page grew three times the phone's width
 * and every dialog opened off-centre. The printed summary did the same.
 *
 * Measured rather than asserted as class strings, because only a browser
 * resolves min-content widths: the check is that the page scrolls no wider
 * than the screen.
 *
 * @module e2e/long-guest-name
 */

import { expect, test } from '@playwright/test';

import { fixtureDate } from './support/fixture-dates';
import { waitForRoute } from './support/routes';
import { seedPerson, seedRoom, seedTrip } from './support/seed';

// ============================================================================
// Constants
// ============================================================================

/** One word, far wider than any phone. */
const LONG_NAME = 'Оуовооддылылллддыдыдыддыдыддыдыддвдсллсьсьмьм'.repeat(2);

/** The pages that print a guest's name in a row of their own. */
const PAGES = ['/persons', '/summary', '', '/rooms'] as const;

test.use({ viewport: { width: 393, height: 852 } });

// ============================================================================
// Tests
// ============================================================================

for (const path of PAGES) {
  test(`keeps ${path || 'the calendar'} within the screen`, async ({ page }) => {
    const { tripId } = await seedTrip(page, {
      name: 'Long names',
      startDate: fixtureDate(1),
      endDate: fixtureDate(8),
    });
    // The room is what makes the summary list who still has no bed.
    await seedRoom(page, { tripId, name: 'Room' });
    await seedPerson(page, tripId, LONG_NAME, '#ec4899');

    await page.goto(`/trips/${tripId}${path}`);
    await waitForRoute(page);
    await expect(page.getByText(LONG_NAME).first()).toBeAttached();

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
}
