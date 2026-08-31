/**
 * @fileoverview Whether this trip's changes have reached the server.
 *
 * Offline-first rule 8: the four states have to be distinguishable, because they
 * mean very different things to somebody about to close the tab. "Synced" says
 * the others can see it; "3 pending" says they cannot yet, but nothing is lost;
 * "Local only" says this trip was never shared and no amount of waiting will
 * change that.
 *
 * A trip that does not sync shows nothing at all. Most trips are never shared,
 * and a permanent "not syncing" chip on all of them would be noise reporting a
 * non-problem.
 *
 * @module components/shared/SyncStatusBadge
 */

import { type ReactElement, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Check, Loader2 } from 'lucide-react';

import { useSyncStatus } from '@/lib/sync/SupabaseTripSync';
import { cn } from '@/lib/utils';

// ============================================================================
// Type Definitions
// ============================================================================

export interface SyncStatusBadgeProps {
  /** Icon-only sidebar rail: dot only, with the label as a tooltip. */
  readonly collapsed?: boolean;
  /** `sidebar` adds the desktop section chrome; `inline` is the mobile header. */
  readonly layout?: 'inline' | 'sidebar';
}

// ============================================================================
// Component
// ============================================================================

export const SyncStatusBadge = memo(function SyncStatusBadge({
  collapsed = false,
  layout = 'inline',
}: SyncStatusBadgeProps): ReactElement | null {
  const { t } = useTranslation();
  const { state, syncNow } = useSyncStatus();

  // Not a syncing trip: say nothing rather than reporting the absence of a
  // feature nobody asked for on this trip.
  if (state.status === 'local') {
    return null;
  }

  const pending = state.pendingCount;

  const appearance =
    state.status === 'offline'
      ? {
          icon: <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />,
          tone: 'text-amber-600 dark:text-amber-500',
          dot: 'bg-amber-500',
          label:
            pending > 0
              ? t('nav.syncPending', {
                  count: pending,
                  defaultValue: '{{count}} not sent yet',
                })
              : t('nav.syncOffline', 'Not connected'),
        }
      : state.status === 'syncing'
        ? {
            icon: (
              <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
            ),
            tone: 'text-muted-foreground',
            dot: 'bg-muted-foreground',
            label: t('nav.syncSyncing', 'Syncing…'),
          }
        : {
            icon: <Check className="size-3.5 shrink-0" aria-hidden="true" />,
            tone: 'text-green-600 dark:text-green-500',
            dot: 'bg-green-500',
            label: t('nav.syncSynced', 'Everyone is up to date'),
          };

  // Only worth offering when something is actually stuck.
  const canRetry = state.status === 'offline';

  const body = collapsed ? (
    <div className="flex justify-center" aria-live="polite">
      <div
        className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50"
        title={appearance.label}
      >
        <span className={cn('size-2 rounded-full', appearance.dot)} aria-hidden="true" />
        <span className="sr-only">{appearance.label}</span>
      </div>
    </div>
  ) : (
    <div
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-xs font-medium',
        appearance.tone,
      )}
      aria-live="polite"
    >
      {appearance.icon}
      <span className="truncate">{appearance.label}</span>
      {canRetry ? (
        <button
          type="button"
          onClick={syncNow}
          className="shrink-0 underline underline-offset-2 hover:no-underline"
        >
          {t('common.retry', 'Retry')}
        </button>
      ) : null}
    </div>
  );

  if (layout === 'sidebar') {
    return (
      <div
        className="border-t border-border px-3 py-2"
        role="status"
        aria-label={t('nav.syncStatusRegion', 'Sync status')}
      >
        {body}
      </div>
    );
  }

  return (
    <div role="status" aria-label={t('nav.syncStatusRegion', 'Sync status')}>
      {body}
    </div>
  );
});
