/**
 * @fileoverview The second manifest, for the page an iPhone installs from.
 *
 * A Home Screen web app on iOS has its own storage, separate from Safari, and a
 * tapped link always opens Safari. So a guest who opens an invite in Safari and
 * then adds the app to the Home Screen gets an app that knows nothing — the
 * trip, and the "which one are you" answer, stayed in Safari.
 *
 * Safari has one hook for this: a manifest with no `start_url` makes the Home
 * Screen app open on the page it was added from. The join page therefore points
 * at this variant while it is on screen, so the installed app opens on
 * `/join/<token>` and fetches the trip on its own through the token.
 *
 * `id` stays, so Chromium keeps treating both manifests as one app — an
 * install from the join page is an install of Kikouchou, not of a second app
 * that happens to share the icon.
 *
 * Pure, so `vite.config.ts` can derive the file at build time and this can be
 * tested without a build.
 *
 * @module lib/pwa/manifest-variants
 */

// ============================================================================
// Constants
// ============================================================================

/** Where the build writes the variant, relative to the app's base. */
export const HERE_MANIFEST_FILENAME = 'manifest-here.webmanifest';

// ============================================================================
// Derivation
// ============================================================================

/**
 * The same manifest, minus `start_url`.
 *
 * Nothing else changes: same name, icons, colours, display and `id`. A
 * browser reading either file installs the same app; only where it opens
 * differs.
 *
 * @param manifest - The manifest the build hands to the PWA plugin
 * @returns A copy without `start_url`
 *
 * @example
 * ```ts
 * emitFile({ fileName: HERE_MANIFEST_FILENAME, source: JSON.stringify(withoutStartUrl(manifest)) });
 * ```
 */
export function withoutStartUrl<T extends Record<string, unknown>>(
  manifest: T,
): Omit<T, 'start_url'> {
  const rest: Record<string, unknown> = { ...manifest };
  delete rest.start_url;
  return rest as Omit<T, 'start_url'>;
}
