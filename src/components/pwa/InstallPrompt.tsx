/**
 * @fileoverview PWA Install Prompt component.
 * Displays a dismissible banner prompting users to install the app.
 *
 * @module components/pwa/InstallPrompt
 */

import {
  type ReactElement,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Download, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from '@/components/ui/card';
import {
  type ManualInstallPlatform,
  useInstallPrompt,
} from '@/hooks/useInstallPrompt';
import { cn } from '@/lib/utils';

// ============================================================================
// Constants
// ============================================================================

/**
 * LocalStorage key for storing dismissal timestamp.
 */
const STORAGE_KEY = 'kikouchou-install-dismissed',

/**
 * Duration in milliseconds to hide the prompt after dismissal (7 days).
 */
 DISMISSAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000,

/**
 * The steps for each browser that never fires `beforeinstallprompt`, with the
 * English each key holds so a missing translation still reads as instructions.
 *
 * A table of literal keys rather than a `pwa.manualInstall.${platform}`
 * template: the scan in `lib/i18n/__tests__/translationKeys.test.ts` resolves
 * literals only, and a key it cannot see is a key that can go missing from `fr`
 * without anything failing.
 */
 MANUAL_INSTALL_STEPS: Record<
  ManualInstallPlatform,
  { readonly key: string; readonly fallback: string }
> = {
  ios: {
    key: 'pwa.manualInstall.ios',
    fallback: 'Tap the Share button, then "Add to Home Screen", then "Add".',
  },
  firefoxAndroid: {
    key: 'pwa.manualInstall.firefoxAndroid',
    fallback:
      'Open Firefox\'s ⋮ menu and tap "Install" — older versions call it "Add app to Home Screen".',
  },
  firefoxWindows: {
    key: 'pwa.manualInstall.firefoxWindows',
    fallback:
      'Click "Add tab to taskbar" in the address bar (Firefox 142 and later). The app gets its own window, toolbar included.',
  },
  firefoxLinux: {
    key: 'pwa.manualInstall.firefoxLinux',
    fallback:
      'Set browser.taskbarTabs.enabled to true in about:config, then click "Add tab to taskbar" in the address bar.',
  },
  firefoxMac: {
    key: 'pwa.manualInstall.firefoxMac',
    fallback:
      'Firefox on macOS cannot install web apps yet. Kikouchou works fully in a tab — or install it from Safari or Chrome.',
  },
  generic: {
    key: 'pwa.manualInstall.generic',
    fallback:
      'Look for "Install", "Add to Dock" or "Add to Home Screen" in your browser\'s menu.',
  },
};

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the InstallPrompt component.
 */
export interface InstallPromptProps {
  /** Additional CSS classes to apply to the container */
  readonly className?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Checks if the prompt was dismissed within the cooldown period.
 *
 * @returns True if prompt should be hidden due to recent dismissal
 */
function isDismissedRecently(): boolean {
  try {
    const dismissedAt = localStorage.getItem(STORAGE_KEY);
    if (!dismissedAt) {return false;}

    const timestamp = parseInt(dismissedAt, 10);
    if (isNaN(timestamp)) {return false;}

    const now = Date.now();
    return now - timestamp < DISMISSAL_DURATION_MS;
  } catch {
    // LocalStorage not available (private browsing, etc.)
    return false;
  }
}

/**
 * Stores the dismissal timestamp in localStorage.
 */
function storeDismissal(): void {
  try {
    localStorage.setItem(STORAGE_KEY, Date.now().toString());
  } catch {
    // LocalStorage not available - dismissal will only last for session
  }
}

// ============================================================================
// Component
// ============================================================================

/**
 * PWA Install Prompt component.
 *
 * Features:
 * - Displays a fixed banner at the bottom of the screen
 * - Only renders when installation is available
 * - Respects user dismissal for 7 days via localStorage
 * - Answers an explicit `?install=1` request at once, dismissal and delay aside
 * - Falls back to the browser's own steps where there is no prompt to fire
 * - Shows success feedback after installation
 * - Fully accessible with ARIA attributes
 * - Mobile-responsive design
 *
 * @param props - Component props
 * @returns The install prompt element or null if not applicable
 *
 * @example
 * ```tsx
 * // In your app layout
 * function Layout({ children }) {
 *   return (
 *     <>
 *       {children}
 *       <InstallPrompt />
 *     </>
 *   );
 * }
 * ```
 */
export const InstallPrompt = memo(function InstallPrompt({
  className,
}: InstallPromptProps): ReactElement | null {
  const { t } = useTranslation(),
   {
    canInstall,
    install,
    isInstalling,
    isInstalled,
    installIntent,
    manualInstallPlatform,
   } = useInstallPrompt(),

  // ============================================================================
  // State
  // ============================================================================

  /**
   * Whether the prompt has been dismissed by the user.
   *
   * The 7-day window is an answer to an offer nobody asked for. A visitor who
   * has just tapped "Install on your phone" on the landing page did ask, so the
   * window does not apply to them — and nothing is written to make that
   * decision stick past this visit.
   */
   [isDismissed, setIsDismissed] = useState<boolean>(
    () => !installIntent && isDismissedRecently(),
  ),

  /**
   * Whether the prompt is visible (for enter/exit animations).
   *
   * Starts visible on an explicit request: the delay below is there to stop the
   * card flashing past on a page load, and the one visitor who is watching for
   * it is the one who asked.
   */
   [isVisible, setIsVisible] = useState<boolean>(() => installIntent),

  // ============================================================================
  // Refs
  // ============================================================================

  /**
   * Ref for the dismiss animation timer to ensure proper cleanup.
   */
   dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null),

  /**
   * Whether the app was already installed on the first render.
   *
   * `isInstalled` is true from the very first render whenever the app is
   * *opened* as an app — that is what `(display-mode: standalone)` means — so
   * the success toast below cannot key off its value alone without
   * congratulating the visitor on every single launch.
   */
   wasInstalledOnMountRef = useRef<boolean>(isInstalled);

  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Cleanup dismiss timer on unmount.
   */
  useEffect(() => () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
      }
    }, []);

  /**
   * Show the prompt with a slight delay for smoother UX.
   * Derive visibility state based on conditions rather than setting state synchronously.
   */
  useEffect(() => {
    // An explicit request skips this entirely: `isVisible` already starts true,
    // and running the effect would only queue a redundant timer whose cleanup
    // hides a card the visitor asked to see.
    if (installIntent) {return undefined;}

    if (canInstall && !isDismissed) {
      // Small delay before showing to avoid flash on page load
      const timer = setTimeout(() => {
        setIsVisible(true);
      }, 1000);

      return () => {
        clearTimeout(timer);
        setIsVisible(false);
      };
    }
    // When conditions change (not canInstall or isDismissed), hide via timeout cleanup
    return undefined;
  }, [canInstall, isDismissed, installIntent]);

  /**
   * Show success toast when app is installed.
   */
  useEffect(() => {
    if (isInstalled && !wasInstalledOnMountRef.current && !isDismissed) {
      // Deliberately a raw toast: installing the app is not a data write, so
      // the offline-aware "Saved on this device" wording does not apply.
      toast.success(t('pwa.installSuccess', 'App installed successfully!'));
      // Use timeout to avoid synchronous setState in effect
      const timer = setTimeout(() => {
        setIsDismissed(true);
      }, 0);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isInstalled, isDismissed, t]);

  // ============================================================================
  // Handlers
  // ============================================================================

  /**
   * Handles the install button click.
   * Shows error feedback if installation fails.
   */
  const handleInstall = useCallback(async (): Promise<void> => {
    const success = await install();

    // Nothing is captured here. `useInstallPrompt` reports the install on the
    // browser's `appinstalled` event instead — the only signal that also sees
    // an install done from the browser's own menu or a share sheet — and it
    // carries `via_prompt` for the ones this button produced. Capturing in
    // both places counted the same install twice.

    // Success toast is handled in the effect when isInstalled becomes true
    // Show error feedback if installation failed and app is not installed
    if (!success && !isInstalled) {
      toast.error(t('pwa.installFailed', 'Installation failed. Please try again.'));
    }
  }, [install, isInstalled, t]),

  /**
   * Handles the dismiss button click.
   */
   handleDismiss = useCallback((): void => {
    storeDismissal();
    setIsVisible(false);
    // Delay setting dismissed to allow exit animation
    dismissTimerRef.current = setTimeout(() => {
      setIsDismissed(true);
    }, 300);
  }, []);

  // ============================================================================
  // Derived Values
  // ============================================================================

  /**
   * Whether to show the browser's own steps instead of an Install button.
   *
   * `beforeinstallprompt` is Chromium's alone, so on an iPhone or in Firefox
   * `canInstall` never becomes true and there is nothing to fire — which is
   * exactly the case where a visitor who tapped "Install on your phone" got
   * nothing at all. The steps stand in for the button there, and only there:
   * one tap beats a list of instructions wherever the browser offers one, and
   * an app that is already installed needs neither.
   */
  const showManualSteps = installIntent && !canInstall && !isInstalled,

   manualSteps = MANUAL_INSTALL_STEPS[manualInstallPlatform];

  // ============================================================================
  // Render
  // ============================================================================

  // Don't render if:
  // - Can't install (no prompt available or already installed) and there is no
  //   request to answer with steps
  // - User has dismissed recently
  // - Not yet visible (initial delay)
  if ((!canInstall && !showManualSteps) || isDismissed || !isVisible) {
    return null;
  }

  return (
    <div
      className={cn(
        // This card has an Install button, a "Not now" and a close button, so
        // it cannot be waved through with `pointer-events-none` the way
        // `OfflineIndicator` is — it has to be *positioned* clear, and this is
        // the third time that bug has shipped. `bottom-0 pb-20` put the card
        // body exactly on the `bottom-20 size-14` FAB; `bottom-0` with the
        // shared `pb-bottom-stack` moved the card up but left the wrapper's
        // padding, which paints nothing and still takes the tap, lying across
        // the FAB. `bottom-above-stack` anchors the box's bottom edge where the
        // stack ends, so the wrapper is only as tall as the card.
        'fixed bottom-above-stack inset-x-0 z-50 px-4',
        // Belt and braces for the width the card does not use: the wrapper is
        // `inset-x-0` and the card is `max-w-md mx-auto`, so on a tablet the
        // wrapper spans dead space either side of it. Nothing is drawn there,
        // which makes it exactly the `OfflineIndicator` case.
        'pointer-events-none',
        // Animation classes
        'transition-transform duration-300 ease-out',
        isVisible ? 'translate-y-0' : 'translate-y-full',
        className,
      )}
      role="region"
      aria-label={t('pwa.installPromptRegion', 'App installation prompt')}
    >
      {/* `pointer-events-auto` puts them back for the part that is drawn. */}
      <Card className="pointer-events-auto mx-auto max-w-md shadow-lg border-primary/20">
        <CardContent className="p-4">
          <div className="flex items-start gap-4">
            {/* App Icon */}
            <div
              className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"
              aria-hidden="true"
            >
              <Download className="size-6" />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base font-semibold">
                {showManualSteps
                  ? t('pwa.manualInstall.title', 'Add Kikouchou to your device')
                  : t('pwa.install', 'Install app')}
              </CardTitle>
              <CardDescription className="mt-1 text-sm">
                {showManualSteps
                  ? t(manualSteps.key, manualSteps.fallback)
                  : t(
                      'pwa.installDescription',
                      'Install Kikouchou on your device for quick access',
                    )}
              </CardDescription>

              {/* Action Buttons */}
              <div className="mt-3 flex items-center gap-2">
                {showManualSteps ? (
                  /*
                    No Install button here: there is no captured event to fire,
                    so a button reading "Install app" would do nothing but
                    report a failure. Acknowledging the steps is the only
                    action left.
                  */
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleDismiss}
                    className="flex-1 sm:flex-none h-11 md:h-8"
                  >
                    {t('pwa.manualInstall.gotIt', 'Got it')}
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      onClick={handleInstall}
                      disabled={isInstalling}
                      className="flex-1 sm:flex-none h-11 md:h-8"
                    >
                      {isInstalling
                        ? t('common.loading', 'Loading...')
                        : t('pwa.install', 'Install app')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleDismiss}
                      disabled={isInstalling}
                      className="h-11 md:h-8"
                    >
                      {t('pwa.notNow', 'Not now')}
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Close Button */}
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 -mt-1 -mr-1 size-11 md:size-8"
              onClick={handleDismiss}
              disabled={isInstalling}
              aria-label={t('common.close', 'Close')}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
});
