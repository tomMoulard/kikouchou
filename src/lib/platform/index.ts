/**
 * @fileoverview Which shell this document runs in: a browser, or a store app.
 *
 * One `src/` builds three targets. The website at `app.kikouchou.app`, and the
 * iOS and Android apps, which load the same build from files inside the app
 * bundle (see `capacitor.config.ts`). Inside those apps the page origin is
 * `capacitor://localhost` or `https://localhost`, so anything that used to read
 * `window.location.origin` as "where this app lives" has to ask here instead.
 *
 * Every native difference in the app is a branch on {@link isNativeApp} or
 * {@link getAppPlatform}. The web branch keeps what the website always did.
 *
 * Nothing here may throw: `main.tsx` evaluates the importers at module scope,
 * and so, transitively, does every component test.
 *
 * @module lib/platform
 */

import { Capacitor } from '@capacitor/core';

// ============================================================================
// Type Definitions
// ============================================================================

/** The three targets one build ships to. */
export type AppPlatform = 'web' | 'ios' | 'android';

// ============================================================================
// Constants
// ============================================================================

/**
 * Where the website lives, and so what every link handed to another person
 * points at. A native app never hands out its own origin: nobody else can open
 * `capacitor://localhost`.
 */
const DEFAULT_PUBLIC_APP_ORIGIN = 'https://app.kikouchou.app';

/**
 * The URL scheme the store apps register, for the one redirect that only ever
 * happens inside the app: the OAuth provider sending the browser sheet back.
 * Listed in Supabase's redirect allow-list (`supabase/config.toml`).
 */
export const NATIVE_URL_SCHEME = 'app.kikouchou';

/** The OAuth return address of the store apps. */
export const NATIVE_AUTH_CALLBACK_URL = `${NATIVE_URL_SCHEME}://auth/callback`;

// ============================================================================
// Exports
// ============================================================================

/**
 * The target this document runs on.
 */
export function getAppPlatform(): AppPlatform {
  try {
    const platform = Capacitor.getPlatform();
    return platform === 'ios' || platform === 'android' ? platform : 'web';
  } catch {
    return 'web';
  }
}

/**
 * Whether this document runs inside the iOS or Android store app.
 */
export function isNativeApp(): boolean {
  return getAppPlatform() !== 'web';
}

/**
 * Whether a native plugin is compiled into this build.
 *
 * The F-Droid build leaves the push plugin out, so a feature that depends on a
 * plugin asks for it by name rather than assuming every native build has it.
 *
 * @param name - The plugin's registered name, e.g. `PushNotifications`
 */
export function hasNativePlugin(name: string): boolean {
  try {
    return isNativeApp() && Capacitor.isPluginAvailable(name);
  } catch {
    return false;
  }
}

/**
 * The website's origin, with no trailing slash.
 *
 * `VITE_PUBLIC_APP_ORIGIN` overrides it for a staging deploy.
 */
export function getPublicAppOrigin(): string {
  const configured: unknown = import.meta.env.VITE_PUBLIC_APP_ORIGIN;
  const origin =
    typeof configured === 'string' && configured.trim() !== ''
      ? configured.trim()
      : DEFAULT_PUBLIC_APP_ORIGIN;
  return origin.replace(/\/+$/, '');
}

/**
 * The origin to build a shareable link from.
 *
 * On the web this is the page's own origin, as it always was, so a staging
 * deploy or a dev server hands out links to itself. In a store app it is the
 * website's.
 *
 * @param pageOrigin - `window.location.origin`, read by the caller
 */
export function resolveLinkOrigin(pageOrigin: string): string {
  return isNativeApp() ? getPublicAppOrigin() : pageOrigin;
}
