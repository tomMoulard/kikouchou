/**
 * @fileoverview Route stubs for the third-party services the app talks to.
 *
 * @module e2e/support/external-services
 */

import type { Page, Request } from '@playwright/test';

// ============================================================================
// Constants
// ============================================================================

/**
 * Every host PostHog talks to: `*.i.posthog.com` for ingestion, `*.posthog.com`
 * for assets and the toolbar, `*.posthog.io` for the legacy asset CDN.
 *
 * A regexp rather than a glob because it has to serve two jobs — matching a
 * route and classifying an observed request — and the two must not be able to
 * disagree about what counts.
 */
export const POSTHOG_URL_PATTERN = /^https?:\/\/[^/]*\bposthog\.(com|io)\b/i;

// ============================================================================
// Stubs
// ============================================================================

/**
 * Intercepts OpenStreetMap tiles and Nominatim geocoding.
 *
 * Two reasons, both of which have already cost this suite a red build.
 *
 * Determinism: `LocationPicker` debounces into a live Nominatim search, so
 * filling a location field opened a popover full of whatever that service
 * happened to return. That popover renders over the date pickers and swallowed
 * the click on the day cell, which is how trip creation timed out in
 * `pwa.spec.ts` with "…subtree intercepts pointer events".
 *
 * And courtesy: nobody wants a CI job hammering openstreetmap.org on every
 * push, least of all under its usage policy.
 *
 * Analytics is blocked here too — see {@link stubAnalyticsIngestion}. It is
 * folded into this call rather than left as a separate step every spec has to
 * remember, because the cost of forgetting it is data written to a live
 * project rather than a failing test.
 */
export async function stubExternalMapServices(page: Page): Promise<void> {
  await page.route('**/tile.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }),
  );
  await page.route('**/nominatim.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await stubAnalyticsIngestion(page);
}

/**
 * Stops any PostHog request from leaving the machine.
 *
 * The suite should never produce one: the Playwright web servers blank
 * `VITE_POSTHOG_KEY`, and `lib/posthog` refuses to initialise on localhost.
 * This is the third layer, and it exists because the first two were once absent
 * and the project filled up with anonymous people minted by browser contexts on
 * `127.0.0.1` — one per test run, against three real Supabase accounts.
 *
 * Fulfilled rather than aborted: an aborted request surfaces in the app as a
 * network error, which is a different thing from analytics being off, and this
 * helper must not change what the app under test sees.
 */
export async function stubAnalyticsIngestion(page: Page): Promise<void> {
  await page.route(POSTHOG_URL_PATTERN, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":1}' }),
  );
}

// ============================================================================
// Observation
// ============================================================================

/**
 * Records every PostHog URL the page attempts, so a spec can assert on the
 * empty list.
 *
 * Returns the live array: read it *after* the interaction under test, not
 * before. Attach this before {@link stubAnalyticsIngestion} or after — routing
 * fulfils a request but does not hide it from `page.on('request')`, so the
 * observation holds either way.
 */
export function recordAnalyticsRequests(page: Page): readonly string[] {
  const urls: string[] = [];
  page.on('request', (request: Request) => {
    const url = request.url();
    if (POSTHOG_URL_PATTERN.test(url)) {
      urls.push(url);
    }
  });
  return urls;
}
