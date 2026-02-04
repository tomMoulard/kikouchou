/**
 * @fileoverview Offline indicator component for map views.
 * Shows a visual indicator when the user is offline and viewing cached tiles.
 *
 * @module components/shared/MapOfflineIndicator
 */

import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WifiOff, CloudOff } from 'lucide-react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { cn } from '@/lib/utils';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the MapOfflineIndicator component.
 */
export interface MapOfflineIndicatorProps {
  /** Additional CSS classes */
  readonly className?: string;
  /** Whether to show the indicator even when online (for cached mode) */
  readonly showCachedMode?: boolean;
  /** Position within the map container */
  readonly position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

// ============================================================================
// Component
// ============================================================================

/**
 * Displays an offline indicator on map components.
 *
 * Features:
 * - Shows "Offline" badge when no network connection
 * - Optional "Cached" mode indicator
 * - Positioned within map container
 * - Animated appearance
 *
 * @example
 * ```tsx
 * <div className="relative">
 *   <MapView ... />
 *   <MapOfflineIndicator position="bottom-left" />
 * </div>
 * ```
 */
export const MapOfflineIndicator = memo(function MapOfflineIndicator({
  className,
  showCachedMode = false,
  position = 'bottom-left',
}: MapOfflineIndicatorProps) {
  const { t } = useTranslation();
  const { isOnline, hasRecentlyChanged } = useOnlineStatus();
  const [isVisible, setIsVisible] = useState(!isOnline);

  // Handle visibility with animation
  useEffect(() => {
    if (!isOnline) {
      setIsVisible(true);
    } else if (hasRecentlyChanged) {
      // Keep visible briefly when coming back online
      const timer = setTimeout(() => {
        setIsVisible(false);
      }, 2000);
      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
    }
    return undefined;
  }, [isOnline, hasRecentlyChanged]);

  // Don't render if online and not showing cached mode
  if (isOnline && !showCachedMode && !hasRecentlyChanged) {
    return null;
  }

  // Position classes
  const positionClasses = {
    'top-left': 'top-2 left-2',
    'top-right': 'top-2 right-2',
    'bottom-left': 'bottom-2 left-2',
    'bottom-right': 'bottom-2 right-2',
  };

  return (
    <div
      className={cn(
        'absolute z-[1000] pointer-events-none',
        positionClasses[position],
        className
      )}
      role="status"
      aria-live="polite"
    >
      <div
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium',
          'transition-all duration-300 ease-in-out',
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2',
          !isOnline
            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/80 dark:text-amber-200'
            : hasRecentlyChanged
              ? 'bg-green-100 text-green-800 dark:bg-green-900/80 dark:text-green-200'
              : showCachedMode
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/80 dark:text-blue-200'
                : ''
        )}
      >
        {!isOnline ? (
          <>
            <WifiOff className="size-3.5" aria-hidden="true" />
            <span>{t('pwa.offline', 'Offline')}</span>
          </>
        ) : hasRecentlyChanged ? (
          <>
            <CloudOff className="size-3.5" aria-hidden="true" />
            <span>{t('pwa.backOnline', 'Back online')}</span>
          </>
        ) : showCachedMode ? (
          <>
            <CloudOff className="size-3.5" aria-hidden="true" />
            <span>{t('map.cachedTiles', 'Using cached tiles')}</span>
          </>
        ) : null}
      </div>
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export default MapOfflineIndicator;
