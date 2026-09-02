/**
 * @fileoverview Navigation helpers for the E2E suite.
 *
 * @module e2e/support/routes
 */

import { expect, type Page } from '@playwright/test';

/**
 * Waits for a lazily-loaded route to replace the "Loading..." fallback.
 *
 * `page.waitForLoadState('load')` is not enough on its own: every route in this
 * app is a lazy chunk, so `load` fires while `main` still holds the suspense
 * fallback. Anything read at that moment — `page.content()`, `.count()`,
 * `.isVisible()`, a `page.evaluate` querying the DOM — sees an empty page and
 * reports the feature missing rather than waiting for it to arrive.
 */
export async function waitForRoute(page: Page): Promise<void> {
  await expect(page.getByRole('status').filter({ hasText: /loading/i })).toHaveCount(0, {
    timeout: 15_000,
  });
}
