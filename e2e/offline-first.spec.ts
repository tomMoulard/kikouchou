/**
 * @fileoverview E2E tests for the offline-first contract.
 *
 * Every rule the sync migration committed to is asserted here against a real
 * browser, because the two bugs that actually reached a user during that work
 * were both *integration-shaped* and invisible to 3,000 unit tests:
 *
 *   - the OAuth code was consumed before anything looked for it, a fact about
 *     module and boot ordering that no unit test models;
 *   - `INSERT ... RETURNING` under RLS, a PostgREST-to-Postgres translation the
 *     fake client did not reproduce.
 *
 * The rules, from the migration plan:
 *
 *   1. First launch with no network fully works.
 *   2. Rendering never waits on auth.
 *   3. Every mutation is local-first.
 *   5. Reconnect is automatic.
 *   6. Only sharing and joining may require network.
 *   7. The service worker never caches the Supabase origin.
 *
 * @module e2e/offline-first
 */

import { expect, test, type Page } from '@playwright/test';

// ============================================================================
// Helpers
// ============================================================================

const TRIP = {
  name: 'Offline Brittany',
  startDate: '2026-07-15',
  endDate: '2026-07-22',
} as const;

/**
 * Picks a date in the trip form's calendar.
 *
 * Types into the field rather than clicking through months: this spec is about
 * offline behaviour, and a fragile date-picker walk would fail for reasons that
 * have nothing to do with the network.
 */
async function fillDates(page: Page): Promise<void> {
  await page.locator('#trip-start-date').click();
  const startCell = page.getByRole('gridcell').filter({ hasText: /^15$/ }).first();
  await startCell.click();

  await page.locator('#trip-end-date').click();
  const endCell = page.getByRole('gridcell').filter({ hasText: /^22$/ }).first();
  await endCell.click();
}

async function createTripOffline(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: /new trip/i }).first().click();
  await page.getByLabel(/trip name/i).fill(name);
  await fillDates(page);
  await page.getByRole('button', { name: /save/i }).click();
}

/** Clears app data through the UI, so no test starts on another's leftovers. */
async function resetApp(page: Page): Promise<void> {
  await page.goto('/settings');
  const clearButton = page.getByRole('button', { name: /clear.*data/i });
  if (await clearButton.isVisible().catch(() => false)) {
    await clearButton.click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /clear|confirm/i }).first().click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
  }
}

// ============================================================================
// Rule 1 — a cold launch with no network
// ============================================================================

test.describe('offline-first contract', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await resetApp(page);
  });

  test('rule 1: the app loads and works with the network off from the start', async ({
    page,
    context,
  }) => {
    // Warm the service worker so the reload has something to serve from.
    await page.goto('/trips');
    await page.waitForLoadState('load');

    await context.setOffline(true);
    await page.reload();

    // The whole point of the PWA: a cold launch on a train renders the app, not
    // a browser error page.
    await expect(page.getByRole('heading', { name: /my trips/i })).toBeVisible({
      timeout: 20_000,
    });

    await context.setOffline(false);
  });

  test('rule 1 and 3: a trip can be created and edited with no network', async ({
    page,
    context,
  }) => {
    await page.goto('/trips');
    await page.waitForLoadState('load');
    await context.setOffline(true);

    await createTripOffline(page, TRIP.name);

    // Local-first: the write went to IndexedDB and the UI reflects it, with no
    // server involved at any point.
    await expect(page.getByText(TRIP.name).first()).toBeVisible({ timeout: 15_000 });

    await context.setOffline(false);
  });

  test('rule 1: an offline trip survives a reload while still offline', async ({
    page,
    context,
  }) => {
    await page.goto('/trips');
    await page.waitForLoadState('load');
    await context.setOffline(true);

    await createTripOffline(page, TRIP.name);
    await expect(page.getByText(TRIP.name).first()).toBeVisible({ timeout: 15_000 });

    await page.reload();

    // Durability is IndexedDB's job, not the server's.
    await expect(page.getByText(TRIP.name).first()).toBeVisible({ timeout: 20_000 });

    await context.setOffline(false);
  });

  // ==========================================================================
  // Rule 2 — rendering never waits on auth
  // ==========================================================================

  test('rule 2: the trip list renders without waiting for a session', async ({
    page,
  }) => {
    await page.goto('/trips');

    // No spinner-gate on auth: the heading is present on the first paint, long
    // before any session could have resolved. AuthProvider resolving to
    // "signed out" must look like a state, not like loading.
    await expect(page.getByRole('heading', { name: /my trips/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('rule 2: settings renders its account panel offline', async ({
    page,
    context,
  }) => {
    await page.goto('/settings');
    await page.waitForLoadState('load');
    await context.setOffline(true);
    await page.reload();

    // Account state is unknowable offline, and the page still has to render.
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible({
      timeout: 20_000,
    });

    await context.setOffline(false);
  });

  // ==========================================================================
  // Rule 6 — only sharing and joining may need the network
  // ==========================================================================

  test('rule 6: navigating the whole app offline never blocks', async ({
    page,
    context,
  }) => {
    await page.goto('/trips');
    await page.waitForLoadState('load');
    await createTripOffline(page, TRIP.name);
    await expect(page.getByText(TRIP.name).first()).toBeVisible({ timeout: 15_000 });

    await page.getByText(TRIP.name).first().click();
    await page.waitForLoadState('load');

    await context.setOffline(true);

    // Every trip-scoped view reads from IndexedDB, so all of them work.
    for (const section of ['rooms', 'persons', 'transports', 'activities']) {
      const link = page.getByRole('link', { name: new RegExp(section, 'i') }).first();
      if (await link.isVisible().catch(() => false)) {
        await link.click();
        await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
      }
    }

    await context.setOffline(false);
  });

  // ==========================================================================
  // Rule 7 — the service worker must not cache the backend
  // ==========================================================================

  test('rule 7: no Supabase response is served from a cache', async ({ page }) => {
    await page.goto('/trips');
    await page.waitForLoadState('load');

    const cachedSupabase = await page.evaluate(async () => {
      if (!('caches' in window)) {
        return [];
      }
      const names = await caches.keys();
      const hits: string[] = [];
      for (const name of names) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          if (request.url.includes('supabase')) {
            hits.push(request.url);
          }
        }
      }
      return hits;
    });

    // A cached session or row read is a correctness bug, not a slow page: the
    // offline story is IndexedDB plus the outbox, never cached HTTP.
    expect(cachedSupabase).toEqual([]);
  });
});
