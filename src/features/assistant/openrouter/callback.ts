/**
 * @fileoverview Captures OpenRouter's callback out of the URL, first thing.
 *
 * OpenRouter sends the user back to `/assistant?code=…&state=…`. That `code`
 * parameter has the same name as the one Supabase uses, and
 * `lib/supabase/auth-callback` takes any `?code=` it finds at import time as a
 * Supabase sign-in. Exchanging an OpenRouter code with Supabase fails, and the
 * user would see a sign-in error for a sign-in they never started.
 *
 * So `main.tsx` imports this module **before** that one. It claims the code
 * only when two things hold: the page is the assistant, which is the only
 * callback URL this flow ever sends, and this browser holds a pending
 * OpenRouter request. Then it strips `code` and `state` off the URL, so the
 * Supabase capture finds nothing and a reload does not replay a spent code.
 *
 * Reading `window.location` here is the same exception
 * `lib/supabase/auth-callback` makes, for the same reason: the router may
 * normalise the URL before any component looks at it.
 *
 * @module features/assistant/openrouter/callback
 */

import { type OpenRouterCallback, readPendingConnect } from './auth';

// ============================================================================
// Constants
// ============================================================================

/** Last path segment of the page OpenRouter returns to. */
export const OPENROUTER_CALLBACK_SEGMENT = 'assistant';

// ============================================================================
// Capture
// ============================================================================

/**
 * Reads the callback from a URL, if this load is one.
 *
 * Exported for tests; the app calls it once, below, at import time.
 *
 * @param location - The page location
 * @param history - Where the cleaned URL is written
 * @returns The callback, or `null` when this load is not one
 */
export function captureOpenRouterCallback(
  location: Pick<Location, 'pathname' | 'search' | 'hash'>,
  history: Pick<History, 'replaceState' | 'state'>,
): OpenRouterCallback | null {
  const segments = location.pathname.split('/').filter((s) => s.length > 0);
  if (segments.at(-1) !== OPENROUTER_CALLBACK_SEGMENT) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(location.search);
  } catch {
    return null;
  }

  const code = params.get('code');
  if (code === null || code.length === 0) return null;
  if (readPendingConnect() === null) return null;

  const state = params.get('state');
  params.delete('code');
  params.delete('state');
  const query = params.toString();

  try {
    history.replaceState(
      history.state,
      '',
      `${location.pathname}${query.length > 0 ? `?${query}` : ''}${location.hash}`,
    );
  } catch {
    // Some webviews refuse replaceState. The code is captured already.
  }

  return { code, state };
}

const captured: OpenRouterCallback | null =
  typeof window === 'undefined'
    ? null
    : captureOpenRouterCallback(window.location, window.history);

let consumed = false;

// ============================================================================
// Public API
// ============================================================================

/**
 * Takes the callback, once.
 *
 * Module-level, like `consumeAuthCode`: StrictMode remounts the page, and a
 * code is single-use, so a second exchange would fail after the first worked.
 */
export function consumeOpenRouterCallback(): OpenRouterCallback | null {
  if (consumed || captured === null) return null;
  consumed = true;
  return captured;
}
