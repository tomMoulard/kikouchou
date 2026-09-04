/**
 * @fileoverview `?install=1`: the landing page's install CTA, honoured here.
 *
 * `https://app.kikouchou.app/?install=1` is what "Install on your phone" links
 * to, and a visitor who taps it has already said yes. Two things used to answer
 * with nothing at all: the 7-day silence the banner keeps after a dismissal,
 * and a browser that never fires `beforeinstallprompt` — every browser that is
 * not Chromium, which under automation is every browser here.
 *
 * The unit tests own the branching; these three own what only a real browser
 * can say: that the parameter survives the router, that `history.replaceState`
 * actually empties the address bar, and that navigation still works afterwards.
 *
 * @module e2e/install-request
 */

import { test, expect } from '@playwright/test';

import { fixtureDate } from './support/fixture-dates';
import { waitForRoute } from './support/routes';
import { seedTrip } from './support/seed';
import {
  INSTALL_REGION_LABEL,
  MANUAL_STEPS_BUTTON_LABEL,
  fakeBeforeInstallPrompt,
  seedInstallDismissal,
} from './support/install-prompt';

/**
 * A phone, because the CTA reads "Install on your phone" — and because the card
 * shares the bottom edge with the nav bar and the FAB only below `md`.
 */
test.use({ viewport: { width: 393, height: 852 } });

test.describe('an install request from the landing page', () => {
  test('shows the banner despite a dismissal from this week', async ({
    page,
  }) => {
    await seedInstallDismissal(page);

    await page.goto('/trips?install=1');
    await waitForRoute(page);
    await fakeBeforeInstallPrompt(page);

    // Without the parameter this dismissal buys six more days of silence;
    // `mobile-bottom-edge.spec.ts` shows the same seeding is what the app
    // honours the rest of the time.
    await expect(
      page.getByRole('region', { name: INSTALL_REGION_LABEL }),
    ).toBeVisible();
  });

  test('offers hand-written steps where the browser fires no prompt', async ({
    page,
  }) => {
    // Nothing fakes the event here, deliberately: an automated Chromium fires
    // it no more than an iPhone does, so this is the case the app has to answer
    // with instructions rather than with a button that cannot work.
    await page.goto('/trips?install=1');
    await waitForRoute(page);

    await expect(
      page.getByRole('region', { name: INSTALL_REGION_LABEL }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: MANUAL_STEPS_BUTTON_LABEL }),
    ).toBeVisible();
  });

  test('spends the parameter and leaves the router working', async ({
    page,
  }) => {
    // Seeded because the FAB below is on the populated `/trips`, not on its
    // empty state.
    await seedTrip(page, {
      name: 'Install Request',
      startDate: fixtureDate(1),
      endDate: fixtureDate(10),
    });

    await page.goto('/trips?install=1');
    await waitForRoute(page);

    // A reload, a bookmark or a link the visitor forwards must not ask again.
    await expect
      .poll(() => new URL(page.url()).search, { timeout: 10_000 })
      .toBe('');

    /*
      `InstallPrompt` is mounted outside `RouterProvider`, so it cannot use the
      router's own navigation and calls `history.replaceState` directly —
      behind React Router's back. This is the assertion that the router is not
      stranded by it: the FAB below calls `navigate('/trips/new')`.
    */
    await page.getByRole('button', { name: /new trip|nouveau voyage/i }).click();

    await expect(page).toHaveURL(/\/trips\/new$/);
  });
});
