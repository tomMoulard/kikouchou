/**
 * @fileoverview Service-worker readiness helpers for the E2E suite.
 *
 * @module e2e/support/service-worker
 */

import { expect, type Page } from '@playwright/test';

/** How long to give a service worker to install, activate and precache. */
const SW_READY_TIMEOUT = 30_000;

/**
 * Waits until the page has a service worker registration whose active worker
 * has reached the `activated` state.
 *
 * Two traps here, both of which this suite had fallen into.
 *
 * `navigator.serviceWorker.ready` and `waitForLoadState('load')` both resolve
 * while the worker is still `activating`: polling the registration right after
 * load measured `active: null` at t=0 and `active: "activated"` by t=250 ms.
 * Reading the state once in that window is what made `pwa.spec.ts` fail with
 * `Expected "activated", Received "activating"`.
 *
 * And the obvious guard against that — `page.waitForFunction` over an async
 * predicate — does not work: Playwright does not await a promise returned by
 * the predicate, and a pending Promise is truthy, so the wait returns on its
 * first poll having asserted nothing. Measured at 17 ms for a predicate that
 * resolves `false` forever. `expect.poll` runs the callback in Node and does
 * await it, so the condition is actually waited on.
 */
export async function waitForActivatedServiceWorker(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          if (!('serviceWorker' in navigator)) {
            return false;
          }
          const registrations = await navigator.serviceWorker.getRegistrations();
          return registrations.some(
            (registration) => registration.active?.state === 'activated',
          );
        }),
      { timeout: SW_READY_TIMEOUT },
    )
    .toBe(true);
}

/**
 * Waits until the precache holds the navigation fallback.
 *
 * Controlling the page is not the same as being ready to serve it: the worker
 * has ~2.5 MB to precache, and an offline reload before `index.html` lands in a
 * cache fails with ERR_INTERNET_DISCONNECTED.
 */
export async function waitForPrecachedAppShell(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          if (!('caches' in window)) {
            return false;
          }
          for (const name of await caches.keys()) {
            const cache = await caches.open(name);
            const keys = await cache.keys();
            if (keys.some((request) => request.url.includes('index.html'))) {
              return true;
            }
          }
          return false;
        }),
      { timeout: SW_READY_TIMEOUT },
    )
    .toBe(true);
}
