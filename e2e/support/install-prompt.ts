/**
 * @fileoverview Shared helpers for driving the PWA install prompt in E2E tests.
 *
 * One definition of each, because two specs need them: `mobile-bottom-edge`
 * hit-tests the card against the FAB, and `install-request` checks that the
 * landing page's `?install=1` reaches it at all.
 *
 * @module e2e/support/install-prompt
 */

import type { Page } from '@playwright/test';

// ============================================================================
// Constants
// ============================================================================

/**
 * The install card's accessible name.
 *
 * The app's language detection reads `localStorage`, then the navigator, and
 * falls back to French, so a name can come back in either language depending on
 * the machine. `installation` is the substring both share.
 */
export const INSTALL_REGION_LABEL = /installation/i,

/**
 * The button that acknowledges hand-written install steps, in both languages.
 */
 MANUAL_STEPS_BUTTON_LABEL = /got it|j'ai compris/i,

/**
 * Where `InstallPrompt` records a dismissal, and for how long it honours one.
 */
 DISMISSAL_STORAGE_KEY = 'kikouchou-install-dismissed';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Fires `beforeinstallprompt` at the page.
 *
 * `useInstallPrompt` only listens, and no browser fires this event under
 * automation — not even the `production` project's real service worker and
 * installable manifest — so a test that needs the native banner has to fire it
 * itself. A test that needs the *absence* of the event needs to do nothing at
 * all, which is what makes automation a faithful stand-in for Safari here.
 */
export async function fakeBeforeInstallPrompt(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(new Event('beforeinstallprompt', { cancelable: true }));
  });
}

/**
 * Records a dismissal from a moment ago, before the app boots.
 *
 * An init script rather than an `evaluate`, because the component reads the key
 * once, in a state initialiser on its first render: written any later, the
 * dismissal is simply not there to be honoured or overridden.
 */
export async function seedInstallDismissal(page: Page): Promise<void> {
  await page.addInitScript((key: string) => {
    localStorage.setItem(key, Date.now().toString());
  }, DISMISSAL_STORAGE_KEY);
}
