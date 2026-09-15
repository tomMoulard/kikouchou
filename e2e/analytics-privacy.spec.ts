/**
 * @fileoverview The suite must not send anything to PostHog.
 *
 * This exists because it once did, and nobody noticed for months. The project
 * accumulated 20 people against three real Supabase accounts; 19 were anonymous
 * ids, and every one of their events came from `localhost:3000`, `localhost:5173`
 * or the `127.0.0.1` servers this very config starts. Three separate things had
 * to be true for that: Vite loads `.env.local` for a Playwright web server, the
 * config blanked `VITE_SUPABASE_*` but not `VITE_POSTHOG_*`, and posthog-js's
 * dated defaults treat a loopback hostname as an internal user — a path that
 * forced a person profile regardless of the `person_profiles` setting.
 *
 * `person_profiles` is now `'always'`, so a leak from this suite would not need
 * that third condition at all: one request is one person. The assertion below
 * is unchanged because it never depended on any of them.
 *
 * Each of those is fixed. This spec asserts the outcome instead of any one of
 * them, so the guarantee survives whichever gets undone next.
 *
 * @module e2e/analytics-privacy
 */

import { test, expect } from '@playwright/test';

import {
  recordAnalyticsRequests,
  stubExternalMapServices,
} from './support/external-services';
import { waitForRoute } from './support/routes';

// ============================================================================
// Constants
// ============================================================================

/** Where a configured build would send its events. */
const INGESTION_URL = 'https://eu.i.posthog.com/e/';

/**
 * How long to let a leak happen before declaring there was none.
 *
 * posthog-js's `request_queue_config.flush_interval_ms` defaults to 3000, so a
 * capture queued by the last navigation is not on the wire for up to three
 * seconds after it. Read out of `node_modules/posthog-js/dist/module.js`, not
 * guessed; this is the one number that decides whether the assertion below is
 * real or decorative.
 */
const POSTHOG_FLUSH_SETTLE_MS = 4_000;

// ============================================================================
// The guarantee
// ============================================================================

test.describe('Analytics stays off the wire', () => {
  test('a cold launch and a walk through the app reach PostHog zero times', async ({
    page,
  }) => {
    // Recorded before the first navigation: init happens at module scope, so a
    // listener attached after `goto` would miss the very request that matters.
    const attempts = recordAnalyticsRequests(page);
    await stubExternalMapServices(page);

    // Warm the server before asserting on anything rendered. A cold Vite dev
    // server pre-bundles this app's very large dependency graph on the first
    // request and then forces a reload when it finishes, which no route-level
    // wait survives. The recorder is already attached, so a leak during the
    // warm-up counts against the assertion below just the same.
    await page.goto('/trips');
    await page.waitForLoadState('load');

    // The pages a first-time visitor actually lands on. `$pageview` is the
    // capture that fires on each of them, so this is where a leak would show.
    for (const path of ['/trips', '/trips/new', '/settings']) {
      await page.goto(path);
      await waitForRoute(page);
    }

    // A real wait, not a poll. `expect.poll` returns on its first passing
    // evaluation, and an empty list passes immediately — so polling here would
    // assert nothing at all, which is precisely the failure mode this repo keeps
    // producing. posthog-js batches captures behind a 3 s flush interval, so the
    // queue has to be given longer than that to be wrong in.
    await page.waitForTimeout(POSTHOG_FLUSH_SETTLE_MS);

    expect(attempts).toEqual([]);
  });

  // ==========================================================================
  // The assertion above can fail
  // ==========================================================================

  test('the recorder sees a PostHog request when one is made, and the stub keeps it local', async ({
    page,
  }) => {
    // An assertion on an empty list is worth nothing until the list is shown to
    // fill. This drives one request at the ingestion host the app would use and
    // checks both halves: the recorder notices it, and the route stub answers it
    // so nothing leaves the machine even in this deliberate case.
    const attempts = recordAnalyticsRequests(page);
    await stubExternalMapServices(page);

    // A document on the app's own origin is all this needs — no rendered route,
    // so nothing here depends on how long a cold dev server takes to compile.
    await page.goto('/trips');
    await page.waitForLoadState('load');

    const status = await page.evaluate(async (url: string) => {
      const response = await fetch(url, { method: 'POST', body: '{}' });
      return response.status;
    }, INGESTION_URL);

    // Fulfilled by the route stub rather than by PostHog — which also proves
    // the route pattern covers the ingestion host, since an unmatched request
    // would have gone to the network and come back differently, or not at all.
    expect(status).toBe(200);

    // `some`, not a count: this test is about the recorder noticing, and must
    // not also fail for the reason the test above exists to catch.
    await expect
      .poll(() => attempts.some((url) => url.startsWith(INGESTION_URL)))
      .toBe(true);
  });
});
