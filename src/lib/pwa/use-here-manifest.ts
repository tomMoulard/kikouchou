/**
 * @fileoverview Points the page at the manifest that installs *this* page.
 *
 * The build emits two manifests (see `lib/pwa/manifest-variants`). The default
 * one opens the installed app on the app root; the other has no `start_url`,
 * so a Home Screen app added from a page opens on that page. The invite page
 * wants the second: an iPhone that installs from `/join/<token>` must open on
 * the invite, because the installed app's storage is separate from Safari's
 * and the trip is not there yet.
 *
 * Swapping the `<link rel="manifest">` at run time is enough. Safari reads the
 * manifest when the visitor taps "Add to Home Screen", and Chromium re-reads it
 * on each `beforeinstallprompt`; neither caches the first one it saw for the
 * life of the document.
 *
 * @module lib/pwa/use-here-manifest
 */

import { useEffect } from 'react';

import { HERE_MANIFEST_FILENAME } from './manifest-variants';

// ============================================================================
// Hook
// ============================================================================

/**
 * While mounted, the document's manifest is the one without `start_url`.
 *
 * Restores the original on unmount, so leaving the join page for the calendar
 * puts the ordinary manifest back and an install from there opens on the app
 * root as before.
 *
 * @param enabled - Off means nothing is touched, for pages that only sometimes
 *   want the variant
 */
export function useHereManifest(enabled = true): void {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') {
      return;
    }

    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (link === null) {
      // No manifest link at all — the dev server, or a build that dropped it.
      // Nothing to swap, and adding one would install an app the page did
      // not declare.
      return;
    }

    const original = link.getAttribute('href');
    link.setAttribute('href', `${import.meta.env.BASE_URL}${HERE_MANIFEST_FILENAME}`);

    return () => {
      if (original === null) {
        link.removeAttribute('href');
      } else {
        link.setAttribute('href', original);
      }
    };
  }, [enabled]);
}
