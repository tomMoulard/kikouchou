/**
 * @fileoverview Custom hook for managing PWA installation prompt.
 * Captures the beforeinstallprompt event and provides install functionality.
 *
 * @module hooks/useInstallPrompt
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * The BeforeInstallPromptEvent interface.
 * This event is fired when the browser determines the app can be installed.
 * Not part of standard TypeScript types, so we define it here.
 */
interface BeforeInstallPromptEvent extends Event {
  /**
   * Array of platforms the browser supports for installation.
   */
  readonly platforms: string[];

  /**
   * Promise that resolves when the user responds to the install prompt.
   */
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;

  /**
   * Shows the install prompt to the user.
   */
  prompt(): Promise<void>;
}

/**
 * Extend the WindowEventMap to include the beforeinstallprompt event.
 */
declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
    appinstalled: Event;
  }
}

/**
 * Return type for the useInstallPrompt hook.
 */
export interface UseInstallPromptResult {
  /**
   * Whether the app can be installed (prompt available and app not installed).
   */
  readonly canInstall: boolean;

  /**
   * Whether the app is already installed.
   */
  readonly isInstalled: boolean;

  /**
   * Whether an installation is currently in progress.
   */
  readonly isInstalling: boolean;

  /**
   * Triggers the native install prompt.
   * @returns Promise resolving to true if installed, false if dismissed or failed
   */
  install: () => Promise<boolean>;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Media query for detecting standalone display mode (installed PWA).
 */
const STANDALONE_MEDIA_QUERY = '(display-mode: standalone)';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Checks if the app is running in standalone mode (installed PWA).
 *
 * @returns True if running as installed PWA
 */
function isRunningStandalone(): boolean {
  if (typeof window === 'undefined') return false;

  // Check display-mode media query
  if (window.matchMedia(STANDALONE_MEDIA_QUERY).matches) {
    return true;
  }

  // Check iOS standalone mode
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = navigator as any;
  if (nav.standalone === true) {
    return true;
  }

  return false;
}

/**
 * Checks if the app is installed using getInstalledRelatedApps API.
 * This API is only available in some browsers (Chrome on Android).
 *
 * @returns Promise resolving to true if app is found in related apps
 */
async function checkInstalledRelatedApps(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;

  // Feature detection for getInstalledRelatedApps
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = navigator as any;
  if (typeof nav.getInstalledRelatedApps !== 'function') {
    return false;
  }

  try {
    const relatedApps = await nav.getInstalledRelatedApps();
    return Array.isArray(relatedApps) && relatedApps.length > 0;
  } catch {
    // API not available or failed
    return false;
  }
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Custom hook for managing PWA installation prompt.
 *
 * Features:
 * - Captures the beforeinstallprompt event from the window
 * - Detects if the app is already installed
 * - Provides an install function that triggers the native prompt
 * - Properly cleans up event listeners on unmount
 * - Uses isMountedRef pattern for async safety
 *
 * @returns Object containing canInstall, isInstalled, isInstalling, and install function
 *
 * @example
 * ```tsx
 * function InstallButton() {
 *   const { canInstall, install, isInstalling } = useInstallPrompt();
 *
 *   if (!canInstall) return null;
 *
 *   return (
 *     <button onClick={install} disabled={isInstalling}>
 *       Install App
 *     </button>
 *   );
 * }
 * ```
 */
export function useInstallPrompt(): UseInstallPromptResult {
  // ============================================================================
  // State
  // ============================================================================

  /**
   * The deferred install prompt event.
   * Null until the browser fires beforeinstallprompt.
   */
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  /**
   * Whether the app is detected as already installed.
   */
  const [isInstalled, setIsInstalled] = useState<boolean>(() =>
    isRunningStandalone(),
  );

  /**
   * Whether installation is currently in progress.
   */
  const [isInstalling, setIsInstalling] = useState(false);

  // ============================================================================
  // Refs
  // ============================================================================

  /**
   * Tracks whether the component is still mounted.
   * Used to prevent state updates after unmount.
   */
  const isMountedRef = useRef(true);

  /**
   * Ref to track installing state for the guard check.
   * Using a ref avoids stale closure issues in the install callback.
   */
  const isInstallingRef = useRef(false);

  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Cleanup effect to track component unmount.
   */
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /**
   * Set up event listeners and check installation status.
   */
  useEffect(() => {
    // Guard for SSR
    if (typeof window === 'undefined') return;

    /**
     * Handler for the beforeinstallprompt event.
     * Captures the event for later use and prevents the default browser prompt.
     */
    function handleBeforeInstallPrompt(event: BeforeInstallPromptEvent): void {
      // Prevent the mini-infobar from appearing on mobile
      event.preventDefault();

      // Store the event for later use
      if (isMountedRef.current) {
        setDeferredPrompt(event);
      }
    }

    /**
     * Handler for the appinstalled event.
     * Fired when the PWA is successfully installed.
     */
    function handleAppInstalled(): void {
      if (isMountedRef.current) {
        setIsInstalled(true);
        setDeferredPrompt(null);
      }
    }

    /**
     * Handler for display-mode media query changes.
     * Detects when app enters standalone mode.
     */
    function handleDisplayModeChange(event: MediaQueryListEvent): void {
      if (isMountedRef.current && event.matches) {
        setIsInstalled(true);
      }
    }

    // Add event listeners
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    // Set up media query listener for standalone mode changes
    const mediaQuery = window.matchMedia(STANDALONE_MEDIA_QUERY);
    mediaQuery.addEventListener('change', handleDisplayModeChange);

    // Check if already installed via related apps API
    void checkInstalledRelatedApps().then((installed) => {
      if (isMountedRef.current && installed) {
        setIsInstalled(true);
      }
    });

    // Cleanup
    return () => {
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt,
      );
      window.removeEventListener('appinstalled', handleAppInstalled);
      mediaQuery.removeEventListener('change', handleDisplayModeChange);
    };
  }, []);

  // ============================================================================
  // Derived Values
  // ============================================================================

  /**
   * Whether the app can be installed.
   * True when we have a deferred prompt and the app is not already installed.
   */
  const canInstall = deferredPrompt !== null && !isInstalled;

  // ============================================================================
  // Handlers
  // ============================================================================

  /**
   * Triggers the native install prompt.
   *
   * @returns Promise resolving to true if installed, false if dismissed or failed
   */
  const install = useCallback(async (): Promise<boolean> => {
    // Guard: No prompt available
    if (!deferredPrompt) {
      console.warn('No install prompt available');
      return false;
    }

    // Guard: Already installing (use ref to avoid stale closure)
    if (isInstallingRef.current) {
      return false;
    }

    isInstallingRef.current = true;
    setIsInstalling(true);

    try {
      // Show the install prompt
      await deferredPrompt.prompt();

      // Wait for the user's response
      const { outcome } = await deferredPrompt.userChoice;

      if (!isMountedRef.current) {
        return outcome === 'accepted';
      }

      // Clear the deferred prompt after any outcome
      // The prompt() method can typically only be called once per event
      setDeferredPrompt(null);

      return outcome === 'accepted';
    } catch (error) {
      console.error('Failed to show install prompt:', error);
      // Clear the prompt on error as it may be invalidated
      if (isMountedRef.current) {
        setDeferredPrompt(null);
      }
      return false;
    } finally {
      isInstallingRef.current = false;
      if (isMountedRef.current) {
        setIsInstalling(false);
      }
    }
  }, [deferredPrompt]);

  // ============================================================================
  // Return
  // ============================================================================

  return {
    canInstall,
    isInstalled,
    isInstalling,
    install,
  };
}
