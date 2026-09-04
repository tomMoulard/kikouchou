/**
 * @fileoverview Calendar day cell component.
 *
 * @module features/calendar/components/CalendarDay
 */

import { type ReactElement, memo, useCallback, useMemo } from 'react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { CalendarDayProps, CalendarEvent } from '../types';
import { MAX_VISIBLE_EVENT_SLOTS } from '../utils/calendar-utils';
import { ActivityIndicator } from './ActivityIndicator';
import { CalendarEventPill } from './CalendarEventPill';
import { TransportIndicator } from './TransportIndicator';

/**
 * Single day cell in the calendar grid.
 * Events are rendered in slot-based positions to support multi-day spanning.
 */
const CalendarDay = memo(function CalendarDay({
  dateKey,
  date,
  events,
  transports,
  activities,
  headcount,
  isCurrentMonth,
  isToday,
  isWithinTrip,
  dateLocale,
  tabIndex,
  onEventClick,
  onTransportClick,
  onActivityClick,
  onDayFocus,
  onDayKeyDown,
  dayRef,
}: CalendarDayProps): ReactElement {
  const { t } = useTranslation();
  const dayNumber = format(date, 'd', { locale: dateLocale });
  const dateLabel = format(date, 'PPPP', { locale: dateLocale });
  const summaryId = `${dateKey}-summary`;

  // Calculate max slot index for the slot indices array (memoized, no spread operator)
  const maxSlotIndex = useMemo(() => {
    if (events.length === 0) {
      return -1;
    }
    let max = -1;
    for (const e of events) {
      if (e.slotIndex > max) {
        max = e.slotIndex;
      }
    }
    return max;
  }, [events]);

  // Limit visible items
  const maxVisibleTransports = 2;
  const visibleTransports = transports.slice(0, maxVisibleTransports);
  const hiddenTransportCount = transports.length - visibleTransports.length;

  const maxVisibleActivities = 2;
  const visibleActivities = activities.slice(0, maxVisibleActivities);
  const hiddenActivityCount = activities.length - visibleActivities.length;

  // For events, we show up to MAX_VISIBLE_EVENT_SLOTS slots
  // Events in higher slots get hidden (events are already sorted by slotIndex)
  const visibleEvents = useMemo(() => {
    const visible: CalendarEvent[] = [];
    for (const e of events) {
      if (e.slotIndex >= MAX_VISIBLE_EVENT_SLOTS) {
        break;
      } // Early exit since sorted
      visible.push(e);
    }
    return visible;
  }, [events]);

  const hiddenEventCount = events.length - visibleEvents.length;
  const totalHiddenCount = hiddenTransportCount + hiddenEventCount + hiddenActivityCount;

  const peopleOnSite = headcount?.people ?? 0;

  const accessibilitySummary = useMemo(() => {
    const parts: string[] = [];

    if (isToday) {
      parts.push(t('calendar.today'));
    }

    if (peopleOnSite > 0) {
      parts.push(
        t('calendar.peopleOnSite', '{{count}} people on site', { count: peopleOnSite }),
      );
    }

    if (!isCurrentMonth) {
      parts.push(t('calendar.outsideCurrentMonth', 'Outside the current month'));
    }

    if (isCurrentMonth && !isWithinTrip) {
      parts.push(t('calendar.outsideTripDates', 'Outside the trip dates'));
    }

    if (totalHiddenCount > 0) {
      parts.push(
        t('calendar.moreItemsHidden', '{{count}} more items in this day', {
          count: totalHiddenCount,
        }),
      );
    }

    return parts.join('. ');
  }, [isCurrentMonth, isToday, isWithinTrip, peopleOnSite, t, totalHiddenCount]);

  // Build an array of slot indices to render (including empty slots for alignment)
  const slotIndices = useMemo(() => {
    const indices: (number | null)[] = [];
    const maxSlot = Math.min(maxSlotIndex, MAX_VISIBLE_EVENT_SLOTS - 1);
    for (let i = 0; i <= maxSlot; i++) {
      indices.push(i);
    }
    return indices;
  }, [maxSlotIndex]);

  // Map slot index to event for quick lookup
  const eventsBySlot = useMemo(() => {
    const map = new Map<number, CalendarEvent>();
    for (const event of visibleEvents) {
      map.set(event.slotIndex, event);
    }
    return map;
  }, [visibleEvents]);

  const handleFocus = useCallback(() => {
    onDayFocus?.(dateKey);
  }, [dateKey, onDayFocus]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      onDayKeyDown?.(event, dateKey);
    },
    [dateKey, onDayKeyDown],
  );

  const handleRef = useCallback(
    (node: HTMLDivElement | null) => {
      dayRef?.(dateKey, node);
    },
    [dateKey, dayRef],
  );

  return (
    <div
      ref={handleRef}
      className={cn(
        'bg-background min-h-[80px] sm:min-h-[100px] p-1 flex flex-col',
        'border-t border-muted',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        !isCurrentMonth && 'bg-muted/30',
        !isWithinTrip && isCurrentMonth && 'bg-muted/50',
      )}
      tabIndex={tabIndex}
      role="gridcell"
      aria-label={dateLabel}
      aria-current={isToday ? 'date' : undefined}
      aria-describedby={accessibilitySummary ? summaryId : undefined}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
    >
      {/*
        Day number + people on site (meal planning).

        Both used to dim to `text-muted-foreground/50` outside the current
        month, which measures 2.23:1 in light and 2.75:1 in dark against the
        cell's own `bg-muted/30` — under half of WCAG 1.4.3's 4.5:1 for 14px
        medium text, and worse for the 12px headcount. Nothing here is
        decorative: `CalendarPage` looks events, transports, activities and
        headcounts up by date with no `isCurrentMonth` gate, so an out-of-month
        cell in a trip that straddles a month boundary is a fully populated,
        focusable `gridcell` whose date is the only thing telling you which day
        you are on.

        Full-opacity `text-muted-foreground` measures 6.66:1 / 7.40:1 and still
        reads as secondary: the step to `text-foreground` on in-month days is
        6.66 → 19.85, and "outside the current month" is carried twice over
        besides — by the cell's `bg-muted/30` and by the cell's
        `aria-describedby` summary.
      */}
      <div className="relative flex items-center justify-center mb-1">
        <span
          className={cn(
            'text-sm font-medium size-6 flex items-center justify-center rounded-full',
            !isCurrentMonth && 'text-muted-foreground',
            isCurrentMonth && !isToday && 'text-foreground',
            isToday && 'bg-primary text-primary-foreground',
          )}
        >
          {dayNumber}
        </span>

        {/* Screen readers get this count from the cell's aria-describedby summary. */}
        {peopleOnSite > 0 && (
          <span
            className="absolute right-0 flex items-center gap-0.5 text-xs font-medium text-muted-foreground"
            title={t('calendar.peopleOnSite', '{{count}} people on site', {
              count: peopleOnSite,
            })}
            data-testid={`day-headcount-${dateKey}`}
            aria-hidden="true"
          >
            <Users className="size-3 shrink-0" />
            <span className="tabular-nums">{peopleOnSite}</span>
          </span>
        )}
      </div>

      {/* Content area with activities, transports and stays */}
      <div className="flex-1 flex flex-col gap-0.5 overflow-hidden">
        {/* Activities (the shared agenda) - shown at top */}
        {visibleActivities.map((calendarActivity) => (
          <ActivityIndicator
            key={calendarActivity.activity.id}
            activity={calendarActivity}
            onClick={onActivityClick}
          />
        ))}

        {/* Transports (arrivals/departures) */}
        {visibleTransports.map((transport) => (
          <TransportIndicator
            key={transport.transport.id}
            transport={transport}
            type={transport.transport.type}
            onClick={onTransportClick}
          />
        ))}

        {/* Room assignment events - slot-based positioning */}
        {slotIndices.map((slotIndex) => {
          if (slotIndex === null) {
            return null;
          }
          const event = eventsBySlot.get(slotIndex);

          if (event) {
            return (
              <CalendarEventPill
                key={`${event.spanId}-${slotIndex}`}
                event={event}
                onClick={onEventClick}
              />
            );
          }

          // Render empty placeholder for this slot to maintain alignment
          // This happens when an event occupies this slot on adjacent days but not this day
          return (
            <div
              key={`empty-${slotIndex}`}
              className="h-[28px] md:h-[24px]"
              aria-hidden="true"
            />
          );
        })}

        {/* Hidden items indicator */}
        {totalHiddenCount > 0 && (
          <div className="text-xs text-muted-foreground text-center">
            +{totalHiddenCount}
            <span className="sr-only">
              {t('calendar.moreItemsHidden', '{{count}} more items in this day', {
                count: totalHiddenCount,
              })}
            </span>
          </div>
        )}
      </div>

      {accessibilitySummary && (
        <span id={summaryId} className="sr-only">
          {accessibilitySummary}
        </span>
      )}
    </div>
  );
});

export { CalendarDay };
