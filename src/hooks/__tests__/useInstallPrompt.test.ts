/**
 * @fileoverview Tests for useInstallPrompt hook.
 * @module hooks/__tests__/useInstallPrompt.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { useInstallPrompt } from '../useInstallPrompt';

// ============================================================================
// Mocks
// ============================================================================

const mockCapture = vi.fn();

vi.mock('@/lib/posthog', () => ({
  // Named export used by every catch block that reports; a mock
  // without it makes the reporter itself the error under test.
  reportError: vi.fn(),
  // The real module exports `undefined` without env config, which is the case
  // in tests, so nothing here could observe a capture without this.
  default: { capture: (...args: unknown[]) => mockCapture(...args) },
  captureEvent: (...args: unknown[]) => mockCapture(...args),
}));

const mockTrackMetaPixelCustomEvent = vi.fn();

/*
  The Meta Pixel is the second reporter of the same install, and it is mocked
  for the same reason PostHog is: the real module loads nothing without
  `VITE_META_PIXEL_ID`, so an assertion on it would pass whether or not the
  hook called it.
*/
vi.mock('@/lib/meta-pixel', () => ({
  trackMetaPixelCustomEvent: (...args: unknown[]) =>
    mockTrackMetaPixelCustomEvent(...args),
  trackMetaPixelEvent: vi.fn(),
  isMetaPixelEnabled: () => false,
  default: undefined,
}));

const mockReportGoogleAdsInstallConversion = vi.fn();

/* The third reporter of one install, mocked for the same reason as the other
   two: the real module loads nothing without an Ads id, so an assertion on it
   would pass whether or not the hook called it. */
vi.mock('@/lib/google-tag', () => ({
  reportGoogleAdsInstallConversion: (...args: unknown[]) =>
    mockReportGoogleAdsInstallConversion(...args),
  reportGoogleAdsConversion: vi.fn(),
  trackGoogleTagEvent: vi.fn(),
  isGoogleAdsTagEnabled: () => false,
  default: undefined,
}));

function dispatchBeforeInstallPrompt(
  outcome: 'accepted' | 'dismissed' = 'accepted',
) {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  Object.defineProperties(event, {
    platforms: { value: ['web'], writable: false },
    prompt: { value: vi.fn().mockResolvedValue(undefined), writable: false },
    userChoice: {
      value: Promise.resolve({ outcome, platform: 'web' }),
      writable: false,
    },
  });
  window.dispatchEvent(event);
  return event;
}

/**
 * Points `window.location` at `url` without a reload — a visitor arriving on
 * the landing page's install link, as far as this hook can tell.
 */
function visit(url: string): void {
  window.history.replaceState(null, '', url);
}

// ============================================================================
// Tests
// ============================================================================

describe('useInstallPrompt', () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    // Default: not standalone
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    // Reset navigator.standalone
    Object.defineProperty(navigator, 'standalone', {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    // `?install=1` in the address bar is read by every later mount in this
    // file, so a test that puts it there has to take it back out.
    visit('/');
  });

  it('returns canInstall: false initially (no prompt event)', () => {
    const { result } = renderHook(() => useInstallPrompt());

    expect(result.current.canInstall).toBe(false);
    expect(result.current.isInstalled).toBe(false);
    expect(result.current.isInstalling).toBe(false);
  });

  it('sets canInstall: true when beforeinstallprompt fires', () => {
    const { result } = renderHook(() => useInstallPrompt());

    act(() => {
      dispatchBeforeInstallPrompt();
    });

    expect(result.current.canInstall).toBe(true);
  });

  it('calls prompt and returns true on accepted', async () => {
    const { result } = renderHook(() => useInstallPrompt());

    act(() => {
      dispatchBeforeInstallPrompt('accepted');
    });

    let installResult = false;
    await act(async () => {
      installResult = await result.current.install();
    });

    expect(installResult).toBe(true);
    expect(result.current.canInstall).toBe(false); // prompt cleared
  });

  it('returns false on dismissed', async () => {
    const { result } = renderHook(() => useInstallPrompt());

    act(() => {
      dispatchBeforeInstallPrompt('dismissed');
    });

    let installResult = true;
    await act(async () => {
      installResult = await result.current.install();
    });

    expect(installResult).toBe(false);
  });

  it('returns false when no prompt is available', async () => {
    const { result } = renderHook(() => useInstallPrompt());

    let installResult = true;
    await act(async () => {
      installResult = await result.current.install();
    });

    expect(installResult).toBe(false);
  });

  it('sets isInstalled: true when appinstalled event fires', () => {
    const { result } = renderHook(() => useInstallPrompt());

    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });

    expect(result.current.isInstalled).toBe(true);
    expect(result.current.canInstall).toBe(false);
  });

  it('detects standalone mode at initialization', () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true, // standalone
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    const { result } = renderHook(() => useInstallPrompt());

    expect(result.current.isInstalled).toBe(true);
    expect(result.current.canInstall).toBe(false);
  });

  it('detects iOS standalone mode', () => {
    Object.defineProperty(navigator, 'standalone', {
      value: true,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useInstallPrompt());

    expect(result.current.isInstalled).toBe(true);
  });

  it('handles prompt error gracefully', async () => {
    const { result } = renderHook(() => useInstallPrompt());

    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.defineProperties(event, {
      platforms: { value: ['web'], writable: false },
      prompt: {
        value: vi.fn().mockRejectedValue(new Error('prompt failed')),
        writable: false,
      },
      userChoice: {
        value: Promise.resolve({
          outcome: 'dismissed' as const,
          platform: 'web',
        }),
        writable: false,
      },
    });

    act(() => {
      window.dispatchEvent(event);
    });

    let installResult = true;
    await act(async () => {
      installResult = await result.current.install();
    });

    expect(installResult).toBe(false);
    expect(result.current.isInstalling).toBe(false);
  });

  it('prevents double install calls', async () => {
    const { result } = renderHook(() => useInstallPrompt());

    let resolvePrompt: () => void;
    const promptPromise = new Promise<void>((r) => {
      resolvePrompt = r;
    });

    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.defineProperties(event, {
      platforms: { value: ['web'], writable: false },
      prompt: { value: vi.fn().mockReturnValue(promptPromise), writable: false },
      userChoice: {
        value: Promise.resolve({
          outcome: 'accepted' as const,
          platform: 'web',
        }),
        writable: false,
      },
    });

    act(() => {
      window.dispatchEvent(event);
    });

    // Start first install (inside act to avoid warning)
    let firstInstall: Promise<boolean>;
    act(() => {
      firstInstall = result.current.install();
    });

    // Second call should return false immediately
    let secondResult = true;
    await act(async () => {
      secondResult = await result.current.install();
    });
    expect(secondResult).toBe(false);

    // Complete first install
    await act(async () => {
      resolvePrompt!();
      await firstInstall!;
    });
  });

  it('cleans up event listeners on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useInstallPrompt());

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'beforeinstallprompt',
      expect.any(Function),
    );
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'appinstalled',
      expect.any(Function),
    );

    removeEventListenerSpy.mockRestore();
  });

  it('detects standalone via display-mode media query change', async () => {
    let changeHandler: ((e: MediaQueryListEvent) => void) | null = null;
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: (event: string, handler: (e: MediaQueryListEvent) => void) => {
        if (event === 'change') changeHandler = handler;
      },
      removeEventListener: vi.fn(),
    });

    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.isInstalled).toBe(false);

    // Simulate media query change to standalone
    act(() => {
      changeHandler?.({ matches: true } as MediaQueryListEvent);
    });

    expect(result.current.isInstalled).toBe(true);
  });

  it('detects installed via getInstalledRelatedApps API', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Stubbing the Chromium-only `getInstalledRelatedApps`, which lib.dom does not declare.
    const nav = navigator as any;
    nav.getInstalledRelatedApps = vi.fn().mockResolvedValue([{ platform: 'webapp' }]);

    const { result, unmount } = renderHook(() => useInstallPrompt());

    // Wait for the async check to complete
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.isInstalled).toBe(true);

    // Cleanup
    delete nav.getInstalledRelatedApps;
    unmount();
  });

  it('handles getInstalledRelatedApps returning empty array', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Stubbing the Chromium-only `getInstalledRelatedApps`, which lib.dom does not declare.
    const nav = navigator as any;
    nav.getInstalledRelatedApps = vi.fn().mockResolvedValue([]);

    const { result, unmount } = renderHook(() => useInstallPrompt());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.isInstalled).toBe(false);

    delete nav.getInstalledRelatedApps;
    unmount();
  });

  it('handles getInstalledRelatedApps API error gracefully', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Stubbing the Chromium-only `getInstalledRelatedApps`, which lib.dom does not declare.
    const nav = navigator as any;
    nav.getInstalledRelatedApps = vi.fn().mockRejectedValue(new Error('Not supported'));

    const { result, unmount } = renderHook(() => useInstallPrompt());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.isInstalled).toBe(false);

    delete nav.getInstalledRelatedApps;
    unmount();
  });

  it('returns outcome without setting state when component unmounts before userChoice resolves', async () => {
    let resolveUserChoice: (value: { outcome: 'accepted' | 'dismissed'; platform: string }) => void;
    const userChoicePromise = new Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>((r) => {
      resolveUserChoice = r;
    });

    const { result, unmount } = renderHook(() => useInstallPrompt());

    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.defineProperties(event, {
      platforms: { value: ['web'], writable: false },
      prompt: { value: vi.fn().mockResolvedValue(undefined), writable: false },
      userChoice: { value: userChoicePromise, writable: false },
    });

    act(() => {
      window.dispatchEvent(event);
    });

    // Start install
    let installPromise: Promise<boolean>;
    act(() => {
      installPromise = result.current.install();
    });

    // Unmount before userChoice resolves
    unmount();

    // Now resolve userChoice
    resolveUserChoice!({ outcome: 'accepted', platform: 'web' });

    const installResult = await installPromise!;
    expect(installResult).toBe(true);
  });

  /**
   * `isMountedRef` guards every `setCanInstall` / `setIsInstalled` in this hook,
   * and has to be set true on effect *setup*, not only reset to false in
   * cleanup.
   *
   * StrictMode runs setup -> cleanup -> setup on one component instance, so a
   * ref written only in cleanup latches false on the first pass and stays false
   * for the life of the component. Every guarded setState then silently no-ops:
   * the install button never appears, and nothing throws to say so. None of the
   * tests above can see it, because none runs a cleanup before the update it
   * checks.
   */
  describe('unmount guard under StrictMode', () => {
    it('still offers the install prompt after the double-invoked effect', () => {
      const { result } = renderHook(() => useInstallPrompt(), {
        wrapper: StrictMode,
      });

      expect(result.current.canInstall).toBe(false);

      act(() => {
        dispatchBeforeInstallPrompt();
      });

      expect(result.current.canInstall).toBe(true);
    });

    it('still records the app as installed after the double-invoked effect', () => {
      const { result } = renderHook(() => useInstallPrompt(), {
        wrapper: StrictMode,
      });

      act(() => {
        window.dispatchEvent(new Event('appinstalled'));
      });

      expect(result.current.isInstalled).toBe(true);
      expect(result.current.canInstall).toBe(false);
    });
  });

  /**
   * The landing page's "Install on your phone" CTA links to
   * `https://app.kikouchou.app/?install=1`.
   *
   * That parameter is the visitor having already said yes, so it outranks the
   * heuristics the banner otherwise applies — a dismissal last week, the
   * pre-show delay — and it is spent on arrival rather than remembered: a
   * reload, a bookmark or a link someone forwards must not keep asking.
   */
  describe('an explicit install request (?install=1)', () => {
    it('reports no request on an ordinary visit', () => {
      visit('/trips');

      const { result } = renderHook(() => useInstallPrompt());

      expect(result.current.installIntent).toBe(false);
    });

    it('reports the request when the parameter is there', () => {
      visit('/?install=1');

      const { result } = renderHook(() => useInstallPrompt());

      expect(result.current.installIntent).toBe(true);
    });

    it('reports no request for any other value', () => {
      visit('/?install=0');

      const { result } = renderHook(() => useInstallPrompt());

      expect(result.current.installIntent).toBe(false);
      // Still cleared, though: it is this app's parameter either way, and
      // leaving it in the address bar serves nothing.
      expect(window.location.search).toBe('');
    });

    it('strips the parameter, keeping the rest of the query and the hash', () => {
      visit('/join/abc?install=1&view=card#k=secret');

      renderHook(() => useInstallPrompt());

      expect(window.location.pathname).toBe('/join/abc');
      expect(window.location.search).toBe('?view=card');
      /*
        A share link carries the trip's encryption key in its fragment. Rebuild
        the URL from `pathname` and `search` alone and the invitation becomes
        permanently unopenable — the same class of bug as the skip link that
        overwrote that key.
      */
      expect(window.location.hash).toBe('#k=secret');
    });

    it('spends the request rather than storing it', () => {
      visit('/?install=1');

      const first = renderHook(() => useInstallPrompt());
      expect(first.result.current.installIntent).toBe(true);
      first.unmount();

      // Nothing was written anywhere, and the URL is clean, so the next visit
      // is an ordinary one under the normal heuristics.
      const second = renderHook(() => useInstallPrompt());

      expect(second.result.current.installIntent).toBe(false);
      expect(window.location.search).toBe('');
    });

    it('leaves an ordinary URL untouched', () => {
      visit('/trips?view=card');
      const replaceState = vi.spyOn(window.history, 'replaceState');

      renderHook(() => useInstallPrompt());

      expect(replaceState).not.toHaveBeenCalled();
      replaceState.mockRestore();
    });

    it('keeps the history entry react-router put there', () => {
      window.history.replaceState(
        { usr: null, key: 'abc123', idx: 3 },
        '',
        '/?install=1',
      );

      renderHook(() => useInstallPrompt());

      // React Router keeps its own key and index in `history.state` and reads
      // them back on `popstate`. Replacing the entry with a null state would
      // break the Back button, not the parameter.
      expect(window.history.state).toEqual({
        usr: null,
        key: 'abc123',
        idx: 3,
      });
      expect(window.location.search).toBe('');
    });

    it('still reports an installed app as installed', () => {
      visit('/?install=1');
      window.matchMedia = vi.fn().mockReturnValue({
        matches: true, // standalone: the app is open as an app
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });

      const { result } = renderHook(() => useInstallPrompt());

      expect(result.current.installIntent).toBe(true);
      expect(result.current.isInstalled).toBe(true);
      expect(result.current.canInstall).toBe(false);
    });
  });

  /**
   * Reporting the install.
   *
   * `appinstalled` is the browser's own word for "this app is installed now",
   * and the only signal that fires however it happened — the native prompt, the
   * browser's menu, an iOS share sheet. The capture used to hang off the
   * Install button's success instead, so every install outside Chromium's
   * prompt went unrecorded, which is most of them on a phone.
   */
  describe('analytics', () => {
    it('reports the install when the browser says it happened', () => {
      renderHook(() => useInstallPrompt());

      act(() => {
        window.dispatchEvent(new Event('appinstalled'));
      });

      expect(mockCapture).toHaveBeenCalledWith('pwa_install_completed', {
        via_prompt: false,
        from_install_link: false,
      });
    });

    it('reports the same install to the Meta Pixel as well', () => {
      /*
        Both reporters, not either. The pixel is what an ad campaign optimises
        against and PostHog is what the product is understood through, so a
        change that drops one of the two calls leaves a question unanswerable
        rather than merely duplicated. `AppInstalled` is a custom event because
        Meta's standard list has no web install in it.
      */
      renderHook(() => useInstallPrompt());

      act(() => {
        window.dispatchEvent(new Event('appinstalled'));
      });

      expect(mockTrackMetaPixelCustomEvent).toHaveBeenCalledWith('AppInstalled', {
        via_prompt: false,
        from_install_link: false,
      });
      expect(mockCapture).toHaveBeenCalledWith('pwa_install_completed', {
        via_prompt: false,
        from_install_link: false,
      });
    });

    it('carries the same flags to the pixel as to PostHog', () => {
      visit('/?install=1');

      renderHook(() => useInstallPrompt());

      act(() => {
        window.dispatchEvent(new Event('appinstalled'));
      });

      expect(mockTrackMetaPixelCustomEvent).toHaveBeenCalledWith('AppInstalled', {
        via_prompt: false,
        from_install_link: true,
      });
    });

    it('reports the install to Google Ads as well', () => {
      /*
        Three reporters, one event: PostHog for the product, Meta and Google
        for the two platforms the campaigns run on. Dropping any one of them
        leaves a question unanswerable rather than merely un-duplicated.
      */
      renderHook(() => useInstallPrompt());

      act(() => {
        window.dispatchEvent(new Event('appinstalled'));
      });

      expect(mockReportGoogleAdsInstallConversion).toHaveBeenCalledTimes(1);
    });

    it('tells Google nothing when no install happened', () => {
      renderHook(() => useInstallPrompt());

      act(() => {
        dispatchBeforeInstallPrompt('dismissed');
      });

      expect(mockReportGoogleAdsInstallConversion).not.toHaveBeenCalled();
    });

    it('tells the pixel nothing when no install happened', () => {
      renderHook(() => useInstallPrompt());

      act(() => {
        dispatchBeforeInstallPrompt('dismissed');
      });

      expect(mockTrackMetaPixelCustomEvent).not.toHaveBeenCalled();
    });

    it('marks an install the app own prompt produced', async () => {
      const { result } = renderHook(() => useInstallPrompt());

      act(() => {
        dispatchBeforeInstallPrompt('accepted');
      });
      await act(async () => {
        await result.current.install();
      });

      act(() => {
        window.dispatchEvent(new Event('appinstalled'));
      });

      expect(mockCapture).toHaveBeenCalledWith('pwa_install_completed', {
        via_prompt: true,
        from_install_link: false,
      });
    });

    it('marks an install that started on the landing page link', () => {
      visit('/?install=1');

      renderHook(() => useInstallPrompt());

      act(() => {
        window.dispatchEvent(new Event('appinstalled'));
      });

      expect(mockCapture).toHaveBeenCalledWith('pwa_install_completed', {
        via_prompt: false,
        from_install_link: true,
      });
    });

    it('reports nothing for an app that was already installed', () => {
      window.matchMedia = vi.fn().mockReturnValue({
        matches: true, // opened as an app, which is not an install
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });

      renderHook(() => useInstallPrompt());

      // A launch is not a conversion. Only the event fired above is.
      expect(mockCapture).not.toHaveBeenCalled();
    });
  });

});
