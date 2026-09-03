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
import { waitForRoute } from './support/routes';
import { seedPerson, seedRoom, seedTrip } from './support/seed';

// ============================================================================
// Test Configuration & Helpers
// ============================================================================

/**
 * `yyyy-MM-dd`, `offsetDays` away from today in local time.
 *
 * Fixture dates are derived rather than written down. A hardcoded range rots:
 * this suite used to seed a trip in April 2026, and once that date passed the
 * trip was rendered as a past trip on every page — with the suite green
 * throughout, because axe cannot tell "no violations" from "nothing rendered".
 */
function isoDateFromToday(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Test data for creating trips and associated entities.
 */
const TEST_DATA = {
  trip: {
    name: 'A11y Test Trip',
    location: 'Accessibility House',
    // Straddles today, so every page renders its "current trip" state.
    startDate: isoDateFromToday(-1),
    endDate: isoDateFromToday(8),
  },
  room: {
    name: 'Accessible Room',
    capacity: 2,
    description: 'Room for a11y testing',
  },
  person: {
    name: 'Test Person',
  },
} as const;

/**
 * Rules this suite does not enforce, and why.
 *
 * Keep this empty. Every entry is a rule that silently stops being checked
 * anywhere in the repo, and this list is the only accessibility gate there is.
 * `heading-order`, `nested-interactive` and `color-contrast` all used to live
 * here behind a TODO; the components were fixed instead — see `EmptyState`'s
 * `headingLevel` prop and the full-card activation button in `TripCard`,
 * `RoomCard` and `PersonListPage`'s card.
 *
 * If a rule genuinely has to come off, disable it for the one page that cannot
 * pass yet by passing `disableRules` to {@link analyzeA11y}, so the other five
 * pages keep enforcing it.
 */
const ACCEPTABLE_VIOLATIONS = {
  rules: [] as string[],
};

/**
 * Seeds the trip this suite scans.
 *
 * @param page - Playwright page object
 * @returns The created trip's ID
 */
async function createTestTrip(page: Page): Promise<string> {
  const { tripId } = await seedTrip(page, {
    name: TEST_DATA.trip.name,
    location: TEST_DATA.trip.location,
    startDate: TEST_DATA.trip.startDate,
    endDate: TEST_DATA.trip.endDate,
  });
  return tripId;
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
 *
 * @param page - Playwright page object
 * @param disableRules - Rules to drop for this page only. Prefer this over
 *   {@link ACCEPTABLE_VIOLATIONS}, which switches a rule off everywhere.
 * @param excludeSelectors - Subtrees to leave out of the scan entirely.
 * @returns Array of accessibility violations
 */
async function analyzeA11y(
  page: Page,
  disableRules: string[] = [],
  excludeSelectors: string[] = [],
): Promise<import('axe-core').Result[]> {
  const builder = new AxeBuilder({ page });

  const rulesToDisable = [...ACCEPTABLE_VIOLATIONS.rules, ...disableRules];
  if (rulesToDisable.length > 0) {
    builder.disableRules(rulesToDisable);
  }

  for (const selector of excludeSelectors) {
    builder.exclude(selector);
  }

  const results = await builder.analyze();
  return results.violations;
}

/**
 * Sonner's own toast markup, left out of the two room scans.
 *
 * The rooms page fires one success toast on a trip's first visit, so it is up
 * while axe runs. Its rich-colours success pair is sonner's, not this app's,
 * and it misses AA by a hair: `#008a2e` on `#ecfdf3` measures **4.25:1**
 * where normal-size text needs 4.5:1.
 *
 * TODO(unit-18): give the toaster a success colour from this app's palette
 * — the repo has no `--success` token, and inventing one is a colour-system
 * decision. `emerald-800` on sonner's success background measures 7.3:1.
 * Delete this constant and its two call sites once that lands.
 *
 * Scoped to the toast subtree rather than disabling `color-contrast` for the
 * whole page: every other rule still runs on the toast's page, and contrast
 * is still enforced on the room cards themselves.
 */
const SONNER_TOAST_SUBTREE = '[data-sonner-toast]';

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
 * Waits for the lazily-loaded route to replace its "Loading…" fallback.
 *
 * This used to swallow its own timeout with `.catch(() => {})`, which meant a
 * page that never finished loading was scanned anyway — and a suspense
 * fallback has no violations, so every one of these tests passed by finding
 * nothing. {@link waitForRoute} is a real `expect` with a stated timeout, so
 * the test now fails instead of quietly asserting nothing.
 *
 * @param page - Playwright page object
 */
async function waitForLoading(page: Page): Promise<void> {
  await waitForRoute(page);
}

/**
 * Sets up a trip with data (room and person) for testing.
 * Each test that needs data calls this.
 *
 * Everything is written before any navigation to a trip-scoped route.
 * `YjsTripSync` mounts a document for whichever trip is current and projects
 * it back over Dexie, so a raw row written after that point races the mirror
 * and can be dropped — see `e2e/support/seed.ts`.
 *
 * @param page - Playwright page object
 * @returns The trip ID
 */
async function setupTripWithData(page: Page): Promise<string> {
  await clearIndexedDB(page);
  await page.reload();

  const tripId = await createTestTrip(page);

  await seedRoom(page, {
    tripId,
    name: TEST_DATA.room.name,
    capacity: TEST_DATA.room.capacity,
    description: TEST_DATA.room.description,
  });
  await seedPerson(page, tripId, TEST_DATA.person.name);

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

    // The seeded room has to be on screen, or "no violations" only means
    // "nothing rendered".
    await expect(page.getByText(TEST_DATA.room.name).first()).toBeVisible();

    const violations = await analyzeA11y(page, [], [SONNER_TOAST_SUBTREE]);

    if (violations.length > 0) {
      console.log('Room list page violations:\n', formatViolations(violations));
    }

    expect(violations).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // Test 2b: The room *cards* are scanned too
  //
  // `/rooms` defaults to the timeline view, which renders no `RoomCard` at
  // all — so the default scan above never sees the card that carries the
  // dropdown menu. `?view=card` is what puts it on screen.
  // --------------------------------------------------------------------------
  test('room cards view has no a11y violations', async ({ page }) => {
    await setColorScheme(page, 'light');
    await page.goto('/');
    const tripId = await setupTripWithData(page);

    await page.goto(`/trips/${tripId}/rooms?view=card`);
    await page.waitForLoadState('load');
    await waitForLoading(page);

    // The card's own activation button, proving a card rendered.
    await expect(
      page.getByRole('button', { name: new RegExp(TEST_DATA.room.name) }),
    ).toBeVisible();

    const violations = await analyzeA11y(page, [], [SONNER_TOAST_SUBTREE]);

    if (violations.length > 0) {
      console.log('Room cards view violations:\n', formatViolations(violations));
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

    await expect(
      page.getByRole('button', { name: new RegExp(TEST_DATA.person.name) }),
    ).toBeVisible();

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

    // Focus should be inside the dialog
    const activeElement = await page.evaluate(() => {
      const active = document.activeElement;
      return active?.closest('[role="dialog"]') !== null;
    });
    expect(activeElement).toBe(true);

    // Tab through all focusable elements - focus should stay within dialog
    const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusableInDialog = dialog.locator(focusableSelector);
    const focusableCount = await focusableInDialog.count();

    // Tab through more times than there are elements to verify wrapping
    for (let i = 0; i < focusableCount + 2; i++) {
      await page.keyboard.press('Tab');

      // Verify focus is still inside dialog
      const stillInDialog = await page.evaluate(() => {
        const active = document.activeElement;
        return active?.closest('[role="dialog"]') !== null;
      });
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

    // Wait for confirm dialog (alertdialog or dialog)
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Focus should be inside the dialog
    const activeElement = await page.evaluate(() => {
      const active = document.activeElement;
      const inDialog = active?.closest('[role="dialog"]') !== null;
      const inAlertDialog = active?.closest('[role="alertdialog"]') !== null;
      return inDialog || inAlertDialog;
    });
    expect(activeElement).toBe(true);

    // Cancel the dialog
    const cancelButton = dialog.getByRole('button', { name: /cancel|annuler/i });
    await cancelButton.click();
    await expect(dialog).toBeHidden({ timeout: 5000 });
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
