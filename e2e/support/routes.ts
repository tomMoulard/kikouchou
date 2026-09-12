/**
 * @fileoverview Navigation helpers for the E2E suite.
 *
 * @module e2e/support/routes
 */

import { expect, type Page } from '@playwright/test';

/**
 * How long a lazy chunk gets before the wait is called a failure.
 *
 * Long enough for a cold dev server under parallel load — the calendar and
 * rooms chunks are the heaviest in the app, and several workers compiling them
 * at once have been measured still showing the fallback at 15 s — and finite,
 * so that a route which never resolves fails the test instead of being read as
 * an empty page. Callers with a tighter budget pass their own.
 */
const DEFAULT_ROUTE_TIMEOUT_MS = 30_000;

/**
 * Waits for a lazily-loaded route to replace the "Loading..." fallback.
 *
 * `page.waitForLoadState('load')` is not enough on its own: every route in this
 * app is a lazy chunk, so `load` fires while `main` still holds the suspense
 * fallback. Anything read at that moment — `page.content()`, `.count()`,
 * `.isVisible()`, a `page.evaluate` querying the DOM — sees an empty page and
 * reports the feature missing rather than waiting for it to arrive.
 *
 * @param page - Playwright page object
 * @param timeout - Milliseconds to wait. Never pass `0`: an unbounded wait is
 *   the same vacuous pass a swallowed timeout used to produce.
 */
export async function waitForRoute(
  page: Page,
  timeout = DEFAULT_ROUTE_TIMEOUT_MS,
): Promise<void> {
  await expect(page.getByRole('status').filter({ hasText: /loading/i })).toHaveCount(0, {
    timeout,
  });
}
