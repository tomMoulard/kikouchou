/**
 * @fileoverview Transport indicator component for calendar display.
 *
 * @module features/calendar/components/TransportIndicator
 */

import { type ReactElement, memo, useCallback, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { TransportIcon } from '@/components/shared/TransportIcon';
import { cn } from '@/lib/utils';
import type { TransportIndicatorProps } from '../types';
import { formatTime } from '../utils/calendar-utils';

/**
 * Transport indicator pill displayed within a calendar day.
 * Shows arrival (green) or departure (orange) with transport icon, time, person, and location.
 * When onClick is provided, becomes an interactive button with keyboard support.
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

  // Build title for accessibility - enhanced when clickable
  const typeLabel = isArrival
    ? t('transports.arrival', 'Arrival')
    : t('transports.departure', 'Departure');

  const ariaLabel = isInteractive
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

  // Full tooltip with all details
  const tooltipText = `${time} ${transport.personName}${location ? ` - ${location}` : ''}`;

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
    'border min-h-[28px] md:min-h-0', // Touch-friendly height on mobile
    isArrival
      ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800'
      : 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800',
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
      <TransportIcon mode={transportMode} className="size-3 shrink-0" />
      <span className="font-medium">{time}</span>
      <span
        className="size-2 rounded-full shrink-0"
        style={{ backgroundColor: transport.color }}
        aria-hidden="true"
      />
      <span className="truncate">{transport.personName}</span>
      {location && (
        <span className="truncate text-[10px] opacity-75">- {location}</span>
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
