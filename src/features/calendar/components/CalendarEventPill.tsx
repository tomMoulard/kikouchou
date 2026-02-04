/**
 * @fileoverview Calendar event pill component for displaying room assignments.
 *
 * @module features/calendar/components/CalendarEventPill
 */

import { type ReactElement, memo, useCallback } from 'react';

import { cn } from '@/lib/utils';
import type { CalendarEventProps } from '../types';
import { getSegmentBorderRadiusClasses } from '../utils/calendar-utils';

/**
 * Single event pill displayed within a calendar day.
 * Supports multi-day spanning with proper segment styling.
 */
const CalendarEventPill = memo(function CalendarEventPill({
  event,
  onClick,
}: CalendarEventProps): ReactElement {
  const handleClick = useCallback(() => {
    onClick(event.assignment);
  }, [onClick, event.assignment]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick(event.assignment);
      }
    },
    [onClick, event.assignment],
  );

  // Determine if we should show the label
  // Show on: single-day events, start of span, or start of a new row (week continuation)
  const showLabel =
    event.segmentPosition === 'single' ||
    event.segmentPosition === 'start' ||
    (event.isRowStart && event.segmentPosition !== 'end');

  // Get border radius classes based on segment position and row boundaries
  const borderRadiusClasses = getSegmentBorderRadiusClasses(
    event.segmentPosition,
    event.isRowStart && event.segmentPosition !== 'start',
    event.isRowEnd && event.segmentPosition !== 'end',
  );

  // Determine left/right margins for visual spacing at boundaries
  // Add margin on interior boundaries to create visual gap between adjacent events
  const marginClasses = cn(
    // Left margin only if NOT at row start and NOT logical start
    event.segmentPosition !== 'start' && !event.isRowStart && '-ml-px',
  );

  return (
    <button
      type="button"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'w-full text-left text-xs px-1.5 py-1 md:px-1 md:py-0.5 truncate',
        'min-h-[28px] md:min-h-0',
        'transition-opacity hover:opacity-80',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        'cursor-pointer',
        borderRadiusClasses,
        marginClasses,
      )}
      style={{
        backgroundColor: event.color,
        color: event.textColor,
      }}
      title={event.label}
      aria-label={event.label}
    >
      {showLabel ? event.label : '\u00A0'}
    </button>
  );
});

export { CalendarEventPill };
