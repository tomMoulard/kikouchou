/**
 * @fileoverview Shared browser-storage helpers for the E2E suite.
 *
 * @module e2e/support/storage
 */

import type { Page } from '@playwright/test';

/**
 * Deletes every IndexedDB database on the app's origin, for a clean slate.
 *
 * Navigates to the app first when the page is still on `about:blank`. A fresh
 * Playwright page starts there, and `about:blank` is an opaque origin with no
 * storage bucket at all — `indexedDB.databases()` throws
 * `SecurityError: Access to the IndexedDB API is denied in this context`
 * rather than returning an empty list. Callers that navigate themselves
 * afterwards are unaffected; this only rescues the ones that clear first.
 */
export async function clearIndexedDB(page: Page): Promise<void> {
  if (!page.url().startsWith('http')) {
    await page.goto('/');
  }

  await page.evaluate(async () => {
    const databases = await indexedDB.databases();
    for (const db of databases) {
      if (db.name) {
        indexedDB.deleteDatabase(db.name);
      }
    }
  });
}
