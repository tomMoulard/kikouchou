/**
 * @fileoverview Route stubs for the third-party services the app talks to.
 *
 * @module e2e/support/external-services
 */

import type { Page } from '@playwright/test';

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
 */
export async function stubExternalMapServices(page: Page): Promise<void> {
  await page.route('**/tile.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }),
  );
  await page.route('**/nominatim.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}
