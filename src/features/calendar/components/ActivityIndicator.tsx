/**
 * @fileoverview Activity pill displayed inside a calendar day cell.
 *
 * @module features/calendar/components/ActivityIndicator
 */

import { type KeyboardEvent, type ReactElement, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { ActivityCategoryIcon } from '@/components/shared/ActivityCategoryIcon';
import { cn } from '@/lib/utils';
import type { ActivityIndicatorProps } from '../types';
import { formatTime, getContrastTextColor } from '../utils/calendar-utils';

/**
 * Compact activity pill for the month grid.
 *
 * Shows the category icon, the start time (or an all-day marker) and the title,
 * tinted with the category colour. Becomes a button when a click handler is given.
 *
 * @param props - Component props
 * @returns The activity indicator element
 */
const ActivityIndicator = memo(function ActivityIndicator({
  activity: calendarActivity,
  onClick,
}: ActivityIndicatorProps): ReactElement {
  const { t } = useTranslation();

  const { activity, color, isSpanStart, isSpanEnd } = calendarActivity;
  const textColor = getContrastTextColor(color);
  const isInteractive = Boolean(onClick);

  const time = activity.allDay ? '' : formatTime(activity.startDatetime);
  const categoryLabel = t(`activities.categories.${activity.category}`);
  const participantCount = activity.participantIds?.length ?? 0;

  const tooltipText = [
    activity.allDay ? t('activities.allDay') : time,
    activity.title,
    activity.location,
  ]
    .filter(Boolean)
    .join(' — ');

  const ariaLabel = t(
    'calendar.viewActivityDetails',
    'View activity {{title}} ({{category}}), {{participants}} participants',
    {
      title: activity.title,
      category: categoryLabel,
      participants: participantCount,
    },
  );

  const handleClick = useCallback(() => {
    onClick?.(activity);
  }, [activity, onClick]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onClick?.(activity);
      }
    },
    [activity, onClick],
  );

  const indicatorClasses = cn(
    'flex items-center gap-1 px-1.5 py-0.5 text-xs truncate',
    'min-h-[44px] md:min-h-0', // Touch-friendly height on mobile
    // Multi-day activities keep flat edges where the span continues
    isSpanStart ? 'rounded-l' : 'rounded-l-none',
    isSpanEnd ? 'rounded-r' : 'rounded-r-none',
    isInteractive && [
      'cursor-pointer',
      'hover:opacity-80',
      'transition-opacity',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    ],
  );

  const indicatorStyle = { backgroundColor: color, color: textColor };

  const content = (
    <>
      <ActivityCategoryIcon category={activity.category} className="size-3" />
      {time && <span className="font-medium tabular-nums">{time}</span>}
      {/* Only the first cell of a span repeats the title; continuation cells stay bare. */}
      {isSpanStart ? (
        <span className="truncate">{activity.title}</span>
      ) : (
        <span className="truncate opacity-80">↔</span>
      )}
    </>
  );

  if (isInteractive) {
    return (
      <button
        type="button"
        className={indicatorClasses}
        style={indicatorStyle}
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
    <div
      className={indicatorClasses}
      style={indicatorStyle}
      title={tooltipText}
      aria-label={ariaLabel}
    >
      {content}
    </div>
  );
});

export { ActivityIndicator };
