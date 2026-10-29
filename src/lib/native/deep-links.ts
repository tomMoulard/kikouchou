/**
 * @fileoverview Turns a link the operating system opened the app with into a
 * route.
 *
 * With the store app installed, a tap on a Kikouchou link opens the app rather
 * than the browser: universal links on iOS, verified app links on Android, for
 * the two hosts in `public/.well-known/` and `server/share-preview`. The link
 * then reaches the page as a URL, and this module says what to do with it.
 *
 * - `https://app.kikouchou.app/<path>` is the website's own path, so it is the
 *   app's route as it stands: an invite, a trip page, a template.
 * - `https://share.kikouchou.app/<lang>/<token>` is the preview service's
 *   link. In a browser that page redirects to `/join/<token>`
 *   (`server/share-preview/src/page.rs`); the app skips the page and goes
 *   straight to the route the redirect would reach.
 * - A link with `?code=` or `?error=` is a sign-in coming back, from the
 *   OAuth browser sheet (`app.kikouchou://auth/callback`) or a magic link.
 *
 * Pure: every origin comes in as a parameter, so nothing here reads
 * `window.location`.
 *
 * @module lib/native/deep-links
 */

// ============================================================================
// Type Definitions
// ============================================================================

/** What the app does with a link it was opened with. */
export type DeepLinkTarget =
  /** A sign-in answer. The caller hands the URL to `deliverAuthCallbackUrl`. */
  | { readonly kind: 'auth'; readonly then: string | null }
  /** A route inside the app, with its query and fragment. */
  | { readonly kind: 'navigate'; readonly to: string }
  /** Not a Kikouchou link, or one the app has no screen for. */
  | { readonly kind: 'ignore' };

/** The origins a link can legitimately come from. */
export interface DeepLinkOrigins {
  /** The website, e.g. `https://app.kikouchou.app`. */
  readonly app: string;
  /** The preview service, e.g. `https://share.kikouchou.app`, or `''`. */
  readonly share: string;
  /** The app's own URL scheme, e.g. `app.kikouchou`. */
  readonly scheme: string;
}

// ============================================================================
// Constants
// ============================================================================

/** The languages the preview service puts first in a path. */
const SHARE_LANGUAGES: readonly string[] = ['fr', 'en'];

/**
 * A token the preview service accepts: `is_token_shaped` in
 * `server/share-preview/src/trip_source.rs`. The same bound, so a link
 * the service would 404 is not turned into a route here.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

// ============================================================================
// Helpers
// ============================================================================

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function hasAuthAnswer(url: URL): boolean {
  return url.searchParams.has('code') || url.searchParams.has('error');
}

/**
 * The route the preview service's page would redirect a browser to.
 *
 * Mirrors `server/share-preview/src/page.rs`: `/<lang>/<token>` is an invite,
 * `/<lang>/t/<token>` a template, and a path without the language is the same
 * link before language negotiation.
 */
function routeForShareLink(url: URL): string | null {
  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  let language: string | null = null;
  if (segments[0] !== undefined && SHARE_LANGUAGES.includes(segments[0])) {
    language = segments.shift() ?? null;
  }

  let route: string;
  if (segments.length === 2 && segments[0] === 't' && TOKEN_PATTERN.test(segments[1] ?? '')) {
    route = `/template/${segments[1] ?? ''}`;
  } else if (segments.length === 1 && TOKEN_PATTERN.test(segments[0] ?? '')) {
    route = `/join/${segments[0] ?? ''}`;
  } else {
    return null;
  }
  return language === null ? route : `${route}?lng=${language}`;
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Says what to do with a link the app was opened with.
 *
 * @param rawUrl - The link, exactly as `appUrlOpen` or `getLaunchUrl` gave it
 * @param origins - The origins the app trusts
 */
export function resolveDeepLink(rawUrl: string, origins: DeepLinkOrigins): DeepLinkTarget {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { kind: 'ignore' };
  }

  if (url.protocol === `${origins.scheme}:`) {
    // `app.kikouchou://auth/callback?code=…`: WHATWG puts `auth` in the host
    // for a non-special scheme, and the path after it.
    if (!hasAuthAnswer(url)) {
      return { kind: 'ignore' };
    }
    return url.host === 'auth' ? { kind: 'auth', then: null } : { kind: 'ignore' };
  }

  if (url.protocol !== 'https:') {
    return { kind: 'ignore' };
  }

  if (url.origin === originOf(origins.app)) {
    if (hasAuthAnswer(url)) {
      return { kind: 'auth', then: '/trips' };
    }
    return { kind: 'navigate', to: `${url.pathname}${url.search}${url.hash}` };
  }

  if (origins.share !== '' && url.origin === originOf(origins.share)) {
    const route = routeForShareLink(url);
    return route === null ? { kind: 'ignore' } : { kind: 'navigate', to: route };
  }

  return { kind: 'ignore' };
}
