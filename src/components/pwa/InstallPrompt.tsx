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
import { useInstallPrompt } from '@/hooks/useInstallPrompt';
import { cn } from '@/lib/utils';

// ============================================================================
// Constants
// ============================================================================

/**
 * LocalStorage key for storing dismissal timestamp.
 */
const STORAGE_KEY = 'kikoushou-install-dismissed',

/**
 * Duration in milliseconds to hide the prompt after dismissal (7 days).
 */
 DISMISSAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

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
function InstallPromptComponent({
  className,
}: InstallPromptProps): ReactElement | null {
  const { t } = useTranslation(),
   { canInstall, install, isInstalling, isInstalled } = useInstallPrompt(),

  // ============================================================================
  // State
  // ============================================================================

  /**
   * Whether the prompt has been dismissed by the user.
   */
   [isDismissed, setIsDismissed] = useState<boolean>(() =>
    isDismissedRecently(),
  ),

  /**
   * Whether the prompt is visible (for enter/exit animations).
   */
   [isVisible, setIsVisible] = useState(false),

  // ============================================================================
  // Refs
  // ============================================================================

  /**
   * Ref for the dismiss animation timer to ensure proper cleanup.
   */
   dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  }, [canInstall, isDismissed]);

  /**
   * Show success toast when app is installed.
   */
  useEffect(() => {
    if (isInstalled && !isDismissed) {
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
  // Render
  // ============================================================================

  // Don't render if:
  // - Can't install (no prompt available or already installed)
  // - User has dismissed recently
  // - Not yet visible (initial delay)
  if (!canInstall || isDismissed || !isVisible) {
    return null;
  }

  return (
    <div
      className={cn(
        'fixed bottom-0 inset-x-0 z-50 p-4',
        // Account for mobile navigation bar
        'pb-20 md:pb-4',
        // Animation classes
        'transition-transform duration-300 ease-out',
        isVisible ? 'translate-y-0' : 'translate-y-full',
        className,
      )}
      role="region"
      aria-label={t('pwa.installPromptRegion', 'App installation prompt')}
    >
      <Card className="mx-auto max-w-md shadow-lg border-primary/20">
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
                {t('pwa.install', 'Install app')}
              </CardTitle>
              <CardDescription className="mt-1 text-sm">
                {t(
                  'pwa.installDescription',
                  'Install Kikoushou on your device for quick access',
                )}
              </CardDescription>

              {/* Action Buttons */}
              <div className="mt-3 flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleInstall}
                  disabled={isInstalling}
                  className="flex-1 sm:flex-none"
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
                >
                  {t('pwa.notNow', 'Not now')}
                </Button>
              </div>
            </div>

            {/* Close Button */}
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 -mt-1 -mr-1 size-8"
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
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Memoized Install Prompt component.
 */
export const InstallPrompt = memo(InstallPromptComponent);

InstallPrompt.displayName = 'InstallPrompt';
