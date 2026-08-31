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

// ============================================================================
// Database Helpers
// ============================================================================

/**
 * Clears IndexedDB to ensure a clean state before each test.
 */
async function clearIndexedDB(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const databases = await indexedDB.databases();
    for (const db of databases) {
      if (db.name) {
        indexedDB.deleteDatabase(db.name);
      }
    }
  });
}

// ============================================================================
// Test Configuration
// ============================================================================

/**
 * Test data constants for consistent test execution
 */
const TEST_DATA = {
  trip: {
    name: 'Sharing Test Trip',
    location: 'Test Beach House',
    // Using dates in the future to avoid date-related issues
    startDate: '2026-06-01',
    endDate: '2026-06-10',
  },
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Creates a new trip directly via IndexedDB for testing purposes.
 * Returns the trip ID and shareId from the created trip.
 */
async function createTestTrip(page: Page): Promise<{ tripId: string; shareId: string }> {
  // Navigate to trips page to ensure the database is initialized
  await page.goto('/trips');
  await page.waitForLoadState('load');

  // Create trip directly in IndexedDB
  const { tripId, shareId } = await page.evaluate(
    async ({ startDate, endDate, name, location }) => {
      const id = `share-trip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const shareId = `share-${Math.random().toString(36).substr(2, 10)}`;
      const now = Date.now();

      return new Promise<{ tripId: string; shareId: string }>((resolve, reject) => {
        const dbRequest = indexedDB.open('kikoushou');
        dbRequest.onerror = () => reject(new Error('Failed to open database'));
        dbRequest.onsuccess = () => {
          const db = dbRequest.result;
          const tx = db.transaction('trips', 'readwrite');
          const store = tx.objectStore('trips');

          const trip = {
            id,
            shareId,
            name,
            location,
            startDate,
            endDate,
            createdAt: now,
            updatedAt: now,
          };

          store.add(trip);

          tx.oncomplete = () => {
            db.close();
            resolve({ tripId: id, shareId });
          };
          tx.onerror = () => {
            db.close();
            reject(new Error('Failed to create trip'));
          };
        };
      });
    },
    {
      startDate: TEST_DATA.trip.startDate,
      endDate: TEST_DATA.trip.endDate,
      name: TEST_DATA.trip.name,
      location: TEST_DATA.trip.location,
    },
  );

  expect(tripId).toBeTruthy();

  expect(shareId).toBeTruthy();

  return { tripId, shareId };
}

/**
 * Opens the share dialog for the current trip.
 * The share button is typically in the trip edit page or header.
 */
async function openShareDialog(page: Page, tripId: string): Promise<void> {
  // Navigate to the trip edit page where share functionality is typically available
  await page.goto(`/trips/${tripId}/edit`);
  await page.waitForLoadState('load');

  // Look for a share button - it might be in the header or as a separate action
  // The ShareDialog is a standalone component, so we need to find where it's triggered
  // Based on the codebase analysis, it seems the share dialog might be opened via a share button
  
  // First, check if there's a share button on the edit page
  const shareButton = page.getByRole('button', { name: /share|partager/i });
  
  if (await shareButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await shareButton.click();
  } else {
    // If no share button on edit page, try the calendar page header
    await page.goto(`/trips/${tripId}/calendar`);
    await page.waitForLoadState('load');
    
    // Look for share button in the page header or actions
    const calendarShareButton = page.getByRole('button', { name: /share|partager/i });
    if (await calendarShareButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await calendarShareButton.click();
    } else {
      // As a fallback, we'll directly test the share URL construction
      // The ShareDialog component uses the trip's shareId to construct URLs
      // This test will verify the URL format is correct by navigating to the share import page
      throw new Error('Share button not found - ShareDialog may not be integrated yet');
    }
  }

  // Wait for the share dialog to open
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
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
    const { tripId } = await createTestTrip(page);

    await openShareDialog(page, tripId);

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

    // Verify date range is displayed
    // The page formats dates using date-fns with localized format
    // Check for the trip invite message (use first() to avoid strict mode violation)
    const inviteMessage = page.getByText(/you've been invited|vous avez été invité/i).first();
    await expect(inviteMessage).toBeVisible();

    // Click the "View this trip" button
    const viewTripButton = page.getByRole('button', { name: /view.*trip|voir.*voyage/i });
    await expect(viewTripButton).toBeVisible();
    await viewTripButton.click();

    // Verify navigation to the calendar page
    await expect(page).toHaveURL(/\/calendar/, { timeout: 10000 });

    // Verify the trip is now set as current (calendar should show the trip)
    // The calendar page shows the trip name in the header (use first() to handle multiple matches)
    await expect(page.getByText(TEST_DATA.trip.name).first()).toBeVisible({ timeout: 5000 });
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
    const notFoundText = page.getByText(/not.*found|introuvable|could not be found/i);
    await expect(notFoundText).toBeVisible({ timeout: 10000 });

    // Verify helpful description is shown
    const description = page.getByText(/expired|deleted|expiré|supprimé/i);
    await expect(description).toBeVisible();

    // Verify there's a way to go back to trips list
    const backButton = page.getByRole('button', { name: /trips|voyages|back|retour/i });
    const hasBackButton = await backButton.isVisible({ timeout: 2000 }).catch(() => false);
    
    if (hasBackButton) {
      await backButton.click();
      await expect(page).toHaveURL('/trips', { timeout: 5000 });
    }
  });

  // --------------------------------------------------------------------------
  // Test 6: Share import page handles missing shareId gracefully
  // --------------------------------------------------------------------------
  test('handles missing shareId in URL gracefully', async ({ page }) => {
    // Navigate to share route without a shareId (edge case)
    // This should show the not found state
    await page.goto('/share/');
    await page.waitForLoadState('load');

    // Should show error state or redirect
    // The router might redirect to 404 or show an error
    const notFoundIndicator = page.getByText(/not.*found|introuvable|error|erreur|404/i);
    await expect(notFoundIndicator).toBeVisible({ timeout: 10000 });
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
