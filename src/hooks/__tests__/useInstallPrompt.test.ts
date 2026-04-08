/**
 * @fileoverview Tests for useInstallPrompt hook.
 * @module hooks/__tests__/useInstallPrompt.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
});
