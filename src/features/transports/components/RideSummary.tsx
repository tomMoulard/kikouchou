/**
 * @fileoverview The one rendering of a car journey: who drives, in what, when
 * it meets, and everybody it carries.
 *
 * @module features/transports/components/RideSummary
 *
 * `resolveRides` already guarantees that no two surfaces can disagree about the
 * *facts* of a journey. It does nothing about them disagreeing over which facts
 * to show, and they immediately did: the calendar dialog printed "driving
 * themselves" and no departure time, while the map popup printed the departure
 * time and never mentioned that the driver was also a passenger. A guest
 * reading both saw two different cars.
 *
 * So the shape lives here too. A caller picks a `density` — `dialog` for a
 * detail sheet with room to breathe, `popup` for the ~200px Leaflet balloon —
 * and everything else, including which fields appear, is decided once.
 *
 * Passengers are counted in **people, not rows**: one guest row can stand for a
 * couple, so `legs.length` would report a four-seat car collecting five bodies
 * as three passengers and let the driver take the small car.
 */

import { type ReactElement, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Locale } from 'date-fns';
import { Car, Clock, MapPin, User, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { statusVariants } from '@/components/ui/status.variants';
import { PersonBadge } from '@/components/shared/PersonBadge';
import { createHeadcountResolver } from '@/features/rooms/utils/capacity-utils';
import { countRidePassengers } from '@/features/transports/utils/ride-capacity';
import type { ResolvedRide } from '@/features/transports/utils/ride-model';
import {
  formatTransportDatetime,
  formatTransportDatetimeParts,
} from '@/lib/utils/datetime-format';
import { cn } from '@/lib/utils';
import type { Person, TransportId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** How much room the surface drawing this summary has. */
export type RideSummaryDensity = 'dialog' | 'popup';

/** Props for the RideSummary component. */
export interface RideSummaryProps {
  /** The journey, from `resolveRides` */
  readonly ride: ResolvedRide;
  /** The trip's guests, for counting people rather than guest rows */
  readonly persons: readonly Person[];
  readonly dateLocale: Locale;
  /** `dialog` in a detail sheet, `popup` in a Leaflet balloon */
  readonly density?: RideSummaryDensity;
  /**
   * The leg the surrounding surface is already about, when there is one.
   *
   * Its passenger is dropped from the list: a guest reading the detail of their
   * own arrival does not need to be told they are in the car.
   */
  readonly excludeLegId?: TransportId;
  /** Rendered after the summary — a directions button, typically */
  readonly footer?: ReactElement | null;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Renders one car journey.
 *
 * @param props - Component props
 * @returns The journey's summary
 *
 * @example
 * ```tsx
 * <RideSummary ride={journey} persons={persons} dateLocale={dateLocale} />
 * ```
 */
const RideSummary = memo(function RideSummary({
  ride,
  persons,
  dateLocale,
  density = 'dialog',
  excludeLegId,
  footer,
}: RideSummaryProps): ReactElement {
  const { t } = useTranslation();

  const isPickup = ride.direction === 'pickup';
  const isPopup = density === 'popup';

  const { date: meetDate, time: meetTime } = formatTransportDatetimeParts(
    ride.meetDatetime,
    dateLocale,
    isPopup ? 'dayAndTime' : 'fullDayAndTime',
  );

  // The driver's own alarm clock. Null whenever the meeting instant could not
  // be parsed, in which case there is nothing honest to subtract from.
  const leaveTime =
    ride.leaveAtMs === null
      ? ''
      : formatTransportDatetime(
          new Date(ride.leaveAtMs).toISOString(),
          dateLocale,
          'timeOnly',
        );

  const passengerCount = useMemo(
    () => countRidePassengers(ride, createHeadcountResolver(persons)),
    [persons, ride],
  );

  const shownLegs = useMemo(
    () =>
      excludeLegId === undefined
        ? ride.legs
        : ride.legs.filter((leg) => leg.transport.id !== excludeLegId),
    [excludeLegId, ride.legs],
  );

  const iconClass = isPopup
    ? 'size-3.5 shrink-0 text-muted-foreground'
    : 'size-4 shrink-0 text-muted-foreground';
  const rowClass = isPopup
    ? 'flex flex-wrap items-center gap-2 text-sm text-muted-foreground'
    : 'flex flex-wrap items-center gap-2';
  const textClass = isPopup ? 'text-sm' : 'text-sm';

  return (
    <div className={isPopup ? 'space-y-2' : 'space-y-3'} data-testid="ride-summary">
      {/* Which way the car is going — never colour alone, hence the arrow */}
      <div className="flex flex-wrap items-center gap-2">
        <Car
          className={cn(
            isPopup ? 'size-4 shrink-0' : 'size-4 shrink-0',
            statusVariants({
              tone: isPickup ? 'arrival' : 'departure',
              emphasis: 'text',
            }),
          )}
          aria-hidden="true"
        />
        <span className="text-sm font-medium">
          {isPickup ? '↓' : '↑'} {t(`rides.directions.${ride.direction}`)}
        </span>
        {ride.isSelfDriven ? (
          <Badge
            variant="outline"
            className={statusVariants({ tone: 'neutral', emphasis: 'outline' })}
          >
            {t('rides.selfDriven')}
          </Badge>
        ) : null}
      </div>

      {/* When to be there */}
      <div className="flex flex-wrap items-center gap-2">
        <Clock className={iconClass} aria-hidden="true" />
        <span className={textClass}>{t('rides.meetAt', { time: meetTime })}</span>
        {meetDate ? (
          <span className="text-sm text-muted-foreground">{meetDate}</span>
        ) : null}
      </div>

      {/* When to set off */}
      {leaveTime ? (
        <div className={cn(textClass, 'text-muted-foreground')}>
          {t('rides.leaveAt', { time: leaveTime })}
        </div>
      ) : null}

      {/* Where */}
      {ride.location ? (
        <div className="flex items-start gap-2">
          <MapPin className={cn(iconClass, 'mt-0.5')} aria-hidden="true" />
          <span className={textClass}>
            <span className="text-muted-foreground">
              {t('rides.meetingPoint', 'Meeting point')}
              {': '}
            </span>
            {ride.location}
          </span>
        </div>
      ) : null}

      {/* Who drives */}
      <div className={rowClass}>
        <User className={iconClass} aria-hidden="true" />
        <span className="text-sm text-muted-foreground">{t('rides.driver')}:</span>
        {ride.driver ? (
          <PersonBadge person={ride.driver} size="sm" />
        ) : ride.driverId !== undefined ? (
          // Somebody drives, but this device cannot name them — a guest row
          // that has not arrived yet, or one that was removed. Saying "nobody
          // driving yet" here would send a second volunteer to the same car.
          <span className="text-sm text-muted-foreground">{t('common.unknown')}</span>
        ) : (
          <span className={statusVariants({ tone: 'warning', emphasis: 'text' })}>
            {t('rides.noDriver')}
          </span>
        )}
      </div>

      {/* In what */}
      <div className={rowClass}>
        <Car className={iconClass} aria-hidden="true" />
        <span className="text-sm text-muted-foreground">{t('rides.vehicle')}:</span>
        <span className={textClass}>{ride.vehicle?.name ?? t('rides.noVehicle')}</span>
      </div>

      {/* Everybody it carries */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Users className={iconClass} aria-hidden="true" />
          <span className="text-sm text-muted-foreground">
            {excludeLegId === undefined
              ? t('rides.passengers', { count: passengerCount })
              : t('rides.otherPassengers', 'Others in the car')}
          </span>
        </div>
        {shownLegs.length > 0 ? (
          <div className={cn('flex flex-wrap gap-1.5', isPopup ? '' : 'pl-6')}>
            {shownLegs.map((leg) =>
              leg.person ? (
                <PersonBadge key={leg.transport.id} person={leg.person} size="sm" />
              ) : (
                <span key={leg.transport.id} className="text-sm text-muted-foreground">
                  {t('common.unknown')}
                </span>
              ),
            )}
          </div>
        ) : (
          <p className={cn('text-sm text-muted-foreground', isPopup ? '' : 'pl-6')}>
            {excludeLegId === undefined
              ? t('rides.noPassengers', 'Nobody in this car yet')
              : t('rides.ridingAlone', 'Nobody else in this car')}
          </p>
        )}
      </div>

      {footer}
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { RideSummary };
