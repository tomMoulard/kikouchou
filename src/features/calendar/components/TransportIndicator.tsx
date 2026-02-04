/**
 * @fileoverview Transport indicator component for calendar display.
 *
 * @module features/calendar/components/TransportIndicator
 */

import { type ReactElement, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { TransportIcon } from '@/components/shared/TransportIcon';
import { cn } from '@/lib/utils';
import type { TransportIndicatorProps } from '../types';
import { formatTime } from '../utils/calendar-utils';

/**
 * Transport indicator pill displayed within a calendar day.
 * Shows arrival (green) or departure (orange) with transport icon, time, person, and location.
 */
const TransportIndicator = memo(function TransportIndicator({
  transport,
  type,
}: TransportIndicatorProps): ReactElement {
  const { t } = useTranslation();

  const isArrival = type === 'arrival';
  const time = formatTime(transport.transport.datetime);
  const location = transport.transport.location;
  const transportMode = transport.transport.transportMode ?? 'other';

  // Build title for accessibility
  const ariaLabel = isArrival
    ? t('calendar.personArriving', '{{name}} arriving', {
        name: transport.personName,
      })
    : t('calendar.personDeparting', '{{name}} departing', {
        name: transport.personName,
      });

  // Full tooltip with all details
  const tooltipText = `${time} ${transport.personName}${location ? ` - ${location}` : ''}`;

  return (
    <div
      className={cn(
        'flex items-center gap-1 text-xs rounded px-1.5 py-0.5 truncate',
        'border',
        isArrival
          ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800'
          : 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800',
      )}
      title={tooltipText}
      aria-label={ariaLabel}
    >
      <TransportIcon mode={transportMode} className="size-3" />
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
    </div>
  );
});

export { TransportIndicator };
