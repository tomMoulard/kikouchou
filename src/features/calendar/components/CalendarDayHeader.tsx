/**
 * @fileoverview Calendar day-of-week header row component.
 *
 * @module features/calendar/components/CalendarDayHeader
 */

import { type ReactElement, memo, useMemo } from 'react';
import { format } from 'date-fns';

import type { CalendarDayHeaderProps } from '../types';

/**
 * Row of day-of-week headers (Mon-Sun).
 */
const CalendarDayHeader = memo(function CalendarDayHeader({
  dateLocale,
}: CalendarDayHeaderProps): ReactElement {
  // Generate day names starting from Monday
  const dayNames = useMemo(() => {
    const baseDate = new Date(2024, 0, 1); // Jan 1, 2024 is a Monday
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(baseDate);
      day.setDate(day.getDate() + i);
      return {
        short: format(day, 'EEE', { locale: dateLocale }),
        full: format(day, 'EEEE', { locale: dateLocale }),
      };
    });
  }, [dateLocale]);

  return (
    <div className="grid grid-cols-7 gap-px bg-muted">
      {dayNames.map((day) => (
        <div
          key={day.full}
          className="bg-background p-2 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider"
          aria-label={day.full}
        >
          <span className="hidden sm:inline">{day.short}</span>
          <span className="sm:hidden">{day.short.charAt(0)}</span>
        </div>
      ))}
    </div>
  );
});

export { CalendarDayHeader };
