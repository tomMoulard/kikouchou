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
 * ## The store apps
 *
 * Inside the iOS and Android apps the provider does not return to this
 * document at all. The sign-in runs in a system browser sheet, which sends the
 * code back to the app as a link (`app.kikouchou://auth/callback?code=…`, or a
 * universal link for the email). That link reaches the page as an event, long
 * after import, so {@link deliverAuthCallbackUrl} hands it to whoever
 * subscribed with {@link onAuthCallback}. The PKCE verifier is in this web
 * view's storage, where the sign-in started, so the exchange works the same.
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



/**
 * Whether a failed code exchange means the link was opened in another browser.
 *
 * The PKCE verifier lives in the storage of the browser that asked for the
 * link. A magic link opened in a mail app's webview, or on another device,
 * finds no verifier and the exchange refuses. That is a person using the link
 * in the wrong place, not a bug, and it needs its own words on screen.
 *
 * @param message - GoTrue's error message, if any
 * @returns True when the verifier was missing
 */
export function isMissingCodeVerifier(message: string | null | undefined): boolean {
  return message !== null && message !== undefined && /code verifier not found/i.test(message);
}

/** The provider's error for this page load, if it sent one instead of a code. */
export function getCapturedAuthError(): string | null {
  return captured.error;
}

// ============================================================================
// Callbacks that arrive after load (store apps)
// ============================================================================

/** A provider's answer, delivered to the page as a link rather than a load. */
export interface DeliveredAuthCallback {
  readonly code: string | null;
  readonly error: string | null;
}

type AuthCallbackListener = (callback: DeliveredAuthCallback) => void;

const listeners = new Set<AuthCallbackListener>();

/**
 * Codes already handed to a listener. The same link can arrive twice: once
 * from `App.getLaunchUrl()` on a cold start and once as `appUrlOpen`.
 */
const deliveredCodes = new Set<string>();

/**
 * Answers that arrived before anybody subscribed. A cold start from a sign-in
 * link reads the launch URL before `AuthProvider` has mounted.
 */
const pending: DeliveredAuthCallback[] = [];

/**
 * Reads the auth answer out of a link, if it carries one.
 *
 * @param url - The full link the operating system opened the app with
 */
export function readAuthCallbackUrl(url: string): DeliveredAuthCallback | null {
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return null;
  }
  const code = params.get('code');
  const error = params.get('error_description') ?? params.get('error');
  if (code === null && error === null) {
    return null;
  }
  return { code, error };
}

/**
 * Hands a link's auth answer to the subscribed listeners.
 *
 * @param url - The full link the operating system opened the app with
 * @returns Whether the link carried an auth answer
 */
export function deliverAuthCallbackUrl(url: string): boolean {
  const callback = readAuthCallbackUrl(url);
  if (callback === null) {
    return false;
  }
  if (callback.code !== null) {
    if (deliveredCodes.has(callback.code)) {
      return true;
    }
    deliveredCodes.add(callback.code);
  }
  if (listeners.size === 0) {
    pending.push(callback);
    return true;
  }
  for (const listener of listeners) {
    try {
      listener(callback);
    } catch (error: unknown) {
      console.error('[auth] callback listener failed:', error);
    }
  }
  return true;
}

/**
 * Subscribes to auth answers that arrive as links.
 *
 * @returns The unsubscribe function
 */
export function onAuthCallback(listener: AuthCallbackListener): () => void {
  listeners.add(listener);
  for (const callback of pending.splice(0)) {
    listener(callback);
  }
  return () => {
    listeners.delete(listener);
  };
}

