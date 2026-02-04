/**
 * @fileoverview Calendar header component with month/year display and navigation controls.
 *
 * @module features/calendar/components/CalendarHeader
 */

import { type ReactElement, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { CalendarHeaderProps } from '../types';

/**
 * Header with month/year display and navigation controls.
 */
const CalendarHeader = memo(function CalendarHeader({
  currentMonth,
  onPrevMonth,
  onNextMonth,
  onToday,
  dateLocale,
}: CalendarHeaderProps): ReactElement {
  const { t } = useTranslation();

  const monthYearLabel = useMemo(
    () => format(currentMonth, 'LLLL yyyy', { locale: dateLocale }),
    [currentMonth, dateLocale],
  );

  return (
    <div className="flex items-center justify-between gap-4 mb-4">
      {/* Navigation buttons */}
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          onClick={onPrevMonth}
          aria-label={t('calendar.previousMonth', 'Previous month')}
          className="size-10 md:size-8"
        >
          <ChevronLeft className="size-5 md:size-4" aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={onNextMonth}
          aria-label={t('calendar.nextMonth', 'Next month')}
          className="size-10 md:size-8"
        >
          <ChevronRight className="size-5 md:size-4" aria-hidden="true" />
        </Button>
      </div>

      {/* Month/Year display */}
      <h2 className="text-lg font-semibold capitalize flex-1 text-center">
        {monthYearLabel}
      </h2>

      {/* Today button */}
      <Button
        variant="outline"
        size="sm"
        onClick={onToday}
        className="hidden sm:flex"
      >
        {t('calendar.today')}
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={onToday}
        aria-label={t('calendar.today')}
        className="size-8 sm:hidden"
      >
        <CalendarIcon className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
});

export { CalendarHeader };
