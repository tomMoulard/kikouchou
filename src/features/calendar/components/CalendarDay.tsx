/**
 * @fileoverview Calendar day cell component.
 *
 * @module features/calendar/components/CalendarDay
 */

import { type ReactElement, memo, useMemo } from 'react';
import { format } from 'date-fns';

import { cn } from '@/lib/utils';
import type { CalendarDayProps, CalendarEvent } from '../types';
import { MAX_VISIBLE_EVENT_SLOTS } from '../utils/calendar-utils';
import { CalendarEventPill } from './CalendarEventPill';
import { TransportIndicator } from './TransportIndicator';

/**
 * Single day cell in the calendar grid.
 * Events are rendered in slot-based positions to support multi-day spanning.
 */
const CalendarDay = memo(function CalendarDay({
  date,
  events,
  transports,
  isCurrentMonth,
  isToday,
  isWithinTrip,
  dateLocale,
  onEventClick,
}: CalendarDayProps): ReactElement {
  const dayNumber = format(date, 'd', { locale: dateLocale });
  const dateLabel = format(date, 'PPPP', { locale: dateLocale });

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
  const totalHiddenCount = hiddenTransportCount + hiddenEventCount;

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

  return (
    <div
      className={cn(
        'bg-background min-h-[80px] sm:min-h-[100px] p-1 flex flex-col',
        'border-t border-muted',
        !isCurrentMonth && 'bg-muted/30',
        !isWithinTrip && isCurrentMonth && 'bg-muted/50',
      )}
      role="gridcell"
      aria-label={dateLabel}
    >
      {/* Day number */}
      <div className="flex items-center justify-center mb-1">
        <span
          className={cn(
            'text-sm font-medium size-6 flex items-center justify-center rounded-full',
            !isCurrentMonth && 'text-muted-foreground/50',
            isCurrentMonth && !isToday && 'text-foreground',
            isToday && 'bg-primary text-primary-foreground',
          )}
        >
          {dayNumber}
        </span>
      </div>

      {/* Content area with events and transports */}
      <div className="flex-1 flex flex-col gap-0.5 overflow-hidden">
        {/* Transports (arrivals/departures) - shown at top */}
        {visibleTransports.map((transport) => (
          <TransportIndicator
            key={transport.transport.id}
            transport={transport}
            type={transport.transport.type}
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
          </div>
        )}
      </div>
    </div>
  );
});

export { CalendarDay };
