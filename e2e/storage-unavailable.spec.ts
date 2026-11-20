/**
 * @fileoverview E2E cover for a browser that will not open IndexedDB at all.
 *
 * PostHog issues 01a1f8f9-ce46 and 01a1f8f9-ce44 (Samsung Internet 23,
 * Android 8, 2026-11-20): `indexedDB.open` threw `UnknownError: Internal
 * error.` on every try, the reopen included. Boot logged both failures as
 * errors and rendered the app on defaults, where every page failed to load.
 * This spec makes `indexedDB.open` throw before any script of the page runs,
 * with the sample trip turned on so the seed fails too, as on a real first
 * open, and asserts the page explains the problem instead.
 *
 * @module e2e/storage-unavailable
 */

import { expect, test } from '@playwright/test';

// ============================================================================
// Tests
// ============================================================================

test.describe('IndexedDB unavailable', () => {
  test('explains that the browser cannot store data, instead of a broken app', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });
    await page.addInitScript(() => {
      // Automation turns the sample trip off (navigator.webdriver); the
      // production session was a first open, where the seed failed first.
      localStorage.setItem('kikouchou-sample-trip', 'on');
      Object.defineProperty(IDBFactory.prototype, 'open', {
        configurable: true,
        value: () => {
          throw new DOMException('Internal error.', 'UnknownError');
        },
      });
    });

    await page.goto('/');

    await expect(
      page.getByRole('heading', {
        name: /this browser cannot store data here|ce navigateur ne peut pas enregistrer de données ici/i,
      }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /^(retry|réessayer)$/i })).toBeVisible();
    await expect(page.getByText(/failed to load|échec du chargement/i)).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
});
