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
  // The real module exports `undefined` without env config, which is the case
  // in tests, so nothing here could observe a capture without this.
  default: { capture: (...args: unknown[]) => mockCapture(...args) },
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

/**
 * Replaces the two navigator properties the manual-steps branch reads.
 *
 * `Navigator.prototype` owns both getters, so an own property shadows them for
 * the test and `deleteProperty` in the teardown puts the real ones back —
 * assigning a "default" user agent instead would leave every later test in the
 * file running on a fake browser.
 */
function stubBrowser(userAgent: string, maxTouchPoints = 0): void {
  Object.defineProperty(navigator, 'userAgent', {
    value: userAgent,
    configurable: true,
  });
  Object.defineProperty(navigator, 'maxTouchPoints', {
    value: maxTouchPoints,
    configurable: true,
  });
}

/**
 * User agents copied from the browsers whose install route differs. The Firefox
 * ones differ only in their platform token, which is the whole point: it is the
 * only thing that separates "Add tab to taskbar", "Add tab to taskbar behind a
 * pref" and "there is no install here".
 */
const USER_AGENTS = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipad:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  firefoxAndroid:
    'Mozilla/5.0 (Android 14; Mobile; rv:142.0) Gecko/142.0 Firefox/142.0',
  firefoxWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0',
  firefoxLinux:
    'Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0',
  firefoxMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:142.0) Gecko/20100101 Firefox/142.0',
  firefoxIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
} as const;

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
    Reflect.deleteProperty(navigator, 'userAgent');
    Reflect.deleteProperty(navigator, 'maxTouchPoints');
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
   * `beforeinstallprompt` is Chromium's alone. Everywhere else `canInstall`
   * stays false for good, so an install request has nothing to fire and the
   * only thing left to offer is the browser's own route — which is a different
   * sequence of taps in each of these, and absent in one of them.
   */
  describe('manualInstallPlatform', () => {
    it('sends iPhone Safari through the share sheet', () => {
      stubBrowser(USER_AGENTS.iphone);

      const { result } = renderHook(() => useInstallPrompt());

      expect(result.current.manualInstallPlatform).toBe('ios');
    });

    it('sends iPadOS Safari, which claims to be a Mac, through the share sheet', () => {
      // iPadOS 13+ sends a desktop Safari user agent. The touch points are all
      // that is left to tell an iPad from a Mac.
      stubBrowser(USER_AGENTS.ipad, 5);

      const { result } = renderHook(() => useInstallPrompt());

      expect(result.current.manualInstallPlatform).toBe('ios');
    });

    it('does not read a Mac as an iPad', () => {
      stubBrowser(USER_AGENTS.ipad, 0);

      const { result } = renderHook(() => useInstallPrompt());

      expect(result.current.manualInstallPlatform).toBe('generic');
    });

    it('sends Firefox on iOS through the share sheet, not the Firefox menu', () => {
      // Every engine on iOS is WebKit, so the platform decides before the
      // browser does. Checking Firefox first would print a menu item that is
      // not there.
      stubBrowser(USER_AGENTS.firefoxIos);

      const { result } = renderHook(() => useInstallPrompt());

      expect(result.current.manualInstallPlatform).toBe('ios');
    });

    it('sends Firefox on Android to its own menu', () => {
      stubBrowser(USER_AGENTS.firefoxAndroid, 5);

      const { result } = renderHook(() => useInstallPrompt());

      expect(result.current.manualInstallPlatform).toBe('firefoxAndroid');
    });

    it('sends Firefox on Windows to the taskbar tab', () => {
      stubBrowser(USER_AGENTS.firefoxWindows);

      const { result } = renderHook(() => useInstallPrompt());

      expect(result.current.manualInstallPlatform).toBe('firefoxWindows');
    });

    it('sends Firefox on Linux to the taskbar tab behind its pref', () => {
      stubBrowser(USER_AGENTS.firefoxLinux);

      const { result } = renderHook(() => useInstallPrompt());

      expect(result.current.manualInstallPlatform).toBe('firefoxLinux');
    });

    it('tells Firefox on macOS there is nothing to install', () => {
      stubBrowser(USER_AGENTS.firefoxMac);

      const { result } = renderHook(() => useInstallPrompt());

      expect(result.current.manualInstallPlatform).toBe('firefoxMac');
    });

    it('falls back to the generic menu on Chromium', () => {
      stubBrowser(USER_AGENTS.chromeAndroid, 5);

      const { result } = renderHook(() => useInstallPrompt());

      expect(result.current.manualInstallPlatform).toBe('generic');
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
