/**
 * @fileoverview OAuth sign-in for the store apps, in a system browser sheet.
 *
 * Google refuses an OAuth consent screen inside an embedded web view
 * (`disallowed_useragent`), so the store apps cannot follow the redirect the
 * website follows. The provider's page opens in `SFSafariViewController` on
 * iOS and a Custom Tab on Android instead, and comes back to the app as
 * `app.kikouchou://auth/callback?code=…` (`NATIVE_AUTH_CALLBACK_URL`).
 *
 * This module only waits. The code exchange belongs to `AuthProvider`, which
 * subscribes to every callback link through `onAuthCallback`, email links
 * included. Exchanging here too would spend the single-use code twice.
 *
 * @module lib/native/oauth
 */

import { Browser } from '@capacitor/browser';

import { onAuthCallback } from '@/lib/supabase/auth-callback';

// ============================================================================
// Type Definitions
// ============================================================================

/** How the browser sheet ended. */
export type NativeOAuthResult =
  /** The provider sent a code back. The session arrives through the exchange. */
  | { readonly status: 'returned' }
  /**
   * The provider sent an error back, e.g. a refused consent screen, or the
   * sheet could not open. `message` is the provider's own text, when it sent
   * one; the caller translates the rest.
   */
  | { readonly status: 'refused'; readonly message: string | null }
  /** The user closed the sheet. */
  | { readonly status: 'cancelled' };

// ============================================================================
// Constants
// ============================================================================

/**
 * How long a closed sheet waits for the link before it counts as cancelled.
 *
 * On Android the app resumes, and so reports the sheet as finished, a moment
 * before the intent that carries the code is delivered.
 */
const CLOSE_GRACE_MS = 1500;

// ============================================================================
// Exports
// ============================================================================

/**
 * Opens the provider's page and waits for it to come back.
 *
 * @param authorizeUrl - The URL `signInWithOAuth({ skipBrowserRedirect: true })` returned
 */
export async function runNativeOAuth(authorizeUrl: string): Promise<NativeOAuthResult> {
  return new Promise<NativeOAuthResult>((resolve) => {
    let settled = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    let removeFinished: (() => void) | undefined;

    const finish = (result: NativeOAuthResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (graceTimer !== undefined) {
        clearTimeout(graceTimer);
      }
      unsubscribe();
      removeFinished?.();
      resolve(result);
    };

    const unsubscribe = onAuthCallback((callback) => {
      // Closing an already closed sheet is a no-op on both platforms.
      void Browser.close().catch(() => undefined);
      finish(
        callback.code !== null
          ? { status: 'returned' }
          : { status: 'refused', message: callback.error },
      );
    });

    void Browser.addListener('browserFinished', () => {
      graceTimer = setTimeout(() => finish({ status: 'cancelled' }), CLOSE_GRACE_MS);
    })
      .then((handle) => {
        removeFinished = () => void handle.remove();
        if (settled) {
          removeFinished();
        }
      })
      .catch(() => undefined);

    Browser.open({ url: authorizeUrl }).catch((error: unknown) => {
      console.error('[auth] could not open the sign-in sheet:', error);
      finish({ status: 'refused', message: null });
    });
  });
}

/**
 * Opens a page in the system browser sheet, and resolves once it is closed.
 *
 * For a flow whose answer comes back as a link another module listens for,
 * such as the assistant's OpenRouter sign-in: that listener closes the sheet.
 * The caller only learns that the sheet is gone, by either route.
 *
 * @param url - The page to open
 */
export async function openInBrowserSheet(url: string): Promise<void> {
  let finished: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    finished = resolve;
  });
  const handle = await Browser.addListener('browserFinished', () => {
    void handle.remove();
    finished();
  });
  try {
    await Browser.open({ url });
  } catch (error: unknown) {
    void handle.remove();
    throw error;
  }
  await closed;
}

/** Closes the system browser sheet, if one is open. */
export function closeBrowserSheet(): void {
  void Browser.close().catch(() => undefined);
}
