/**
 * @fileoverview Captures the OAuth callback out of the URL, first thing.
 *
 * ## Why this exists
 *
 * `supabase-js` can find its own `?code=` via `detectSessionInUrl`, but only at
 * the moment the client is constructed — and in this app that is far too late.
 * The boot order is:
 *
 *   1. `router.tsx` calls `createBrowserRouter` at module scope, which
 *      initialises history and may normalise the URL;
 *   2. `main.tsx` awaits i18n *and* the database, up to three seconds;
 *   3. React renders, `AuthProvider`'s effect runs, and only then is the
 *      Supabase client dynamically imported and constructed.
 *
 * By step 3 the query string has had seconds and a router initialisation to
 * disappear in. The observed symptom was Google sign-in completing — the user
 * row appears in Supabase — while the app stayed signed out forever, because the
 * code was gone before anything looked for it.
 *
 * So the code is read **synchronously at import time**, before the router module
 * is even evaluated. `main.tsx` imports this first for that reason; the file
 * already uses the same trick for i18n.
 *
 * The URL is then cleaned with `replaceState`, so a reload does not retry an
 * authorization code that has already been spent, and the code never lingers in
 * the address bar or in browser history.
 *
 * @module lib/supabase/auth-callback
 */

// ============================================================================
// Captured state
// ============================================================================

interface CapturedCallback {
  /** PKCE authorization code, to exchange for a session. */
  readonly code: string | null;
  /** Error the provider reported instead, e.g. the user cancelled. */
  readonly error: string | null;
}

/**
 * Whether this document load looks like a return from the provider.
 *
 * Read once, at import. Anything later would be racing the router.
 */
const captured: CapturedCallback = captureFromUrl();

/**
 * Whether the code has been handed out for exchange.
 *
 * Module-level rather than component state, because the thing it guards against
 * is a *remount*: React StrictMode mounts, unmounts and remounts every effect in
 * development, so a component-scoped flag resets exactly when it is needed.
 *
 * An authorization code is single-use, and supabase-js deletes the PKCE verifier
 * on a successful exchange. Handing the same code out twice therefore produces a
 * first attempt that works and a second that fails with *"PKCE code verifier not
 * found in storage"* — reported as a sign-in failure even though sign-in had in
 * fact just succeeded. That was observed before this guard existed.
 */
let codeConsumed = false;

// ============================================================================
// Capture
// ============================================================================

function captureFromUrl(): CapturedCallback {
  if (typeof window === 'undefined') {
    return { code: null, error: null };
  }

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return { code: null, error: null };
  }

  const code = params.get('code');
  // Supabase sends `error` plus `error_description`; the latter is the readable
  // one, so prefer it and fall back to the code.
  const error = params.get('error_description') ?? params.get('error');

  if (code === null && error === null) {
    return { code: null, error: null };
  }

  stripAuthParams(params);

  return { code, error };
}

/**
 * Removes only the auth parameters, preserving anything else on the URL.
 *
 * A share or deep link may legitimately carry its own query string, and
 * discarding the whole thing would break navigating straight to a filtered view.
 */
function stripAuthParams(params: URLSearchParams): void {
  for (const key of ['code', 'error', 'error_description', 'error_code', 'state']) {
    params.delete(key);
  }

  const query = params.toString();
  const next = `${window.location.pathname}${query.length > 0 ? `?${query}` : ''}${window.location.hash}`;

  try {
    window.history.replaceState(window.history.state, '', next);
  } catch {
    // Some embedded webviews refuse replaceState. Not fatal: the exchange has
    // the code already, and the worst case is a spent code left in the bar.
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Takes the authorization code, once.
 *
 * The first caller gets the code; every later caller gets `null` and should read
 * the persisted session instead — by then the exchange has either produced one or
 * genuinely failed. See {@link codeConsumed} for why repeating the exchange is
 * actively harmful rather than merely wasteful.
 */
export function consumeAuthCode(): string | null {
  if (codeConsumed || captured.code === null) {
    return null;
  }
  codeConsumed = true;
  return captured.code;
}



/** The provider's error for this page load, if it sent one instead of a code. */
export function getCapturedAuthError(): string | null {
  return captured.error;
}

