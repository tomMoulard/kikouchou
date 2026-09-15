/**
 * @fileoverview The browser's own install steps, for browsers with no prompt.
 *
 * `beforeinstallprompt` is Chromium's alone. On an iPhone, in Firefox, and in
 * every other browser the only install route is a menu the visitor has to find,
 * and these are the words that point at it. Shared by the global install
 * banner and the contextual nudge on a trip's pages, so the two cannot disagree
 * about what to tap.
 *
 * A table of literal keys rather than a `pwa.manualInstall.${platform}`
 * template: the scan in `lib/i18n/__tests__/translationKeys.test.ts` resolves
 * literals only, and a key it cannot see is a key that can go missing from `fr`
 * without anything failing.
 *
 * @module lib/pwa/manual-install-steps
 */

import type { ManualInstallPlatform } from '@/hooks/useInstallPrompt';

// ============================================================================
// Constants
// ============================================================================

/**
 * The steps for each browser that never fires `beforeinstallprompt`, with the
 * English each key holds so a missing translation still reads as instructions.
 */
export const MANUAL_INSTALL_STEPS: Record<
  ManualInstallPlatform,
  { readonly key: string; readonly fallback: string }
> = {
  ios: {
    key: 'pwa.manualInstall.ios',
    fallback: 'Tap the Share button, then "Add to Home Screen", then "Add".',
  },
  firefoxAndroid: {
    key: 'pwa.manualInstall.firefoxAndroid',
    fallback:
      'Open Firefox\'s ⋮ menu and tap "Install" — older versions call it "Add app to Home Screen".',
  },
  firefoxWindows: {
    key: 'pwa.manualInstall.firefoxWindows',
    fallback:
      'Click "Add tab to taskbar" in the address bar (Firefox 142 and later). The app gets its own window, toolbar included.',
  },
  firefoxLinux: {
    key: 'pwa.manualInstall.firefoxLinux',
    fallback:
      'Set browser.taskbarTabs.enabled to true in about:config, then click "Add tab to taskbar" in the address bar.',
  },
  firefoxMac: {
    key: 'pwa.manualInstall.firefoxMac',
    fallback:
      'Firefox on macOS cannot install web apps yet. Kikouchou works fully in a tab — or install it from Safari or Chrome.',
  },
  generic: {
    key: 'pwa.manualInstall.generic',
    fallback:
      'Look for "Install", "Add to Dock" or "Add to Home Screen" in your browser\'s menu.',
  },
};
