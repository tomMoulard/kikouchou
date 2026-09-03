/**
 * @fileoverview E2E Tests for Trip Sharing Flow
 * Covers the parts of sharing that do not need a backend:
 * - the share dialog in a build with no sync server configured
 * - importing a trip through the `/share/:shareId` welcome flow
 * - error handling for an unknown share id
 *
 * The account-backed invite — link, QR, redemption, identity, two-device sync —
 * lives in `trip-sharing-sync.spec.ts`, which runs against a stubbed backend.
 * It cannot be asserted here: this project deliberately has no Supabase
 * configuration, so there is nothing to mint an invite against.
 *
 * @module e2e/sharing
 */

import { test, expect, type Page } from '@playwright/test';
import { clearIndexedDB } from './support/storage';
import { waitForRoute } from './support/routes';

import { seedPerson, seedTrip, type SeededTrip } from './support/seed';

// ============================================================================
// Database Helpers
// ============================================================================

// ============================================================================
// Test Configuration
// ============================================================================

/**
 * Returns an ISO `yyyy-MM-dd` date `days` from today.
 * Fixtures are derived from today so the trip never drifts into the past —
 * a hard-coded 2026 date was already behind us by the time this ran.
 */
function isoDaysFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  // Read back the *local* fields. `toISOString()` would convert to UTC, which
  // shifts the date by a day either side of midnight and can turn a 10-day
  // span into 9 across a DST boundary.
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Test data constants for consistent test execution.
 */
const TEST_DATA = {
  trip: {
    name: 'Sharing Test Trip',
    location: 'Test Beach House',
    // Always in the future, relative to whenever the suite runs
    startDate: isoDaysFromToday(30),
    endDate: isoDaysFromToday(40),
  },
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Creates a new trip directly via IndexedDB for testing purposes.
 * Returns the trip ID and shareId from the created trip.
 */
async function createTestTrip(page: Page): Promise<SeededTrip> {
  return seedTrip(page, TEST_DATA.trip);
}

/**
 * Opens the share dialog for the current trip.
 * The share button is typically in the trip edit page or header.
 */
async function openShareDialog(page: Page): Promise<void> {
  // The share control lives on the trip card in the list, not on the trip's own
  // pages — the previous version of this helper looked on `/trips/:id/edit` and
  // `/trips/:id/calendar`, found nothing, and threw its own error, which is why
  // every caller wrapped it in a try/catch and passed regardless.
  //
  // Matched on `/share trip/i`: the list also carries an "Import a shared trip
  // using a QR code" button, and a looser pattern opens that instead.
  await page.goto('/');
  await page.getByRole('button', { name: /share trip/i }).first().click();
  await expect(page.getByRole('dialog', { name: /share/i })).toBeVisible({
    timeout: 10000,
  });
}

// ============================================================================
// Test Suite: Sharing Flow
// ============================================================================

test.describe('Sharing Flow', () => {
  // Clear IndexedDB before each test to ensure clean state
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearIndexedDB(page);
    await page.reload();
  });

  // --------------------------------------------------------------------------
  // The share dialog, in a build with no sync server
  // --------------------------------------------------------------------------

  /**
   * This project runs with `VITE_SUPABASE_*` blank, so there is no backend and
   * no link to hand out. That is the whole assertion: the dialog has to say so.
   *
   * The three tests that used to sit here asserted a `#share-url` input holding
   * a `/share/:shareId` link — a shape that no longer exists, since a share link
   * is now an account-backed `/join/:token` invite. Each was wrapped in a
   * try/catch that fell back to navigating to the share page, so all three
   * passed whether or not the dialog worked at all. The account-backed link, its
   * QR and the copy button are covered against a real backend in
   * `trip-sharing-sync.spec.ts`, which is the only place they can be tested
   * honestly.
   */
  test('says the trip cannot be shared when no sync server is configured', async ({
    page,
  }) => {
    await createTestTrip(page);

    await openShareDialog(page);

    const dialog = page.getByRole('dialog');
    // An explanation, not a spinner: this state has nothing to wait for.
    await expect(dialog.getByRole('alert')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('share-url')).toHaveCount(0);
  });

  // --------------------------------------------------------------------------
  // Test 4: Imports trip via share link
  // --------------------------------------------------------------------------
  test('imports trip via share link', async ({ page }) => {
    // Create a test trip and get its share ID
    const { shareId } = await createTestTrip(page);

    // Navigate to the share import page
    await page.goto(`/share/${shareId}`);
    await page.waitForLoadState('load');

    // Verify the share import page loads correctly
    // The ShareImportPage shows trip info in a card
    await expect(page.getByText(TEST_DATA.trip.name)).toBeVisible({ timeout: 10000 });

    // Verify location is displayed (if provided)
    await expect(page.getByText(TEST_DATA.trip.location)).toBeVisible();

    // The date range, which the comment here has always claimed to check and
    // never did. `formatDateRange` renders the end of the span as `d MMM yyyy`
    // whatever its shape, so that is what is looked for.
    const end = new Date(`${TEST_DATA.trip.endDate}T12:00:00`);
    const endLabel = `${end.getDate()} ${end.toLocaleString('en-US', {
      month: 'short',
    })} ${end.getFullYear()}`;
    await expect(page.getByText(endLabel, { exact: false })).toBeVisible();

    // Check for the trip invite message (use first() to avoid strict mode violation)
    const inviteMessage = page.getByText(/you've been invited|vous avez été invité/i).first();
    await expect(inviteMessage).toBeVisible();

    // Click the "View this trip" button
    const viewTripButton = page.getByRole('button', { name: /get started|commencer/i });
    await expect(viewTripButton).toBeVisible();
    await viewTripButton.click();

    // Into the onboarding wizard's identity step. The test used to expect
    // `/calendar`, which the CTA has not gone to since the wizard was added.
    await expect(page).toHaveURL(/\/share\/[^/]+\/identity/, { timeout: 10000 });

    // ...and the step has to actually be on screen. Asserting the URL alone is
    // what let the wizard ship broken: `/identity` matched for months while the
    // parent route rendered the welcome screen over it, because
    // `ShareImportPage` supplied `element` and never rendered an `<Outlet />`.
    await expect(
      page.getByText(/who are you|qui êtes-vous/i),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole('button', { name: /get started|commencer/i }),
    ).toHaveCount(0);
  });

  // --------------------------------------------------------------------------
  // The four onboarding steps, end to end
  // --------------------------------------------------------------------------

  /**
   * Walks a guest through identity → room → transport → summary.
   *
   * Every step is asserted on its own heading rather than on the URL: until the
   * parent route rendered an `<Outlet />`, all four URLs resolved and all four
   * screens rendered `ShareImportPage` instead.
   */
  test('walks a guest through all four onboarding steps', async ({ page }) => {
    const { tripId, shareId } = await createTestTrip(page);
    await seedPerson(page, tripId, 'Wizard Guest');

    // Step 1 — welcome
    await page.goto(`/share/${shareId}`);
    await waitForRoute(page);
    await page.getByRole('button', { name: /get started|commencer/i }).click();

    // Step 2 — identity: pick the seeded guest, then Next
    await expect(
      page.getByText(/who are you|qui êtes-vous/i),
    ).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Wizard Guest' }).click();
    await page.getByRole('button', { name: /^(next|suivant)$/i }).click();

    // Step 3 — rooms: none were seeded, so the empty state and Skip must show
    await expect(
      page.getByText(/pick your room|choisissez votre chambre/i),
    ).toBeVisible({ timeout: 10000 });
    await page
      .getByRole('button', { name: /skip for now|passer pour l'instant/i })
      .click();

    // Step 4 — transport: skip again
    await expect(
      page.getByText(/your travel details|vos détails de voyage/i),
    ).toBeVisible({ timeout: 10000 });
    await page
      .getByRole('button', { name: /skip for now|passer pour l'instant/i })
      .click();

    // Step 5 — summary
    await expect(
      page.getByText(/you.?re all set|vous êtes prêt/i),
    ).toBeVisible({ timeout: 10000 });
  });

  // --------------------------------------------------------------------------
  // Test 5: Shows not found for invalid share ID
  // --------------------------------------------------------------------------
  test('shows not found for invalid share ID', async ({ page }) => {
    // Generate a random invalid share ID
    const invalidShareId = 'invalid123456';

    // Navigate to the share import page with invalid ID
    await page.goto(`/share/${invalidShareId}`);
    await page.waitForLoadState('load');

    // Verify error message is displayed
    // The ShareImportPage shows an ErrorDisplay component for not found trips
    const notFoundText = page.getByText(/doesn't seem to work|ne semble pas fonctionner/i);
    await expect(notFoundText).toBeVisible({ timeout: 10000 });

    // Verify helpful description is shown
    const description = page.getByText(/may be incorrect|no longer exist|incorrect|n'existe plus/i);
    await expect(description).toBeVisible();

    // And it is a dead end, which is asserted rather than wished for.
    //
    // The comment here used to say "Verify there's a way to go back to trips
    // list" and then wrapped the check in `if (hasBackButton)`, so the test
    // passed whether or not one existed — and none does: `ShareImportPage`'s
    // not-found branch renders a bare card with no action, and the route is
    // registered outside `LayoutWrapper`, so there is no nav either. Pinned as
    // it actually is, so that giving this screen a way out is a deliberate
    // change to this assertion instead of a silent no-op.
    const wayBack = /trips|voyages|back|retour|home|accueil/i;
    await expect(page.getByRole('button', { name: wayBack })).toHaveCount(0);
    await expect(page.getByRole('link', { name: wayBack })).toHaveCount(0);
  });

  // --------------------------------------------------------------------------
  // Test 6: Share import page handles missing shareId gracefully
  // --------------------------------------------------------------------------
  test('handles missing shareId in URL gracefully', async ({ page }) => {
    // Navigate to share route without a shareId (edge case)
    // This should show the not found state
    await page.goto('/share/');
    await page.waitForLoadState('load');

    // `/share/` matches no route — a dynamic segment needs at least one
    // character — so the app's catch-all `ErrorPage` answers.
    //
    // The previous assertion was `getByText(/not.*found|introuvable|error|
    // erreur|404/i)`, which the word "error" anywhere on any screen satisfies.
    // What matters is which screen this is: not the share welcome, and not a
    // blank page.
    const main = page.locator('main');
    await expect(
      main.getByText(/an error occurred|something went wrong|page not found/i),
    ).toBeVisible({ timeout: 10000 });
    // Its two actions are what make it the catch-all rather than any other
    // screen, and neither of them is the share welcome's CTA.
    await expect(main.getByRole('button', { name: /retry/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /get started/i })).toHaveCount(0);

    // ...and unlike the not-found share screen above, this one is not a dead
    // end. The way home has to actually go home.
    await main.getByRole('button', { name: /my trips/i }).click();
    await expect(page).toHaveURL(/\/trips$/, { timeout: 10000 });
    await expect(
      page.getByRole('heading', { name: /my trips/i }),
    ).toBeVisible({ timeout: 10000 });
  });

  // --------------------------------------------------------------------------
  // Test 7: Share link works after page reload
  // --------------------------------------------------------------------------
  test('share link works after page reload', async ({ page }) => {
    // Create a test trip
    const { shareId } = await createTestTrip(page);

    // Navigate to share import page
    await page.goto(`/share/${shareId}`);
    await page.waitForLoadState('load');

    // Verify initial load
    await expect(page.getByText(TEST_DATA.trip.name)).toBeVisible({ timeout: 10000 });

    // Reload the page
    await page.reload();
    await page.waitForLoadState('load');

    // Verify trip info still displays correctly after reload
    await expect(page.getByText(TEST_DATA.trip.name)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(TEST_DATA.trip.location)).toBeVisible();
  });
});

// ============================================================================
// Cleanup
// ============================================================================

test.afterAll(async () => {
  // Tests use local IndexedDB which is isolated per browser context
  // No explicit cleanup needed
});
