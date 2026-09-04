/**
 * @fileoverview E2E Accessibility Tests for Kikouchou PWA.
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
 *
 * A test that re-enables a rule locally — by building its own `AxeBuilder`
 * rather than calling {@link analyzeA11y} — is now redundant rather than
 * wrong: nothing is disabled here for it to work around. Prefer routing it
 * back through {@link analyzeA11y} so there is one configuration to reason
 * about, and so a rule added here later cannot be silently bypassed.
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
 * Puts the app into a colour scheme — for real.
 *
 * `page.emulateMedia({ colorScheme })` on its own does nothing to this app.
 * `src/index.css` declares `@custom-variant dark (&:is(.dark *))`, so the dark
 * token block and every `dark:` utility need a `.dark` class on an ancestor;
 * a media feature cannot activate a class-based variant. The three dark-mode
 * tests below used to emulate the media feature and then re-scan a light page
 * while reporting that they had checked dark mode.
 *
 * Seeding the stored preference instead makes the app apply the class through
 * its own code path (`THEME_STORAGE_KEY` in `src/lib/theme.ts`, read by both
 * `applyStoredTheme` and the `ThemeProvider`), so the test exercises what
 * users get rather than forcing a class the app never writes. `addInitScript`
 * re-runs on every navigation and reload, which matters because the tests
 * clear storage and reload mid-flight. The media emulation stays so that the
 * `system` preference and the browser's own UI agree with the choice.
 *
 * @param page - Playwright page object
 * @param scheme - Color scheme to set
 */
async function setColorScheme(
  page: Page,
  scheme: 'light' | 'dark',
): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  await page.addInitScript((value: string) => {
    try {
      window.localStorage.setItem('theme', value);
    } catch {
      // Storage blocked; the media emulation above still drives `system`.
    }
  }, scheme);
}

/**
 * Asserts the dark theme is genuinely painted on the page under test.
 *
 * Two checks, because either one alone can pass on a broken app: the class
 * proves the provider is mounted and writing, and the measured colours prove
 * the `.dark` token block is actually feeding `bg-background` /
 * `text-foreground`. Break either — unmount the provider, or put a light value
 * in a `.dark` token — and this fails.
 *
 * @param page - Playwright page object
 */
async function expectDarkThemeApplied(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);

  const colors = await page.evaluate(() => {
    /**
     * Sentinel used to tell "the browser could not parse this colour" apart
     * from "the browser parsed it and it is black".
     */
    const UNPARSED = '#ff00ff';

    /**
     * WCAG relative luminance, 0 (black) to 1 (white).
     *
     * Goes through a canvas rather than a regex because every token in this
     * app is authored in OKLCH and Chromium serialises modern colour
     * functions verbatim: `getComputedStyle` returns
     * `oklch(0.15 0.025 50)`, not `rgb(...)`. Reading three numbers out of
     * that string with a regex produces a luminance near zero for *any*
     * colour, dark or light — which is exactly how the first version of this
     * check passed on a light page.
     */
    const luminance = (value: string): number | null => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return null;
      }

      ctx.fillStyle = UNPARSED;
      ctx.fillStyle = value;
      if (ctx.fillStyle === UNPARSED) {
        return null;
      }

      ctx.fillRect(0, 0, 1, 1);

      const [r = 0, g = 0, b = 0, alpha = 0] = ctx.getImageData(0, 0, 1, 1).data;

      // A fully transparent colour composites to [0,0,0,0], whose luminance is
      // 0 — which would sail through a "background is dark" check on a page
      // that has no background at all. That is the same vacuous pass this
      // helper exists to prevent, so refuse to score it.
      if (alpha !== 255) {
        return null;
      }

      const linear = (channel: number): number => {
        const ratio = channel / 255;
        return ratio <= 0.04045
          ? ratio / 12.92
          : Math.pow((ratio + 0.055) / 1.055, 2.4);
      };

      return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    };

    const computed = window.getComputedStyle(document.body);
    return {
      background: luminance(computed.backgroundColor),
      foreground: luminance(computed.color),
    };
  });

  // `not.toBeNull()` is load-bearing: `luminance` returns null for a colour
  // the browser could not parse and for a transparent one, and a null scored
  // as 0 would read as "very dark".
  expect(colors.background, 'body background should be dark').not.toBeNull();
  expect(colors.foreground, 'body text should be light').not.toBeNull();
  expect(colors.background ?? 1).toBeLessThan(0.2);
  expect(colors.foreground ?? 0).toBeGreaterThan(0.5);
}

/**
 * Waits for the lazily-loaded route to replace its "Loading…" fallback.
 *
 * This used to swallow its own timeout with `.catch(() => {})`, which meant a
 * page that never finished loading was scanned anyway — and a suspense
 * fallback has no violations, so every one of these tests passed by finding
 * nothing at all.
 *
 * It was then re-implemented here, character for character, as a fork of
 * `waitForRoute` in `e2e/support/routes.ts`. That is now the one copy, and
 * 30 s is its default, so this is an alias kept only because thirteen call
 * sites read better with it.
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

    // A dialog with nothing focusable in it would make the loop below assert
    // two presses against a trap that has nothing to trap, which is not the
    // same test at all.
    expect(focusableCount).toBeGreaterThan(0);

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
    // Seeded so that "cancel" has something to fail to destroy. The button this
    // test opens wipes every trip on the device; without a trip in the database
    // the last assertion cannot tell a cancelled dialog from a confirmed one.
    await page.goto('/');
    await setupTripWithData(page);

    await page.goto('/settings');
    await page.waitForLoadState('load');
    await waitForLoading(page);

    // Click the "Clear All Data" button to open confirm dialog
    const clearDataButton = page.getByRole('button', { name: /clear.*data/i });
    await clearDataButton.click();

    // A confirmation is an alert dialog, and only an alert dialog. The old
    // `getByRole('alertdialog').or(getByRole('dialog'))` passed whichever role
    // shipped, which is how this stayed a plain dialog for so long.
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Focus lands on Cancel specifically, not merely "somewhere inside".
    //
    // That is the contract `ConfirmDialog` states in prose — "AlertDialogCancel
    // is what Radix focuses when the dialog opens, so it has to wrap the real
    // button rather than sit beside it" — and it is the whole safety property
    // of a destructive confirmation: the key a user is already holding down
    // must not be able to answer "yes". Asserting only that focus is inside the
    // alert dialog passes just as happily with focus parked on "Clear".
    const cancelButton = dialog.getByRole('button', { name: /cancel|annuler/i });
    await expect(cancelButton).toBeFocused();

    // Cancel the dialog
    await cancelButton.click();
    await expect(dialog).toBeHidden({ timeout: 5000 });

    // And cancelling really cancelled. `ConfirmDialog` routes the Cancel button
    // through `handleOpenChange` rather than a second `onClick`, so "the dialog
    // closed" and "the destructive callback did not run" are two different
    // facts — a wiring mistake closes the dialog *and* clears the database, and
    // every assertion above would still pass.
    await page.goto('/trips');
    await waitForLoading(page);
    await expect(page.getByText(TEST_DATA.trip.name).first()).toBeVisible();
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

    // The case has to be real: a dialog that already fits proves nothing. The
    // scrolling belongs to the body, one level inside the box, so that the
    // close button positioned against the box does not scroll away with it.
    const body = dialog.locator('[data-slot="dialog-body"]');
    const overflow = await body.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight + 1);

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

    // 4. The close button is still on screen after that scroll. It is
    //    positioned against the box, so this fails the moment the box itself
    //    becomes the scroll container: the button rides the content off the
    //    top exactly when the dialog is tall enough to need scrolling.
    //    `boundingBox()` alone would not catch it — it reports 44x44 for an
    //    element that has scrolled out of view.
    const closeButton = dialog.getByRole('button', {
      name: /close dialog|fermer la bo/i,
    });
    await expect(closeButton).toBeInViewport();

    // ... and it is big enough to hit: 44px, the mobile touch target. Measured
    // from the layout box rather than `boundingBox()`, which reports the
    // painted size and so reads 42px while the open animation's zoom-in-95 is
    // still running.
    const closeSize = await closeButton.evaluate((el) => [
      (el as HTMLElement).offsetWidth,
      (el as HTMLElement).offsetHeight,
    ]);
    expect(closeSize).toEqual([44, 44]);
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

    /**
     * The route has to have arrived before axe runs.
     *
     * `/trips/new` is a lazy chunk like every other route, and `load` fires
     * while `main` still holds the suspense fallback. This test scanned that
     * fallback: a spinner has no form controls, so it has no label violations,
     * and the assertion below reported a clean form without one ever having
     * rendered. Every sibling test in this file already waited; this one was
     * missed because its second half — a retrying `expect` on `#trip-name` —
     * made the omission invisible.
     */
    await waitForLoading(page);
    const nameInput = page.locator('#trip-name');
    await expect(nameInput).toBeVisible();

    // Run a11y analysis. The whole result, not a label-shaped slice of it: this
    // page is the only unscanned route left in the file, and filtering to
    // `v.id.includes('label')` threw away every other violation on it.
    const violations = await analyzeA11y(page);

    if (violations.length > 0) {
      console.log('Trip form violations:\n', formatViolations(violations));
    }

    expect(violations).toEqual([]);

    /**
     * And the name field is named, by the browser's own computation.
     *
     * The hand-rolled version of this check asked whether any of
     * `aria-labelledby`, `aria-label` or `label[for]` was *present*. All three
     * can be present and empty — `aria-labelledby` pointing at a removed node
     * is the common one — and the check passed on all of them. Playwright's
     * `toHaveAccessibleName` runs the real algorithm, so a dangling reference
     * fails it.
     */
    await expect(nameInput).toHaveAccessibleName(/\S/);
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

    // The loop above matched on the active element's *text*, which the card's
    // own children also carry. Pin it to the card itself, so a Tab that landed
    // on something nested inside it cannot satisfy the test — and so the Enter
    // press below is provably being sent to the control it claims to activate.
    await expect(tripCard).toBeFocused();

    // Press Enter to activate
    await page.keyboard.press('Enter');

    // Should navigate to trip calendar
    await expect(page).toHaveURL(/\/trips\/[^/]+\/calendar/, { timeout: 5000 });
  });

  // --------------------------------------------------------------------------
  // Test: Navigation is keyboard accessible
  //
  // The claim under test is `Layout.tsx`'s, verbatim: "Disabled, not removed:
  // no `tabIndex={-1}` and no `pointer-events-none`. A control taken out of the
  // tab order is a control a keyboard or screen-reader user never learns
  // exists."
  //
  // The previous version of this test could not observe that. It read
  // `el.tabIndex >= 0 || el.tagName === 'A'` on a locator built from
  // `nav.locator('a')` — every element it matched was an anchor, so the right
  // operand was true by construction and the left one never mattered.
  // `tabindex="-1"` on every link in the bar passed it. The accessible-name
  // half had the same shape: it re-implemented name computation as
  // `aria-label || textContent`, which is non-empty for any link with a visible
  // text span whatever the accessibility tree actually exposes.
  // --------------------------------------------------------------------------
  test('every mobile navigation control stays in the tab order', async ({ page }) => {
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

    const navLinks = nav.getByRole('link');
    const linkCount = await navLinks.count();
    expect(linkCount).toBeGreaterThan(0);

    for (let index = 0; index < linkCount; index++) {
      const link = navLinks.nth(index);

      // The real accessible name, computed by the browser rather than guessed
      // from two attributes. `/\S/` is "at least one non-whitespace character",
      // which an icon-only link with no label fails.
      await expect(link).toHaveAccessibleName(/\S/);

      // No `|| tagName === 'A'`. This is the whole assertion.
      const tabIndex = await link.evaluate((el) => el.tabIndex);
      expect(tabIndex, `nav link ${index} must stay in the tab order`)
        .toBeGreaterThanOrEqual(0);
    }

    // And the property `tabIndex` is only a proxy for: pressing Tab really does
    // walk the whole bar, links and the "More" button alike, in DOM order.
    // A single `tabIndex={-1}` anywhere in it breaks this loop at that control.
    const navControls = nav.locator('a, button');
    const controlCount = await navControls.count();
    expect(controlCount).toBeGreaterThan(linkCount);

    await navControls.first().focus();
    await expect(navControls.first()).toBeFocused();

    for (let index = 1; index < controlCount; index++) {
      await page.keyboard.press('Tab');
      await expect(
        navControls.nth(index),
        `Tab from control ${index - 1} should reach control ${index}`,
      ).toBeFocused();
    }
  });
});

// ============================================================================
// Test Suite: Dark Mode Accessibility
// ============================================================================

/**
 * Contrast is not scanned separately here.
 *
 * These three tests used to run axe twice: once through {@link analyzeA11y} and
 * again through an `analyzeContrast` helper that built its own `AxeBuilder`
 * with `.withRules(['color-contrast'])`. That helper existed because
 * `color-contrast` was in {@link ACCEPTABLE_VIOLATIONS} and therefore off
 * everywhere else — and its docstring still said so long after the rule was
 * re-enabled. With that list empty, `analyzeA11y` already runs `color-contrast`
 * on every page in this file, so the second scan asserted a strict subset of
 * the first at the cost of a full extra axe pass per test.
 *
 * What the dark-mode tests are actually for survives unchanged: no other test
 * in the repo renders these pages with the `.dark` token block applied, so a
 * raw colour utility shipped without a `dark:` counterpart is caught here and
 * nowhere else.
 */
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

    await expectDarkThemeApplied(page);

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

    await expectDarkThemeApplied(page);

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

    await expectDarkThemeApplied(page);

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
