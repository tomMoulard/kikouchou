/**
 * @fileoverview The feed of travel times that moved since this device last
 * showed them.
 *
 * Renders what {@link useRideChanges} detects, and nothing else: "Alice moved
 * 17:00 → 19:00", the car it affects, and a button that says so out loud. The
 * button is the only thing that advances the watermark — a change that arrived
 * while the phone was in a pocket must not be marked read by a card mounting.
 *
 * Two details are load-bearing rather than decorative:
 *
 * - The live region is mounted whether or not there is anything to say. A
 *   region inserted *with* its first entry is not reliably announced, so a
 *   change arriving while the page is already open would be silent to a screen
 *   reader — which is precisely the reader who cannot see the card appear.
 * - The "watch" row exists because rule 1 of the hook — no watermark is not a
 *   change — means nothing is ever reported until a first watermark exists.
 *   Seeding it at mount would break the "never on render" rule, so the device
 *   asks instead, once, and the row is gone as soon as it is answered.
 *
 * @module features/transports/components/RideChangeFeed
 */

import { type ReactElement, memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Locale } from 'date-fns';
import { toast } from 'sonner';
import { ArrowRight, Clock, Eye, MapPin } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { statusVariants } from '@/components/ui/status.variants';
import { PersonBadge } from '@/components/shared/PersonBadge';
import { useRideChanges } from '@/features/transports/hooks/useRideChanges';
import type { RideChange } from '@/features/transports/hooks/useRideChanges';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { cn } from '@/lib/utils';
import { formatTransportDatetime } from '@/lib/utils/datetime-format';
import type { TransportId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** Props for the {@link RideChangeFeed} component. */
export interface RideChangeFeedProps {
  /** Additional classes, applied only when the feed has something to show. */
  readonly className?: string;
}

/** Props for one entry in the feed. */
interface RideChangeEntryProps {
  /** The moved leg. */
  readonly change: RideChange;
  /** Date locale for formatting. */
  readonly dateLocale: Locale;
  /** Called when the user says they have seen this change. */
  readonly onAcknowledge: (transportId: TransportId) => void;
}

// ============================================================================
// RideChangeEntry Subcomponent
// ============================================================================

/**
 * One "Alice moved 17:00 → 19:00" row, with the car it affects.
 *
 * Both times are rendered with their day, not just the clock: the move that
 * matters most is the one that crossed midnight, and a bare `19:00` hides it.
 */
const RideChangeEntry = memo(function RideChangeEntry({
  change,
  dateLocale,
  onAcknowledge,
}: RideChangeEntryProps): ReactElement {
  const { t } = useTranslation();
  const wasLabel = formatTransportDatetime(
    change.seenDatetime,
    dateLocale,
    'dayAndTime',
  );
  const nowLabel = formatTransportDatetime(change.datetime, dateLocale, 'dayAndTime');
  const meetLabel = formatTransportDatetime(
    change.journey.meetDatetime,
    dateLocale,
    'dayAndTime',
  );
  const isPickup = change.journey.direction === 'pickup';

  const handleAcknowledge = useCallback(() => {
    onAcknowledge(change.transport.id);
  }, [change.transport.id, onAcknowledge]);

  return (
    <li className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        {change.person ? (
          <PersonBadge person={change.person} size="sm" />
        ) : (
          // A leg whose guest the trip no longer holds still reports. Somebody
          // moved a train whether or not their row survived.
          <span className="text-sm text-muted-foreground">
            {t('rideChanges.unknownGuest')}
          </span>
        )}
        <Badge
          variant="outline"
          className={cn(
            'shrink-0 text-xs',
            statusVariants({ tone: 'warning', emphasis: 'outline' }),
          )}
        >
          {change.movedLater
            ? t('rideChanges.movedLater')
            : t('rideChanges.movedEarlier')}
        </Badge>
      </div>

      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="sr-only">{t('rideChanges.was')}</span>
        <span className="text-muted-foreground line-through">{wasLabel}</span>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">{t('rideChanges.now')}</span>
        <span className="font-semibold">{nowLabel}</span>
      </p>

      <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span
          className={cn(
            'rounded px-1.5 py-0.5',
            statusVariants({
              tone: isPickup ? 'arrival' : 'departure',
              emphasis: 'soft',
            }),
          )}
        >
          {isPickup ? t('rides.directions.pickup') : t('rides.directions.dropoff')}
        </span>
        <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{change.journey.location}</span>
        {meetLabel !== '' && <span>{t('rides.meetAt', { time: meetLabel })}</span>}
      </p>

      <Button
        variant="outline"
        onClick={handleAcknowledge}
        className="mt-3 h-11 w-full md:h-9"
      >
        {t('rideChanges.acknowledge')}
      </Button>
    </li>
  );
});

// ============================================================================
// RideChangeFeed Component
// ============================================================================

/**
 * Shows the travel times that moved in the cars this device's guest travels in.
 *
 * Renders nothing at all while the answer is still loading, and nothing when
 * every leg in scope is where this device last saw it — the two are different
 * states inside the hook, and conflating them is what makes a feed flash empty
 * on every navigation.
 *
 * @param props - Component props
 * @returns The feed element
 */
const RideChangeFeed = memo(function RideChangeFeed({
  className,
}: RideChangeFeedProps): ReactElement {
  const { t, i18n } = useTranslation();
  const { changes, isLoading, unwatchedCount, acknowledge, acknowledgeAll } =
    useRideChanges();

  const dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);
  const hasChanges = !isLoading && changes.length > 0;
  // Offered only once there is nothing to read, so the two actions never
  // compete for the same tap.
  const hasWatchOffer = !isLoading && changes.length === 0 && unwatchedCount > 0;

  const handleAcknowledgeEntry = useCallback(
    (transportId: TransportId) => {
      void (async (): Promise<void> => {
        try {
          await acknowledge(transportId);
        } catch (error) {
          console.error('Failed to acknowledge a ride change:', error);
          toast.error(t('errors.saveFailed'));
        }
      })();
    },
    [acknowledge, t],
  );

  const handleAcknowledgeAll = useCallback(() => {
    void (async (): Promise<void> => {
      try {
        await acknowledgeAll();
      } catch (error) {
        console.error('Failed to acknowledge the ride changes:', error);
        toast.error(t('errors.saveFailed'));
      }
    })();
  }, [acknowledgeAll, t]);

  return (
    <section
      className={cn((hasChanges || hasWatchOffer) && className)}
      aria-label={t('rideChanges.title')}
    >
      {/* Mounted unconditionally so a change arriving on an open page is
          announced rather than silently inserted. The test id is here because
          `PersonBadge` is itself a `role="status"`, so the role alone does not
          name this element once an entry is on screen. */}
      <p className="sr-only" role="status" data-testid="ride-change-announcement">
        {hasChanges ? t('rideChanges.announce', { count: changes.length }) : ''}
      </p>

      {hasChanges && (
        <div
          className={cn(
            statusVariants({ tone: 'warning', emphasis: 'surface' }),
            'rounded-xl border-2 p-4',
          )}
        >
          <div className="mb-3 flex items-center gap-2">
            <Clock
              className={cn('size-5', statusVariants({ tone: 'warning', emphasis: 'text' }))}
              aria-hidden="true"
            />
            <h2 className="text-base font-semibold">{t('rideChanges.title')}</h2>
            <Badge
              variant="outline"
              className={statusVariants({ tone: 'warning', emphasis: 'soft' })}
            >
              {t('rideChanges.count', { count: changes.length })}
            </Badge>
          </div>

          <p className="mb-3 text-xs text-muted-foreground">
            {t('rideChanges.description')}
          </p>

          <ul className="space-y-3">
            {changes.map((change) => (
              <RideChangeEntry
                key={change.transport.id}
                change={change}
                dateLocale={dateLocale}
                onAcknowledge={handleAcknowledgeEntry}
              />
            ))}
          </ul>

          {changes.length > 1 && (
            <Button
              variant="outline"
              onClick={handleAcknowledgeAll}
              className="mt-3 h-11 w-full md:h-9"
            >
              {t('rideChanges.acknowledgeAll')}
            </Button>
          )}
        </div>
      )}

      {hasWatchOffer && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
          <p className="text-sm text-muted-foreground">
            {t('rideChanges.watchHint', { count: unwatchedCount })}
          </p>
          <Button
            variant="outline"
            onClick={handleAcknowledgeAll}
            className="h-11 md:h-9"
          >
            <Eye className="mr-2 size-4" aria-hidden="true" />
            {t('rideChanges.watch')}
          </Button>
        </div>
      )}
    </section>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { RideChangeFeed };
