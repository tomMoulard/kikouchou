/**
 * @fileoverview Which links on `app.kikouchou.app` open the store app.
 *
 * With the iOS or Android app installed, a tap on one of these paths opens the
 * app rather than the browser. Three places have to agree on the list, and
 * this file is the one they read or are tested against:
 *
 * - `vite.config.ts` writes `/.well-known/apple-app-site-association` and
 *   `/.well-known/assetlinks.json` into the website's build from it;
 * - `android/app/src/main/AndroidManifest.xml` declares one intent filter per
 *   prefix, which `src/lib/native/__tests__/app-links.test.ts` checks;
 * - `src/lib/native/deep-links.ts` turns what arrives into a route.
 *
 * The root is deliberately not claimed. A sign-in on the website returns to
 * `/?code=…`, and a phone with the app installed must not hand that code to
 * the app, which never started the sign-in and has no verifier for it. The
 * app's own magic link returns to `/auth/native` instead.
 *
 * `share.kikouchou.app` claims every path and serves its own pair
 * (`server/share-preview/src/app_links.rs`).
 *
 * @module app-links
 */

// ============================================================================
// Constants
// ============================================================================

/** The app id on both stores. Same as `appId` in `capacitor.config.ts`. */
export const APP_ID = 'app.kikouchou';

/**
 * The paths the store app claims. A prefix ending in `/` claims everything
 * under it; one without claims that page and everything under it.
 */
export const APP_LINK_PATH_PREFIXES: readonly string[] = [
  '/join/',
  '/t/',
  '/template/',
  '/share/',
  '/trip/',
  '/trips',
  '/groups',
  '/settings',
  '/signin',
  '/auth/native',
];

// ============================================================================
// Documents
// ============================================================================

/** The iOS path patterns for one prefix. */
function applePatterns(prefix: string): string[] {
  return prefix.endsWith('/') ? [`${prefix}*`] : [prefix, `${prefix}/*`];
}

/**
 * The `apple-app-site-association` document.
 *
 * @param teamId - The Apple Developer team id, e.g. `ABCDE12345`
 */
export function appleAppSiteAssociation(teamId: string): unknown {
  const appId = `${teamId}.${APP_ID}`;
  return {
    applinks: {
      details: [
        {
          appIDs: [appId],
          components: APP_LINK_PATH_PREFIXES.flatMap(applePatterns).map((path) => ({ '/': path })),
        },
      ],
    },
    // Lets the iOS app offer the passwords and passkeys saved for the website.
    webcredentials: { apps: [appId] },
  };
}

/**
 * The `assetlinks.json` document.
 *
 * @param fingerprints - SHA-256 of every key an installed APK can carry: Play
 *   App Signing, the upload key for a sideloaded APK, and F-Droid's
 */
export function assetLinks(fingerprints: readonly string[]): unknown {
  return [
    {
      relation: [
        'delegate_permission/common.handle_all_urls',
        'delegate_permission/common.get_login_creds',
      ],
      target: {
        namespace: 'android_app',
        package_name: APP_ID,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}
