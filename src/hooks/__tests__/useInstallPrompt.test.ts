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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

});
