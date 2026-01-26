/**
 * @fileoverview Offline Indicator component.
 * Displays a subtle banner when the app is offline.
 *
 * @module components/pwa/OfflineIndicator
 */

import { type ReactElement, memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, WifiOff } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
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
 * - Displays a subtle banner at the top of the screen when offline
 * - Shows "back online" message briefly when connectivity is restored
 * - Non-intrusive fixed positioning that doesn't block interaction
 * - Smooth enter/exit animations
 * - Fully accessible with ARIA live region for screen readers
 * - Automatic dismissal when back online
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
   */
   [isVisible, setIsVisible] = useState(false);



  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Control visibility based on online status.
   */
  useEffect(() => {
    if (!isOnline) {
      // Show offline indicator immediately
      setIsVisible(true);
    } else if (hasRecentlyChanged) {
      // Briefly show "back online" message
      setIsVisible(true);
    } else {
      // Hide after "back online" period ends
      setIsVisible(false);
    }
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
        'fixed top-0 inset-x-0 z-50 flex justify-center p-2',
        // Animation classes
        'transition-transform duration-300 ease-out',
        isVisible ? 'translate-y-0' : '-translate-y-full',
        className,
      )}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <Badge
        variant={isOffline ? 'destructive' : 'default'}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 text-sm font-medium shadow-lg',
          // Smooth color transition
          'transition-colors duration-300',
          // "Back online" variant styling
          !isOffline && 'bg-green-600 hover:bg-green-600 text-white',
        )}
      >
        {isOffline ? (
          <>
            <WifiOff className="size-4" aria-hidden="true" />
            <span>{t('pwa.offline', 'You are offline')}</span>
          </>
        ) : (
          <>
            <CheckCircle2 className="size-4" aria-hidden="true" />
            <span>{t('pwa.backOnline', 'Back online')}</span>
          </>
        )}
      </Badge>
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
