/**
 * @fileoverview Compact online count for P2P sync — {@link Layout} only (mobile header, desktop sidebar).
 *
 * @module components/shared/P2PSyncPresence
 */

import { memo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useSyncPresence } from '@/contexts/SyncPresenceContext';

// ============================================================================
// Type Definitions
// ============================================================================

export interface P2PSyncPresenceProps {
  /** Icon-only sidebar rail: dot + tooltip instead of full pill. */
  readonly collapsed?: boolean;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Green dot + “N online” when count &gt; 1. Renders nothing otherwise.
 */
const P2PSyncPresence = memo(function P2PSyncPresence({
  collapsed = false,
}: P2PSyncPresenceProps): ReactElement | null {
  const { t } = useTranslation();
  const presence = useSyncPresence();

  if (!presence || presence.onlineCount <= 1) {
    return null;
  }

  const { onlineCount } = presence;

  const label = t('nav.syncOnlineCount', {
    count: onlineCount,
    defaultValue: '{{count}} online',
  });

  if (collapsed) {
    return (
      <div className="flex justify-center" aria-live="polite">
        <div
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50"
          title={label}
        >
          <span className="size-2.5 rounded-full bg-green-500" aria-hidden="true" />
          <span className="sr-only">{label}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-muted/40 md:w-full md:max-w-full"
      aria-live="polite"
    >
      <span className="size-2 shrink-0 rounded-full bg-green-500" aria-hidden="true" />
      <span className="tabular-nums">{label}</span>
    </div>
  );
});

export { P2PSyncPresence };
