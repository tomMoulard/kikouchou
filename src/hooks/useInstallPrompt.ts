/**
 * @fileoverview Custom hook for managing PWA installation prompt.
 * Captures the beforeinstallprompt event and provides install functionality.
 *
 * @module hooks/useInstallPrompt
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { reportGoogleAdsInstallConversion } from '@/lib/google-tag';
import { trackMetaPixelCustomEvent } from '@/lib/meta-pixel';
import { captureEvent } from '@/lib/posthog';
import { STANDALONE_MEDIA_QUERY, isRunningStandalone } from '@/lib/pwa/display-mode';

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
   * Whether this visit carries an explicit install request — the `?install=1`
   * the landing page's "Install on your phone" CTA links to.
   *
   * True means the visitor has already said yes, so the UI may skip the
   * heuristics it applies to an unsolicited offer. It is deliberately not
   * persisted: the parameter is spent on arrival, and the next visit without
   * one is an ordinary visit.
   */
  readonly installIntent: boolean;

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
 * Query parameter carrying an install request from the landing page, and the
 * one value that counts as one: `https://app.kikouchou.app/?install=1`.
 */
const INSTALL_PARAM = 'install',
 INSTALL_PARAM_VALUE = '1';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Reads the install request off the current URL.
 *
 * Called once per mount, before {@link spendInstallRequest} takes the parameter
 * back out — anything that reads `location.search` afterwards sees a clean URL,
 * which is the point.
 *
 * @returns True if this visit asked for the install UI
 */
function readInstallRequest(): boolean {
  if (typeof window === 'undefined') {return false;}

  return (
    new URLSearchParams(window.location.search).get(INSTALL_PARAM) ===
    INSTALL_PARAM_VALUE
  );
}

/**
 * Takes the install parameter out of the address bar.
 *
 * A request is for one arrival. Left in place it survives a reload, a bookmark
 * and a link the visitor forwards to somebody else, and each of those would
 * bypass the dismissal window again.
 *
 * Two details are load-bearing. The hash is carried across because a share link
 * keeps the trip's encryption key there, and the existing `history.state` is
 * passed back because React Router keeps its own entry key and index in it and
 * reads them on `popstate`; replacing the entry with a null state breaks the
 * Back button. Any value of the parameter is removed, not only the one that
 * counts as a request — it is this app's parameter either way.
 */
function spendInstallRequest(): void {
  if (typeof window === 'undefined') {return;}

  const url = new URL(window.location.href);
  if (!url.searchParams.has(INSTALL_PARAM)) {return;}

  url.searchParams.delete(INSTALL_PARAM);
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  );
}

/**
 * Checks if the app is installed using getInstalledRelatedApps API.
 * This API is only available in some browsers (Chrome on Android).
 *
 * @returns Promise resolving to true if app is found in related apps
 */
async function checkInstalledRelatedApps(): Promise<boolean> {
  if (typeof navigator === 'undefined') {return false;}

  // Feature detection for getInstalledRelatedApps
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- `getInstalledRelatedApps` is Chromium-only and absent from lib.dom.
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
 * - Reads and then spends an `?install=1` request from the landing page
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
    useState<BeforeInstallPromptEvent | null>(null),

  /**
   * Whether the app is detected as already installed.
   */
   [isInstalled, setIsInstalled] = useState<boolean>(() =>
    isRunningStandalone(),
  ),

  /**
   * Whether installation is currently in progress.
   */
   [isInstalling, setIsInstalling] = useState(false),

  /**
   * Whether this visit carries an install request.
   *
   * Read on the first render rather than in the effect that spends it, because
   * by the time any effect has run the parameter is gone from the URL — and
   * read into state rather than recomputed, so the answer cannot change under
   * the components rendering from it.
   */
   [installIntent] = useState<boolean>(readInstallRequest),

  // ============================================================================
  // Refs
  // ============================================================================

  /**
   * Tracks whether the component is still mounted.
   * Used to prevent state updates after unmount.
   */
   isMountedRef = useRef(true),

  /**
   * Ref to track installing state for the guard check.
   * Using a ref avoids stale closure issues in the install callback.
   */
   isInstallingRef = useRef(false),

  /**
   * Whether this page ever fired the native prompt from the app's own button.
   *
   * A ref because the `appinstalled` listener below reads it, and that listener
   * is registered once: state would be a value from the first render, and the
   * whole question is what happened after it.
   */
   hasPromptedRef = useRef(false);

  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Cleanup effect to track component unmount.
   */
  useEffect(() => {
    // Set on setup, not only in cleanup: StrictMode's dev-time
    // mount -> cleanup -> mount cycle would otherwise latch this false
    // forever, silently turning every guarded setState into a no-op.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /**
   * Spend the install request by taking the parameter out of the URL.
   *
   * Separate from the listener effect below, and unconditional: the parameter
   * is removed whatever its value, while only `installIntent` above decides
   * whether it asked for anything.
   */
  useEffect(() => {
    spendInstallRequest();
  }, []);

  /**
   * Set up event listeners and check installation status.
   */
  useEffect(() => {
    // Guard for SSR
    if (typeof window === 'undefined') {return;}

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
      /*
        The one signal that sees every install.

        This capture used to sit on the Install button's own success, which only
        ever fires for Chromium's native prompt — an install through the
        browser's own menu, or through an iPhone's share sheet, was invisible
        to it. `appinstalled` is fired by the browser however the app got
        installed, so the button's involvement is now a property of this event
        rather than the thing that triggers it.

        One capture per install rests on this hook having one consumer:
        `InstallPromptProvider`, which `App` mounts once and which hands the
        result to the banner and the nudge alike through
        `contexts/InstallPromptContext`. A second consumer would register a
        second listener and count the install twice — read the context, do
        not call this hook.
      */
      // Whether the app's own Install button produced this, as against
      // something in the browser's UI that we never see.
      const viaPrompt = hasPromptedRef.current;
      // Whether this visit arrived on the landing page's install link, which
      // is what makes that CTA measurable at all.
      const fromInstallLink = installIntent;

      captureEvent('pwa_install_completed', {
        via_prompt: viaPrompt,
        from_install_link: fromInstallLink,
      });

      /*
        The same install, reported to Meta as well.

        Both, not either: PostHog is how this project understands its own
        product, and the pixel is how an ad campaign is optimised, and neither
        can answer the other's question. The names differ because each tool
        has its own convention — PostHog wants `noun_verb_past`, Events
        Manager shows the string as written — and `AppInstalled` is a custom
        event because Meta's standard list has no web install in it.

        A no-op unless `VITE_META_PIXEL_ID` is set on a deployed host, so a dev
        server and the e2e suite report nothing. Nothing here names a trip, a
        guest or a place; the two flags are the whole payload.
      */
      trackMetaPixelCustomEvent('AppInstalled', {
        via_prompt: viaPrompt,
        from_install_link: fromInstallLink,
      });

      /*
        And to Google Ads, which is the other platform the campaigns run on.

        No properties: a Google Ads conversion carries a value and a currency
        rather than dimensions, and the two flags above are for the tools that
        can slice by them. See `lib/google-tag` for why the value is set on the
        conversion action rather than here.
      */
      reportGoogleAdsInstallConversion();

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
    // `installIntent` never changes after the first render, so this listed
    // dependency cannot re-register the listeners; it is here because the
    // `appinstalled` capture above reads it.
  }, [installIntent]);

  // ============================================================================
  // Derived Values
  // ============================================================================

  /**
   * Whether the app can be installed.
   * True when we have a deferred prompt and the app is not already installed.
   */
  const canInstall = deferredPrompt !== null && !isInstalled,

  // ============================================================================
  // Handlers
  // ============================================================================

  /**
   * Triggers the native install prompt.
   *
   * @returns Promise resolving to true if installed, false if dismissed or failed
   */
   install = useCallback(async (): Promise<boolean> => {
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
    hasPromptedRef.current = true;
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
    installIntent,
    install,
  };
}
