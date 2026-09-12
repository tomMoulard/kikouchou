/**
 * @fileoverview Transport indicator component for calendar display.
 *
 * @module features/calendar/components/TransportIndicator
 */

import { type ReactElement, memo, useCallback, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Car } from 'lucide-react';

import { statusVariants } from '@/components/ui/status.variants';
import { TransportIcon } from '@/components/shared/TransportIcon';
import { cn } from '@/lib/utils';
import type { TransportIndicatorProps } from '../types';
import { formatTime } from '../utils/calendar-utils';

/**
 * Transport indicator pill displayed within a calendar day.
 * Shows arrival (green) or departure (orange) with transport icon, time, person, and location.
 * When onClick is provided, becomes an interactive button with keyboard support.
 *
 * A leg somebody is driving carries a car glyph as well. The glyph is never
 * alone: it is announced through the pill's own label and repeated in the
 * tooltip, because a pill three words wide cannot afford a second line and an
 * unlabelled icon says nothing to a screen reader.
 */
const TransportIndicator = memo(function TransportIndicator({
  transport,
  type,
  onClick,
}: TransportIndicatorProps): ReactElement {
  const { t } = useTranslation();

  const isArrival = type === 'arrival';
  const time = formatTime(transport.transport.datetime);
  const location = transport.transport.location;
  const transportMode = transport.transport.transportMode ?? 'other';
  const isInteractive = !!onClick;

  // A legacy `driverId`-only leg has no ride to name, and the calendar keeps
  // rendering it exactly as it did before rides existed. `CalendarPage` already
  // leaves `ride` unset for those; the check is repeated here so a caller
  // assembling a `CalendarTransport` by hand cannot reintroduce the difference.
  const ride = transport.ride !== undefined && !transport.ride.isLegacy
    ? transport.ride
    : undefined;
  const driverName = ride?.driver?.name;

  const rideLabel =
    ride === undefined
      ? undefined
      : driverName === undefined
        ? t('rides.partOfRide', 'Part of a shared ride')
        : t('rides.partOfRideWithDriver', 'Part of a shared ride — {{name}} driving', {
            name: driverName,
          });

  // Build title for accessibility - enhanced when clickable
  const typeLabel = isArrival
    ? t('transports.arrival', 'Arrival')
    : t('transports.departure', 'Departure');

  const baseAriaLabel = isInteractive
    ? t('calendar.viewTransportDetails', "View {{name}}'s {{type}} details", {
        name: transport.personName,
        type: typeLabel,
      })
    : isArrival
      ? t('calendar.personArriving', '{{name}} arriving', {
          name: transport.personName,
        })
      : t('calendar.personDeparting', '{{name}} departing', {
          name: transport.personName,
        });

  const ariaLabel =
    rideLabel === undefined ? baseAriaLabel : `${baseAriaLabel} — ${rideLabel}`;

  // Full tooltip with all details
  const baseTooltipText = `${time} ${transport.personName}${location ? ` - ${location}` : ''}`;
  const tooltipText =
    rideLabel === undefined ? baseTooltipText : `${baseTooltipText} — ${rideLabel}`;

  // Handle click
  const handleClick = useCallback(() => {
    onClick?.(transport);
  }, [onClick, transport]);

  // Handle keyboard activation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick?.(transport);
      }
    },
    [onClick, transport],
  );

  // Common class names for the indicator
  const indicatorClasses = cn(
    'flex items-center gap-1 text-xs rounded px-1.5 py-0.5 truncate',
    'border min-h-[44px] md:min-h-0', // Touch-friendly height on mobile
    statusVariants({ tone: type }),
    isInteractive && [
      'cursor-pointer',
      'hover:opacity-80',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      'transition-opacity',
    ],
  );

  // Render content (shared between button and div)
  const content = (
    <>
      <span className="font-semibold" aria-hidden="true">
        {isArrival ? '↓' : '↑'}
      </span>
      <TransportIcon mode={transportMode} className="size-3 shrink-0" />
      {ride && (
        <Car className="size-3 shrink-0" aria-hidden="true" data-testid="ride-glyph" />
      )}
      <span className="font-medium">{time}</span>
      <span
        className="size-2 rounded-full shrink-0"
        style={{ backgroundColor: transport.color }}
        aria-hidden="true"
      />
      <span className="truncate">{transport.personName}</span>
      {location && (
        <span className="truncate opacity-75">- {location}</span>
      )}
    </>
  );

  // Render as button when interactive, div otherwise
  if (isInteractive) {
    return (
      <button
        type="button"
        className={indicatorClasses}
        title={tooltipText}
        aria-label={ariaLabel}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={indicatorClasses} title={tooltipText} aria-label={ariaLabel}>
      {content}
    </div>
  );
});

export { TransportIndicator };
