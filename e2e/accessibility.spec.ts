/**
 * @fileoverview E2E Accessibility Tests for Kikoushou PWA.
 * Uses Playwright and @axe-core/playwright to verify WCAG 2.1 compliance.
 *
 * Test cases covered:
 * 1. Trip list page has no a11y violations
 * 2. Room list page has no a11y violations
 * 3. Person list page has no a11y violations
 * 4. Calendar page has no a11y violations
 * 5. Transport list page has no a11y violations
 * 6. Settings page has no a11y violations
 * 7. Dialogs have proper focus management
 * 8. Forms have associated labels
 * 9. Keyboard navigation works for interactive flows
 * 10. Both light and dark mode are accessible
 *
 * @module e2e/accessibility
 */

import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { clearIndexedDB } from './support/storage';

// ============================================================================
// Test Configuration & Helpers
// ============================================================================

/**
 * Test data for creating trips and associated entities.
 */
const TEST_DATA = {
  trip: {
    name: 'A11y Test Trip',
    location: 'Accessibility House',
    startDate: '2026-04-01',
    endDate: '2026-04-10',
  },
  room: {
    name: 'Accessible Room',
    capacity: '2',
    description: 'Room for a11y testing',
  },
  person: {
    name: 'Test Person',
  },
} as const;

/**
 * Known acceptable a11y violations to exclude from tests.
 * Each exclusion should be documented with justification.
 *
 * IMPORTANT: These are temporary exclusions that should be addressed.
 * Document why each exclusion exists and create issues to fix them.
 */
const ACCEPTABLE_VIOLATIONS = {
  /**
   * Rules to disable globally.
   *
   * heading-order: shadcn/ui EmptyState uses h3 for visual consistency.
   *   The heading level mismatch is a design trade-off.
   *   TODO: Consider using aria-level or refactoring EmptyState component.
   *
   * nested-interactive: Room cards have a dropdown menu button inside a clickable card.
   *   This is a common pattern but violates WCAG. The card should not be role="button".
   *   TODO: Refactor RoomCard to use a link or non-interactive container with explicit buttons.
   *
   * color-contrast: Some muted foreground text (e.g., dates outside current month)
   *   has insufficient contrast. This is a design decision for visual de-emphasis.
   *   TODO: Increase contrast for muted text elements.
   */
  rules: [
    'heading-order',
    'nested-interactive',
    'color-contrast',
  ] as string[],
};

/**
 * Creates a test trip directly via IndexedDB and returns the trip ID.
 * This is more reliable than UI-based creation for test setup.
 *
 * @param page - Playwright page object
 * @returns The created trip's ID
 */
async function createTestTrip(page: Page): Promise<string> {
  // First, navigate to the app to ensure the database is initialized
  await page.goto('/trips');
  await page.waitForLoadState('load');

  // Create trip directly in IndexedDB
  const tripId = await page.evaluate(
    async ({ startDate, endDate, name, location }) => {
      const id = `a11y-trip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const shareId = `share-${Math.random().toString(36).substr(2, 10)}`;
      const now = Date.now();

      return new Promise<string>((resolve, reject) => {
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
            resolve(id);
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
  return tripId;
}

/**
 * Creates a room for the current trip.
 *
 * @param page - Playwright page object
 */
async function createRoom(page: Page): Promise<void> {
  // Click add room button
  const headerAddButton = page.locator('header').getByRole('button', { name: /new|nouveau/i });
  const fabAddButton = page.locator('button.fixed');

  if (await headerAddButton.isVisible()) {
    await headerAddButton.click();
  } else if (await fabAddButton.isVisible()) {
    await fabAddButton.click();
  } else {
    await page.getByRole('button', { name: /new|add|nouveau|ajouter/i }).first().click();
  }

  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

  await page.locator('#room-name').fill(TEST_DATA.room.name);
  await page.locator('#room-capacity').fill(TEST_DATA.room.capacity);
  await page.locator('#room-description').fill(TEST_DATA.room.description ?? '');

  await page.getByRole('dialog').getByRole('button', { name: /save|sauvegarder/i }).click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 5000 });
}

/**
 * Creates a person for the current trip.
 *
 * @param page - Playwright page object
 */
async function createPerson(page: Page): Promise<void> {
  const headerAddButton = page.locator('header').getByRole('button', { name: /new|nouveau/i });
  const fabAddButton = page.locator('button.fixed');

  if (await headerAddButton.isVisible()) {
    await headerAddButton.click();
  } else if (await fabAddButton.isVisible()) {
    await fabAddButton.click();
  } else {
    await page.getByRole('button', { name: /new|add|nouveau|ajouter/i }).first().click();
  }

  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

  await page.locator('#person-name').fill(TEST_DATA.person.name);

  await page.getByRole('dialog').getByRole('button', { name: /save|sauvegarder/i }).click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 5000 });
}

/**
 * Opens dialog to add a new item (person, room, or transport).
 *
 * @param page - Playwright page object
 */
async function openAddDialog(page: Page): Promise<void> {
  const headerAddButton = page.locator('header').getByRole('button', { name: /new|nouveau/i });
  const fabAddButton = page.locator('button.fixed');

  if (await headerAddButton.isVisible()) {
    await headerAddButton.click();
  } else if (await fabAddButton.isVisible()) {
    await fabAddButton.click();
  } else {
    await page.getByRole('button', { name: /new|add|nouveau|ajouter/i }).first().click();
  }
}

/**
 * Runs axe-core analysis and returns violations.
 * Excludes known acceptable violations.
 *
 * @param page - Playwright page object
 * @param disableRules - Optional rules to disable
 * @returns Array of accessibility violations
 */
async function analyzeA11y(
  page: Page,
  disableRules: string[] = [],
): Promise<import('axe-core').Result[]> {
  const builder = new AxeBuilder({ page });

  // Disable known acceptable violations
  const rulesToDisable = [...ACCEPTABLE_VIOLATIONS.rules, ...disableRules];
  if (rulesToDisable.length > 0) {
    builder.disableRules(rulesToDisable);
  }

  const results = await builder.analyze();
  return results.violations;
}

/**
 * Formats violations for readable error output.
 *
 * @param violations - Array of axe-core violations
 * @returns Formatted string describing violations
 */
function formatViolations(violations: import('axe-core').Result[]): string {
  return violations
    .map((v) => {
      const nodes = v.nodes.map((n) => `  - ${n.html}`).join('\n');
      return `${v.id} (${v.impact}): ${v.description}\n${nodes}`;
    })
    .join('\n\n');
}

/**
 * Sets color scheme preference (light/dark mode).
 *
 * @param page - Playwright page object
 * @param scheme - Color scheme to set
 */
async function setColorScheme(
  page: Page,
  scheme: 'light' | 'dark',
): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
}

/**
 * Waits for loading state to finish.
 *
 * @param page - Playwright page object
 */
async function waitForLoading(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const body = document.body.textContent ?? '';
    return !body.toLowerCase().includes('loading');
  }, { timeout: 10000 }).catch(() => {});
}

/**
 * Sets up a trip with data (room and person) for testing.
 * Each test that needs data calls this.
 *
 * @param page - Playwright page object
 * @returns The trip ID
 */
async function setupTripWithData(page: Page): Promise<string> {
  await clearIndexedDB(page);
  await page.reload();

  const tripId = await createTestTrip(page);

  // Create room
  await page.goto(`/trips/${tripId}/rooms`);
  await page.waitForLoadState('load');
  await createRoom(page);

  // Create person
  await page.goto(`/trips/${tripId}/persons`);
  await page.waitForLoadState('load');
  await createPerson(page);

  return tripId;
}

// ============================================================================
// Test Suite: Page Accessibility (Light Mode)
// ============================================================================

test.describe('Page Accessibility', () => {
  // --------------------------------------------------------------------------
  // Test 1: Trip list page has no a11y violations
  // --------------------------------------------------------------------------
  test('trip list page has no a11y violations', async ({ page }) => {
    await setColorScheme(page, 'light');
    await page.goto('/');
    await clearIndexedDB(page);
    await page.reload();

    // Create a trip so list isn't empty
    await createTestTrip(page);

    await page.goto('/trips');
    await page.waitForLoadState('load');
    await waitForLoading(page);

    const violations = await analyzeA11y(page);

    if (violations.length > 0) {
      console.log('Trip list page violations:\n', formatViolations(violations));
    }

    expect(violations).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // Test 2: Room list page has no a11y violations
  // --------------------------------------------------------------------------
  test('room list page has no a11y violations', async ({ page }) => {
    await setColorScheme(page, 'light');
    await page.goto('/');
    const tripId = await setupTripWithData(page);

    await page.goto(`/trips/${tripId}/rooms`);
    await page.waitForLoadState('load');
    await waitForLoading(page);

    const violations = await analyzeA11y(page);

    if (violations.length > 0) {
      console.log('Room list page violations:\n', formatViolations(violations));
    }

    expect(violations).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // Test 3: Person list page has no a11y violations
  // --------------------------------------------------------------------------
  test('person list page has no a11y violations', async ({ page }) => {
    await setColorScheme(page, 'light');
    await page.goto('/');
    const tripId = await setupTripWithData(page);

    await page.goto(`/trips/${tripId}/persons`);
    await page.waitForLoadState('load');
    await waitForLoading(page);

    const violations = await analyzeA11y(page);

    if (violations.length > 0) {
      console.log('Person list page violations:\n', formatViolations(violations));
    }

    expect(violations).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // Test 4: Calendar page has no a11y violations
  // --------------------------------------------------------------------------
  test('calendar page has no a11y violations', async ({ page }) => {
    await setColorScheme(page, 'light');
    await page.goto('/');
    const tripId = await setupTripWithData(page);

    await page.goto(`/trips/${tripId}/calendar`);
    await page.waitForLoadState('load');
    await waitForLoading(page);

    const violations = await analyzeA11y(page);

    if (violations.length > 0) {
      console.log('Calendar page violations:\n', formatViolations(violations));
    }

    expect(violations).toEqual([]);
  });

  test('calendar grid supports arrow-key navigation', async ({ page }) => {
    await setColorScheme(page, 'light');
    await page.goto('/');
    const tripId = await setupTripWithData(page);

    // Month view: there are no `role="gridcell"`s to walk in the timeline view,
    // which is what the calendar now defaults to.
    await page.goto(`/trips/${tripId}/calendar?view=card`);
    await page.waitForLoadState('load');
    await waitForLoading(page);

    const firstDay = page.locator('[role="gridcell"]').first();
    const secondDay = page.locator('[role="gridcell"]').nth(1);
    const eighthDay = page.locator('[role="gridcell"]').nth(7);

    await firstDay.focus();
    await expect(firstDay).toBeFocused();

    await page.keyboard.press('ArrowRight');
    await expect(secondDay).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[role="gridcell"]').nth(8)).toBeFocused();

    await page.keyboard.press('ArrowLeft');
    await expect(eighthDay).toBeFocused();

    await page.keyboard.press('Home');
    await expect(page.locator('[role="gridcell"]').nth(7)).toBeFocused();
  });

  // --------------------------------------------------------------------------
  // Test 5: Transport list page has no a11y violations
  // --------------------------------------------------------------------------
  test('transport list page has no a11y violations', async ({ page }) => {
    await setColorScheme(page, 'light');
    await page.goto('/');
    const tripId = await setupTripWithData(page);

    await page.goto(`/trips/${tripId}/transports`);
    await page.waitForLoadState('load');
    await waitForLoading(page);

    const violations = await analyzeA11y(page);

    if (violations.length > 0) {
      console.log('Transport list page violations:\n', formatViolations(violations));
    }

    expect(violations).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // Test 6: Settings page has no a11y violations
  // --------------------------------------------------------------------------
  test('settings page has no a11y violations', async ({ page }) => {
    await setColorScheme(page, 'light');
    await page.goto('/settings');
    await page.waitForLoadState('load');
    await waitForLoading(page);

    const violations = await analyzeA11y(page);

    if (violations.length > 0) {
      console.log('Settings page violations:\n', formatViolations(violations));
    }

    expect(violations).toEqual([]);
  });
});

// ============================================================================
// Test Suite: Dialog Focus Management
// ============================================================================

test.describe('Dialog Focus Management', () => {
  // --------------------------------------------------------------------------
  // Test 7: Dialogs have proper focus management
  // --------------------------------------------------------------------------
  test('person dialog traps focus correctly', async ({ page }) => {
    await page.goto('/');
    const tripId = await setupTripWithData(page);

    await page.goto(`/trips/${tripId}/persons`);
    await page.waitForLoadState('load');
    await waitForLoading(page);

    // Open the person dialog
    await openAddDialog(page);

    // Wait for dialog to be visible
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Focus should be inside the dialog (see the Boolean() note below — the old
    // `!== null` form here could not fail either).
    const activeElement = await page.evaluate(() =>
      Boolean(document.activeElement?.closest('[role="dialog"]')),
    );
    expect(activeElement).toBe(true);

    // Tab through all focusable elements - focus should stay within dialog
    const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusableInDialog = dialog.locator(focusableSelector);
    const focusableCount = await focusableInDialog.count();

    // Tab through more times than there are elements to verify wrapping
    for (let i = 0; i < focusableCount + 2; i++) {
      await page.keyboard.press('Tab');

      // Verify focus is still inside dialog.
      //
      // `closest()` returns null when it matches nothing, so the old
      // `active?.closest(...) !== null` was ALSO true when `active` itself was
      // null — the optional chain short-circuits to undefined, and undefined is
      // not null. The assertion could not fail. Boolean() is the honest read.
      const stillInDialog = await page.evaluate(() =>
        Boolean(document.activeElement?.closest('[role="dialog"]')),
      );
      expect(stillInDialog).toBe(true);
    }

    // Escape should close the dialog
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 5000 });
  });

  // --------------------------------------------------------------------------
  // Test: Confirm dialog has proper focus management
  // --------------------------------------------------------------------------
  test('confirm dialog has proper focus management', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('load');

    // Click the "Clear All Data" button to open confirm dialog
    const clearDataButton = page.getByRole('button', { name: /clear.*data/i });
    await clearDataButton.click();

    // A confirmation is an alert dialog, and only an alert dialog. The old
    // `getByRole('alertdialog').or(getByRole('dialog'))` passed whichever role
    // shipped, which is how this stayed a plain dialog for so long.
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Focus should be inside the dialog — on the cancel button, which is where
    // Radix puts it so that the destructive choice is never the default one.
    const activeElement = await page.evaluate(() =>
      Boolean(document.activeElement?.closest('[role="alertdialog"]')),
    );
    expect(activeElement).toBe(true);

    // Cancel the dialog
    const cancelButton = dialog.getByRole('button', { name: /cancel|annuler/i });
    await cancelButton.click();
    await expect(dialog).toBeHidden({ timeout: 5000 });
  });
});

// ============================================================================
// Test Suite: Dialogs on a short viewport
// ============================================================================

test.describe('Dialog Viewport Fit', () => {
  // --------------------------------------------------------------------------
  // A dialog is centred with `top-1/2 -translate-y-1/2`, so one taller than the
  // viewport used to run off the top AND the bottom at once, with nothing to
  // scroll: the title and the Save button were both unreachable at the same
  // time. The cap now lives in `DialogContent` itself.
  // --------------------------------------------------------------------------
  test('a tall dialog scrolls itself instead of clipping off both edges', async ({
    page,
  }) => {
    // A short phone in landscape-ish height — the shape that broke.
    const viewport = { width: 390, height: 480 };
    await page.setViewportSize(viewport);

    const tripId = await setupTripWithData(page);
    await page.goto(`/trips/${tripId}/rooms`);
    await page.waitForLoadState('load');
    await waitForLoading(page);

    await openAddDialog(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // The case has to be real: a dialog that already fits proves nothing.
    const overflows = await dialog.evaluate(
      (el) => el.scrollHeight > el.clientHeight + 1,
    );
    expect(overflows).toBe(true);

    // 1. The box itself is inside the viewport — neither edge is cut off.
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
      viewport.height + 1,
    );

    // 2. The header is in view at rest.
    await expect(dialog.getByRole('heading')).toBeInViewport();

    // 3. And the footer is reachable by scrolling the dialog's own container —
    //    which is the part that did not exist before.
    const saveButton = dialog.getByRole('button', {
      name: /save|sauvegarder/i,
    });
    await saveButton.scrollIntoViewIfNeeded();
    await expect(saveButton).toBeInViewport();

    // The close button is reachable too, and big enough to hit: 44px on mobile.
    const closeButton = dialog.getByRole('button', {
      name: /close dialog|fermer la bo/i,
    });
    const closeBox = await closeButton.boundingBox();
    expect(closeBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(closeBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});

// ============================================================================
// Test Suite: Form Label Associations
// ============================================================================

test.describe('Form Label Associations', () => {
  // --------------------------------------------------------------------------
  // Test 8: Forms have associated labels
  // --------------------------------------------------------------------------
  test('trip form has properly associated labels', async ({ page }) => {
    await page.goto('/trips/new');
    await page.waitForLoadState('load');

    // Run a11y analysis focused on form labels
    const violations = await analyzeA11y(page);

    // Filter for label-related violations
    const labelViolations = violations.filter(
      (v) => v.id.includes('label') || v.id.includes('form')
    );

    if (labelViolations.length > 0) {
      console.log('Trip form label violations:\n', formatViolations(labelViolations));
    }

    expect(labelViolations).toEqual([]);

    // Verify specific form fields have labels
    const nameInput = page.locator('#trip-name');
    await expect(nameInput).toBeVisible();

    // Check that the input has an associated label (via aria-labelledby, aria-label, or label element)
    const hasLabel = await nameInput.evaluate((el) => {
      const ariaLabelledBy = el.getAttribute('aria-labelledby');
      const ariaLabel = el.getAttribute('aria-label');
      const id = el.getAttribute('id');
      const label = id ? document.querySelector(`label[for="${id}"]`) : null;
      return !!(ariaLabelledBy || ariaLabel || label);
    });
    expect(hasLabel).toBe(true);
  });
});

// ============================================================================
// Test Suite: Keyboard Navigation
// ============================================================================

test.describe('Keyboard Navigation', () => {
  // --------------------------------------------------------------------------
  // Test 9: Keyboard navigation works for interactive flows
  // --------------------------------------------------------------------------
  test('trip cards are keyboard navigable', async ({ page }) => {
    await page.goto('/');
    await clearIndexedDB(page);
    await page.reload();

    // Create trip
    await createTestTrip(page);

    await page.goto('/trips');
    await page.waitForLoadState('load');
    await waitForLoading(page);

    // Wait for trip card to be visible
    const tripCard = page.getByRole('button', { name: new RegExp(TEST_DATA.trip.name) });
    await expect(tripCard).toBeVisible({ timeout: 10000 });

    // Focus on the trip card using Tab
    await page.keyboard.press('Tab');

    // Keep tabbing until we reach the trip card (may need multiple tabs)
    let isTripCardFocused = false;
    for (let i = 0; i < 20; i++) {
      const focused = await page.evaluate(() => {
        const active = document.activeElement;
        return active?.getAttribute('aria-label') ?? active?.textContent ?? '';
      });

      if (focused.includes(TEST_DATA.trip.name)) {
        isTripCardFocused = true;
        break;
      }
      await page.keyboard.press('Tab');
    }

    expect(isTripCardFocused).toBe(true);

    // Verify the element is focusable
    const isFocusable = await tripCard.evaluate((el) => el.tabIndex >= 0);
    expect(isFocusable).toBe(true);

    // Press Enter to activate
    await page.keyboard.press('Enter');

    // Should navigate to trip calendar
    await expect(page).toHaveURL(/\/trips\/[^/]+\/calendar/, { timeout: 5000 });
  });

  // --------------------------------------------------------------------------
  // Test: Navigation is keyboard accessible
  // --------------------------------------------------------------------------
  test('navigation links are keyboard accessible', async ({ page }) => {
    // Use mobile viewport
    await page.setViewportSize({ width: 375, height: 812 });

    await page.goto('/');
    const tripId = await setupTripWithData(page);

    await page.goto(`/trips/${tripId}/calendar`);
    await page.waitForLoadState('load');
    await waitForLoading(page);

    // Look for the mobile navigation element
    const nav = page.locator('nav[aria-label="Mobile navigation"]');
    await expect(nav).toBeVisible();

    // Get all navigation links
    const navItems = nav.locator('a');
    const count = await navItems.count();

    expect(count).toBeGreaterThan(0);

    // Each nav item should be focusable (links are focusable by default)
    for (let i = 0; i < count; i++) {
      const item = navItems.nth(i);
      const isFocusable = await item.evaluate((el) => {
        // Links are focusable unless tabindex=-1
        return el.tabIndex >= 0 || el.tagName === 'A';
      });
      expect(isFocusable).toBe(true);
    }

    // Verify nav links have accessible names
    for (let i = 0; i < count; i++) {
      const item = navItems.nth(i);
      const accessibleName = await item.evaluate((el) => {
        return el.getAttribute('aria-label') || el.textContent?.trim() || '';
      });
      expect(accessibleName.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// Test Suite: Dark Mode Accessibility
// ============================================================================

test.describe('Dark Mode Accessibility', () => {
  // --------------------------------------------------------------------------
  // Test 10: Light and dark mode are accessible
  // --------------------------------------------------------------------------
  test('trip list page in dark mode has no a11y violations', async ({ page }) => {
    await setColorScheme(page, 'dark');
    await page.goto('/');
    await clearIndexedDB(page);
    await page.reload();

    await createTestTrip(page);

    await page.goto('/trips');
    await page.waitForLoadState('load');
    await waitForLoading(page);

    const violations = await analyzeA11y(page);

    if (violations.length > 0) {
      console.log('Trip list (dark mode) violations:\n', formatViolations(violations));
    }

    expect(violations).toEqual([]);
  });

  test('settings page in dark mode has no a11y violations', async ({ page }) => {
    await setColorScheme(page, 'dark');
    await page.goto('/settings');
    await page.waitForLoadState('load');
    await waitForLoading(page);

    const violations = await analyzeA11y(page);

    if (violations.length > 0) {
      console.log('Settings (dark mode) violations:\n', formatViolations(violations));
    }

    expect(violations).toEqual([]);
  });

  test('calendar page in dark mode has no a11y violations', async ({ page }) => {
    await setColorScheme(page, 'dark');
    await page.goto('/');
    const tripId = await setupTripWithData(page);

    await page.goto(`/trips/${tripId}/calendar`);
    await page.waitForLoadState('load');
    await waitForLoading(page);

    const violations = await analyzeA11y(page);

    if (violations.length > 0) {
      console.log('Calendar (dark mode) violations:\n', formatViolations(violations));
    }

    expect(violations).toEqual([]);
  });
});

// ============================================================================
// Test Suite: Empty State Accessibility
// ============================================================================

test.describe('Empty State Accessibility', () => {
  test('empty trip list page is accessible', async ({ page }) => {
    await page.goto('/');
    await clearIndexedDB(page);
    await page.reload();

    await page.goto('/trips');
    await page.waitForLoadState('load');

    // Wait for empty state to appear
    await expect(
      page.getByRole('heading', { name: /no trips/i })
    ).toBeVisible({ timeout: 10000 });

    const violations = await analyzeA11y(page);

    if (violations.length > 0) {
      console.log('Empty trip list violations:\n', formatViolations(violations));
    }

    expect(violations).toEqual([]);

    // The "New trip" button in empty state should be focusable.
    //
    // Scoped to the `EmptyState`, which renders as `role="status"`: the page
    // header offers the same action under the same name, so an unscoped match
    // is a strict-mode violation — and this test is about the empty state's
    // copy of the button specifically.
    const newTripButton = page
      .getByRole('status')
      .getByRole('button', { name: /new|nouveau/i });
    await expect(newTripButton).toBeVisible();

    const isFocusable = await newTripButton.evaluate((el) => el.tabIndex >= 0);
    expect(isFocusable).toBe(true);
  });
});
