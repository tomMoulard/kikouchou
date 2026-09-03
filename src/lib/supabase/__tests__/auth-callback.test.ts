/**
 * Auth-callback capture tests.
 *
 * The module reads the URL once, at import, which is the whole point — so each
 * case sets `window.location` and then imports the module fresh with
 * `vi.resetModules()`. Anything that ran later would be racing the router, which
 * is precisely the bug this exists to fix.
 *
 * @module lib/supabase/__tests__/auth-callback.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================================
// Helpers
// ============================================================================

const originalLocation = window.location;

/** Points the document at a URL, the way a provider redirect would. */
function atUrl(url: string): void {
  const parsed = new URL(url);
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: {
      ...originalLocation,
      href: parsed.href,
      search: parsed.search,
      pathname: parsed.pathname,
      hash: parsed.hash,
      origin: parsed.origin,
    },
  });
}

/** Imports the module fresh, so its import-time capture runs again. */
async function importFresh(): Promise<
  typeof import('@/lib/supabase/auth-callback')
> {
  vi.resetModules();
  return import('@/lib/supabase/auth-callback');
}

let replaceState: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  replaceState = vi
    .spyOn(window.history, 'replaceState')
    .mockImplementation(() => undefined);
});

afterEach(() => {
  replaceState.mockRestore();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
  vi.resetModules();
});

// ============================================================================
// Capture
// ============================================================================

describe('auth-callback capture', () => {
  it('captures the authorization code from a callback URL', async () => {
    atUrl('https://kikouchou.app/?code=auth-code-123');

    const module = await importFresh();

    expect(module.consumeAuthCode()).toBe('auth-code-123');
  });

  it('captures a provider error in place of a code', async () => {
    atUrl('https://kikouchou.app/?error=access_denied&error_description=User%20cancelled');

    const module = await importFresh();

    // error_description is the readable one, so it wins over the bare code.
    expect(module.getCapturedAuthError()).toBe('User cancelled');
    expect(module.consumeAuthCode()).toBeNull();
  });

  it('falls back to the bare error code when there is no description', async () => {
    atUrl('https://kikouchou.app/?error=server_error');

    const module = await importFresh();

    expect(module.getCapturedAuthError()).toBe('server_error');
  });

  it('reports nothing for an ordinary page load', async () => {
    atUrl('https://kikouchou.app/trips');

    const module = await importFresh();

    expect(module.consumeAuthCode()).toBeNull();
    expect(module.getCapturedAuthError()).toBeNull();
    // And leaves a normal URL alone.
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('strips the code from the URL so a reload cannot reuse it', async () => {
    atUrl('https://kikouchou.app/?code=auth-code-123');

    await importFresh();

    // An authorization code is single-use; leaving it in the bar means a reload
    // fails the exchange and looks like a broken sign-in.
    expect(replaceState).toHaveBeenCalledTimes(1);
    const nextUrl = String(replaceState.mock.calls[0]?.[2]);
    expect(nextUrl).not.toContain('code=');
  });

  it('keeps unrelated query parameters', async () => {
    atUrl('https://kikouchou.app/trips?code=auth-code-123&view=timeline');

    await importFresh();

    // A deep link may legitimately carry its own query; discarding all of it
    // would break navigating straight to a filtered view.
    const nextUrl = String(replaceState.mock.calls[0]?.[2]);
    expect(nextUrl).toContain('view=timeline');
    expect(nextUrl).not.toContain('code=');
    expect(nextUrl).toContain('/trips');
  });

  it('preserves the path and hash', async () => {
    atUrl('https://kikouchou.app/kikouchou/?code=abc#main-content');

    await importFresh();

    const nextUrl = String(replaceState.mock.calls[0]?.[2]);
    expect(nextUrl).toBe('/kikouchou/#main-content');
  });

  it('strips the OAuth state parameter too', async () => {
    atUrl('https://kikouchou.app/?code=abc&state=xyz');

    await importFresh();

    const nextUrl = String(replaceState.mock.calls[0]?.[2]);
    expect(nextUrl).not.toContain('state=');
  });

  it('still reports the code when replaceState is refused', async () => {
    atUrl('https://kikouchou.app/?code=auth-code-123');
    replaceState.mockImplementation(() => {
      throw new Error('blocked in this webview');
    });

    const module = await importFresh();

    // Cleaning the URL is a nicety; losing the code would break sign-in.
    expect(module.consumeAuthCode()).toBe('auth-code-123');
  });

  it('hands the code out exactly once', async () => {
    atUrl('https://kikouchou.app/?code=auth-code-123');

    const module = await importFresh();

    // An authorization code is single-use, and supabase-js deletes the PKCE
    // verifier on a successful exchange. React StrictMode remounts the effect
    // that performs it, so handing the same code out twice produced a first
    // exchange that worked and a second that failed with "PKCE code verifier
    // not found in storage" — surfaced as a sign-in failure after sign-in had
    // actually succeeded. Observed in the browser; this is the guard.
    expect(module.consumeAuthCode()).toBe('auth-code-123');
    expect(module.consumeAuthCode()).toBeNull();
    expect(module.consumeAuthCode()).toBeNull();
  });


});
