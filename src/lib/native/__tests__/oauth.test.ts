/**
 * @fileoverview `lib/native/oauth`: the store app's sign-in sheet, and how it ends.
 *
 * @module lib/native/__tests__/oauth.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const browser = vi.hoisted(() => {
  const finished: (() => void)[] = [];
  return {
    finished,
    open: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    addListener: vi.fn(async (_event: string, listener: () => void) => {
      finished.push(listener);
      return { remove: vi.fn(async () => undefined) };
    }),
  };
});

vi.mock('@capacitor/browser', () => ({ Browser: browser }));

import { closeBrowserSheet, openInBrowserSheet, runNativeOAuth } from '@/lib/native/oauth';
import { deliverAuthCallbackUrl, onAuthCallback } from '@/lib/supabase/auth-callback';

const AUTHORIZE = 'https://ref.supabase.co/auth/v1/authorize?provider=google';

/** A subscriber stands in for `AuthProvider`, so nothing is buffered. */
let unsubscribeProvider: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  browser.finished.length = 0;
  unsubscribeProvider = onAuthCallback(() => undefined);
});

afterEach(() => {
  unsubscribeProvider();
  vi.useRealTimers();
});

describe('runNativeOAuth', () => {
  it('opens the provider in the system sheet', async () => {
    const result = runNativeOAuth(AUTHORIZE);
    await Promise.resolve();

    expect(browser.open).toHaveBeenCalledWith({ url: AUTHORIZE });
    deliverAuthCallbackUrl('app.kikouchou://auth/callback?code=first');
    await expect(result).resolves.toEqual({ status: 'returned' });
  });

  it('closes the sheet once the provider sends the code back', async () => {
    const result = runNativeOAuth(AUTHORIZE);
    deliverAuthCallbackUrl('app.kikouchou://auth/callback?code=second');

    await expect(result).resolves.toEqual({ status: 'returned' });
    expect(browser.close).toHaveBeenCalled();
  });

  it("reports the provider's refusal with its own words", async () => {
    const result = runNativeOAuth(AUTHORIZE);
    deliverAuthCallbackUrl(
      'app.kikouchou://auth/callback?error=access_denied&error_description=The+user+said+no',
    );

    await expect(result).resolves.toEqual({ status: 'refused', message: 'The user said no' });
  });

  it('counts a closed sheet as cancelled, after the grace a late link needs', async () => {
    vi.useFakeTimers();
    const result = runNativeOAuth(AUTHORIZE);
    await vi.waitFor(() => expect(browser.finished).toHaveLength(1));

    browser.finished[0]?.();
    await vi.advanceTimersByTimeAsync(2000);

    await expect(result).resolves.toEqual({ status: 'cancelled' });
  });

  it('prefers a code that lands within the grace over the close', async () => {
    vi.useFakeTimers();
    const result = runNativeOAuth(AUTHORIZE);
    await vi.waitFor(() => expect(browser.finished).toHaveLength(1));

    // Android resumes the app a moment before it delivers the intent.
    browser.finished[0]?.();
    deliverAuthCallbackUrl('app.kikouchou://auth/callback?code=late');
    await vi.advanceTimersByTimeAsync(2000);

    await expect(result).resolves.toEqual({ status: 'returned' });
  });

  it('reports a sheet that would not open', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    browser.open.mockRejectedValueOnce(new Error('no browser'));

    await expect(runNativeOAuth(AUTHORIZE)).resolves.toEqual({ status: 'refused', message: null });
  });
});

describe('openInBrowserSheet', () => {
  it('resolves once the sheet is closed, by the user or by the listener', async () => {
    let done = false;
    const opened = openInBrowserSheet('https://openrouter.ai/auth').then(() => {
      done = true;
    });
    await vi.waitFor(() => expect(browser.open).toHaveBeenCalled());
    expect(done).toBe(false);

    browser.finished.at(-1)?.();
    await opened;

    expect(done).toBe(true);
  });

  it('reports a sheet that would not open', async () => {
    browser.open.mockRejectedValueOnce(new Error('no browser'));

    await expect(openInBrowserSheet('https://openrouter.ai/auth')).rejects.toThrow('no browser');
  });

  it('closes the sheet without minding one that is already closed', () => {
    browser.close.mockRejectedValueOnce(new Error('not open'));

    expect(() => closeBrowserSheet()).not.toThrow();
  });
});
