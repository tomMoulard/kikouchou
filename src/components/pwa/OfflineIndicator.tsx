/**
 * @fileoverview Offline Indicator component.
 * Displays a non-intrusive banner below the header when the app is offline.
 * Uses warm amber styling (not destructive red) to reassure users at rural
 * vacation houses that offline is expected and the app works normally.
 *
 * @module components/pwa/OfflineIndicator
 */

import { type ReactElement, memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, WifiOff } from 'lucide-react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { cn } from '@/lib/utils';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the OfflineIndicator component.
 */
export interface OfflineIndicatorProps {
  /** Additional CSS classes to apply to the container */
  readonly className?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Offline Indicator component.
 *
 * Features:
 * - Displays a warm amber banner below the header when offline
 * - Shows reassuring "back online" message briefly when connectivity is restored
 * - Positioned at top-14 to clear the 56px sticky header
 * - Non-intrusive — does NOT block any interactive elements
 * - Smooth enter/exit animations with motion-safe prefix (NFR12)
 * - Fully accessible with ARIA live region for screen readers
 * - Automatic dismissal when back online after brief confirmation
 *
 * @param props - Component props
 * @returns The offline indicator element or null if online
 *
 * @example
 * ```tsx
 * // In your app layout
 * function Layout({ children }) {
 *   return (
 *     <>
 *       <OfflineIndicator />
 *       {children}
 *     </>
 *   );
 * }
 * ```
 */
function OfflineIndicatorComponent({
  className,
}: OfflineIndicatorProps): ReactElement | null {
  const { t } = useTranslation(),
   { isOnline, hasRecentlyChanged } = useOnlineStatus(),

  // ============================================================================
  // State
  // ============================================================================

   /**
    * Whether the indicator is visible (for enter/exit animations).
    * Initialize based on current online status to avoid a brief flash
    * where the indicator is absent on the first render when offline.
    */
   [isVisible, setIsVisible] = useState(!isOnline || hasRecentlyChanged);



  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Control visibility based on online status.
   * Use timeout to avoid synchronous setState in effect.
   */
  useEffect(() => {
    const shouldShow = !isOnline || hasRecentlyChanged;
    // Use microtask to avoid synchronous setState warning
    const timer = setTimeout(() => {
      setIsVisible(shouldShow);
    }, 0);
    return () => clearTimeout(timer);
  }, [isOnline, hasRecentlyChanged]);

  // ============================================================================
  // Render
  // ============================================================================

  // Don't render if online and not showing "back online" message
  if (isOnline && !hasRecentlyChanged && !isVisible) {
    return null;
  }

  const isOffline = !isOnline;

  return (
    <div
      className={cn(
        // Position below the sticky header (h-14 = 56px) to avoid overlap
        'fixed top-14 inset-x-0 z-50 flex justify-center px-4 py-2',
        // Animation classes — motion-safe prefix for NFR12 compliance
        'motion-safe:transition-all motion-safe:duration-300 motion-safe:ease-out',
        isVisible
          ? 'translate-y-0 opacity-100'
          : '-translate-y-full opacity-0',
        className,
      )}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium shadow-lg',
          // Smooth color transition with motion-safe prefix
          'motion-safe:transition-colors motion-safe:duration-300',
          isOffline
            ? // Warm amber styling — offline is NOT an error, it's expected
              'bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-950 dark:text-amber-100 dark:border-amber-800'
            : // Green "back online" styling with smooth appearance
              'bg-green-50 text-green-900 border border-green-200 dark:bg-green-950 dark:text-green-100 dark:border-green-800',
        )}
      >
        {isOffline ? (
          <>
            <WifiOff
              className={cn(
                'size-4 shrink-0 text-amber-600 dark:text-amber-400',
                // Subtle pulse animation for gentle attention
                'motion-safe:animate-pulse',
              )}
              aria-hidden="true"
            />
            <div className="flex flex-col">
              <span>{t('pwa.offline', 'You are offline')}</span>
              <span className="text-xs font-normal text-amber-700 dark:text-amber-300">
                {t(
                  'pwa.offlineDescription',
                  'Your changes are saved locally and the app works normally',
                )}
              </span>
            </div>
          </>
        ) : (
          <>
            <CheckCircle2
              className="size-4 shrink-0 text-green-600 dark:text-green-400"
              aria-hidden="true"
            />
            <span>
              {t('pwa.connectionRestored', 'Connection restored')}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Memoized Offline Indicator component.
 */
export const OfflineIndicator = memo(OfflineIndicatorComponent);
OfflineIndicator.displayName = 'OfflineIndicator';
