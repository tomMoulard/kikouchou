/**
 * @fileoverview Who is on this trip, and whether your changes have landed.
 *
 * Two different questions, and only one of them is interesting most of the time.
 * "Syncing…" answers a question nobody asked — of course it is syncing — whereas
 * "2 online" is the thing a person actually wants to know when they are editing
 * a trip with someone else.
 *
 * So the head count is the default face of this badge, and the sync state shows
 * through only when it has something to say. That ordering matters and is
 * deliberate: offline-first rule 8 still holds, because the one sync state a
 * person must never miss is *your changes have not been sent*. That keeps
 * priority over the count — a cheerful "3 online" above unsent edits would be
 * worse than the spinner it replaced.
 *
 * A trip that does not sync shows nothing at all. Most trips are never shared,
 * and a permanent chip on all of them would be noise reporting a non-problem.
 *
 * `onlineCount` is `null` when Realtime is not connected, which is not the same
 * as nobody being there — so the badge falls back to the plain sync state rather
 * than claiming the trip is empty.
 *
 * @module components/shared/SyncStatusBadge
 */

import { type ReactElement, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Check, Loader2, Users } from 'lucide-react';

import { statusVariants } from '@/components/ui/status.variants';

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

  /**
   * Whether the head count may take the badge over.
   *
   * Never while something is unsent or the connection is down: those are the
   * cases where the sync state is the message.
   */
  const showCount =
    state.onlineCount !== null && state.status !== 'offline' && pending === 0;

  const appearance = showCount
    ? {
        icon: <Users className="size-3.5 shrink-0" aria-hidden="true" />,
        tone: statusVariants({ tone: 'success', emphasis: 'text' }),
        dot: 'bg-success',
        label:
          (state.onlineCount ?? 0) <= 1
            ? // "1 online" invites the question "online with whom?". Naming it as
              // just you answers that, and reads as calm rather than broken.
              t('nav.syncOnlineJustYou', 'Just you right now')
            : t('nav.syncOnlineCount', {
                count: state.onlineCount ?? 0,
                // Matches the shipped strings, so the inline fallback and the
                // locale file cannot drift apart. A counted string needs one
                // default per plural form: a single `defaultValue` would be
                // wrong for every count it was not written for.
                defaultValue_one: '{{count}} person online',
                defaultValue_other: '{{count}} people online',
              }),
      }
    : state.status === 'offline'
      ? {
          icon: <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />,
          tone: statusVariants({ tone: 'warning', emphasis: 'text' }),
          dot: 'bg-warning',
          label:
            pending > 0
              ? t('nav.syncPending', {
                  count: pending,
                  defaultValue_one: '{{count}} change not sent yet',
                  defaultValue_other: '{{count}} changes not sent yet',
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
            tone: statusVariants({ tone: 'success', emphasis: 'text' }),
            dot: 'bg-success',
            label: t('nav.syncSynced', 'Everyone is up to date'),
          };

  const regionLabel = showCount
    ? t('nav.syncPresenceRegion', 'Collaboration status')
    : t('nav.syncStatusRegion', 'Sync status');

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
        aria-label={regionLabel}
      >
        {body}
      </div>
    );
  }

  return (
    <div role="status" aria-label={regionLabel}>
      {body}
    </div>
  );
});
