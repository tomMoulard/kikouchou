/**
 * @fileoverview Offline indicator: an icon in the header.
 *
 * It used to be an amber pill floating under the header, two lines long
 * ("You are offline" and a sentence of reassurance), which on a phone covered
 * the page title and the first row of content for as long as the connection
 * was down: at a rural holiday house, that is most of the stay. The message
 * is the same, but it now takes one icon's width in the header: a
 * struck-through wifi glyph in the warning tone (offline is expected, not an
 * error), whose full sentence is its accessible name and its tooltip.
 *
 * Coming back online shows a tick in the success tone for a moment, then
 * nothing. Both changes are announced through a polite live region.
 *
 * @module components/pwa/OfflineIndicator
 */

import { type ReactElement, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, WifiOff } from 'lucide-react';

import { statusVariants } from '@/components/ui/status.variants';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';

import { cn } from '@/lib/utils';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the OfflineIndicator component.
 */
export interface OfflineIndicatorProps {
  /** Additional CSS classes for the icon's wrapper */
  readonly className?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * The connection's state as one icon, or nothing while online.
 *
 * @param props - Component props
 * @returns The icon, or null when online and nothing just changed
 */
export const OfflineIndicator = memo(function OfflineIndicator({
  className,
}: OfflineIndicatorProps): ReactElement | null {
  const { t } = useTranslation();
  const { isOnline, hasRecentlyChanged } = useOnlineStatus();

  if (isOnline && !hasRecentlyChanged) {
    return null;
  }

  const label = isOnline
    ? t('pwa.connectionRestored', 'Connection restored')
    : `${t('pwa.offline', 'You are offline')}. ${t(
        'pwa.offlineDescription',
        'Your changes are saved locally and the app works normally',
      )}`;

  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      title={label}
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-full',
        statusVariants({ tone: isOnline ? 'success' : 'warning' }),
        className,
      )}
    >
      {isOnline ? (
        <CheckCircle2 className="size-4" aria-hidden="true" />
      ) : (
        <WifiOff className="size-4 motion-safe:animate-pulse" aria-hidden="true" />
      )}
      <span className="sr-only">{label}</span>
    </span>
  );
});
