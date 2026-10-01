/**
 * @fileoverview Whether this page runs as an installed app or in a browser tab.
 *
 * One answer, read in one place. `useInstallPrompt` used to hold its own copy
 * of this check, and `lib/posthog` needs the same answer to stamp every event
 * with it — without that stamp the question "do installed users come back
 * more?" cannot be asked of the analytics at all, which is how the install
 * theory stayed a theory.
 *
 * Two signals, because there are two platforms:
 *
 * - The `display-mode` media query is the standard answer, and the one every
 *   Chromium and Safari build reports for a manifest with `display: standalone`.
 * - `navigator.standalone` is iOS Safari's older, non-standard flag for a web
 *   app opened from the Home Screen. Kept because older iOS builds set it
 *   without matching the media query.
 *
 * Read defensively: jsdom stubs `matchMedia`, some in-app browsers ship a stub
 * that throws, and a module that reads this at import time must never throw.
 *
 * @module lib/pwa/display-mode
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * How the page is displayed.
 *
 * `standalone` covers every installed form — a Home Screen icon, a desktop
 * window, a Dock entry. `browser` is a tab. The two other manifest display
 * modes (`minimal-ui`, `fullscreen`) are folded into these: this app declares
 * `standalone`, so a browser that shows it any other way is showing a tab.
 */
export type DisplayMode = 'standalone' | 'browser';

// ============================================================================
// Constants
// ============================================================================

/** Media query for an installed web app. */
export const STANDALONE_MEDIA_QUERY = '(display-mode: standalone)';

// ============================================================================
// Reads
// ============================================================================

/**
 * Reads how the page is displayed right now.
 *
 * Safe to call at import time and during render: it touches no storage and
 * never throws.
 *
 * @returns `standalone` for an installed app, `browser` for a tab
 *
 * @example
 * ```ts
 * posthog.register({ display_mode: readDisplayMode() });
 * ```
 */
export function readDisplayMode(): DisplayMode {
  if (typeof window === 'undefined') {
    return 'browser';
  }

  try {
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia(STANDALONE_MEDIA_QUERY).matches === true
    ) {
      return 'standalone';
    }
  } catch {
    // A stub `matchMedia` that throws is a browser tab as far as anyone can tell.
  }

  // iOS Safari's own flag, absent from lib.dom.
  const standaloneFlag = (navigator as Navigator & { readonly standalone?: unknown })
    .standalone;
  if (standaloneFlag === true) {
    return 'standalone';
  }

  return 'browser';
}

/**
 * Whether the page runs as an installed app.
 *
 * @returns True when {@link readDisplayMode} says `standalone`
 */
export function isRunningStandalone(): boolean {
  return readDisplayMode() === 'standalone';
}
