/**
 * DateRangePicker Component
 *
 * A date range picker that allows users to select a start and end date.
 * Uses shadcn/ui Calendar inside a Popover with locale-aware formatting.
 *
 * Selection behavior:
 * 1. First click selects the start date
 * 2. Second click selects the end date (auto-closes popover)
 * 3. Third click resets and starts new selection
 *
 * @example
 * ```tsx
 * import { DateRangePicker } from '@/components/shared/DateRangePicker';
 *
 * function MyComponent() {
 *   const [dateRange, setDateRange] = useState<DateRange>();
 *
 *   return (
 *     <DateRangePicker
 *       value={dateRange}
 *       onChange={setDateRange}
 *       minDate={tripStartDate}
 *       maxDate={tripEndDate}
 *     />
 *   );
 * }
 * ```
 */

import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { eachDayOfInterval, format, isAfter, isValid } from 'date-fns';
import { enUS, fr } from 'date-fns/locale';
import type { Matcher, DateRange as RdpDateRange } from 'react-day-picker';
import { CalendarIcon, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

/**
 * Represents a date range with optional start and end dates.
 */
interface DateRange {
  readonly from: Date | undefined;
  readonly to: Date | undefined;
}

/**
 * Represents an already booked date range to display in the calendar.
 */
interface BookedRange {
  /** Start date of the booked period */
  readonly from: Date;
  /** End date of the booked period */
  readonly to: Date;
  /** Optional label to show (e.g., person's name) */
  readonly label?: string;
}

/**
 * Props for the DateRangePicker component.
 */
interface DateRangePickerProps {
  /** The currently selected date range */
  readonly value: DateRange | undefined;
  /** Callback fired when the date range changes */
  readonly onChange: (range: DateRange | undefined) => void;
  /** Minimum selectable date (dates before this are disabled) */
  readonly minDate?: Date;
  /** Maximum selectable date (dates after this are disabled) */
  readonly maxDate?: Date;
  /** Placeholder text when no date is selected */
  readonly placeholder?: string;
  /** Whether the picker is disabled */
  readonly disabled?: boolean;
  /** Additional CSS classes for the trigger button */
  readonly className?: string;
  /** Number of months to display (1 or 2) */
  readonly numberOfMonths?: 1 | 2;
  /** Accessible label for the picker */
  readonly 'aria-label'?: string;
  /** ID of element that describes this picker */
  readonly 'aria-describedby'?: string;
  /** Unique identifier for the component */
  readonly id?: string;
  /** Date ranges that are already booked (shown with visual indicator) */
  readonly bookedRanges?: readonly BookedRange[];
}

/**
 * Type guard to check if a date is valid.
 */
function isValidDate(date: Date | undefined): date is Date {
  return date !== undefined && isValid(date);
}

/**
 * Get the date-fns locale based on the current i18n language.
 */
function getDateFnsLocale(language: string): typeof fr | typeof enUS {
  return language === 'fr' ? fr : enUS;
}

/**
 * DateRangePicker component for selecting a range of dates.
 *
 * Features:
 * - Uses shadcn/ui Calendar and Popover
 * - Locale-aware date formatting
 * - Supports min/max date constraints
 * - Accessible with proper ARIA attributes
 * - Auto-closes when range selection is complete
 */
const DateRangePicker = memo(({
  value,
  onChange,
  minDate,
  maxDate,
  placeholder,
  disabled = false,
  className,
  numberOfMonths = 1,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  id,
  bookedRanges,
}: DateRangePickerProps): React.ReactElement => {
  const { t, i18n } = useTranslation(),
   [open, setOpen] = useState(false);

  // Get the appropriate date-fns locale
  const locale = useMemo(
    () => getDateFnsLocale(i18n.language),
    [i18n.language]
  ),

  // Build disabled date matchers for react-day-picker
   disabledDays = useMemo((): Matcher[] => {
    const matchers: Matcher[] = [];

    if (minDate && isValidDate(minDate)) {
      matchers.push({ before: minDate });
    }

    if (maxDate && isValidDate(maxDate)) {
      matchers.push({ after: maxDate });
    }

    // Warn if minDate is after maxDate (development only)
    if (
      import.meta.env.DEV &&
      minDate &&
      maxDate &&
      isValidDate(minDate) &&
      isValidDate(maxDate) &&
      isAfter(minDate, maxDate)
    ) {
      console.warn(
        'DateRangePicker: minDate is after maxDate, all dates will be disabled'
      );
    }

    return matchers;
  }, [minDate, maxDate]),

  // Build array of booked dates for visual indicator
   bookedDates = useMemo((): Date[] => {
    if (!bookedRanges || bookedRanges.length === 0) {
      return [];
    }

    const dates: Date[] = [];
    for (const range of bookedRanges) {
      if (isValidDate(range.from) && isValidDate(range.to)) {
        // For room assignments: start date is check-in, end date is check-out
        // Only the nights (start date up to but NOT including end date) are "booked"
        // Example: Jan 15-16 = staying night of Jan 15, checking out morning of Jan 16
        // So only Jan 15 should show as booked, not Jan 16
        const daysInRange = eachDayOfInterval({ start: range.from, end: range.to });
        // Exclude the last day (checkout day)
        dates.push(...daysInRange.slice(0, -1));
      }
    }
    return dates;
  }, [bookedRanges]),

  // Modifiers for react-day-picker to style booked dates
   modifiers = useMemo(() => {
    if (bookedDates.length === 0) {
      return undefined;
    }
    return {
      booked: bookedDates,
    };
  }, [bookedDates]),

  // Custom class names for modifiers
   modifiersClassNames = useMemo(() => {
    if (bookedDates.length === 0) {
      return undefined;
    }
    return {
      booked: 'rdp-day-booked',
    };
  }, [bookedDates]),

  // Format the display text based on selected range
   displayText = useMemo((): string => {
    const defaultPlaceholder =
      placeholder ?? t('dateRangePicker.placeholder', 'Select date range');

    if (!value?.from || !isValidDate(value.from)) {
      return defaultPlaceholder;
    }

    const dateFormat = 'PP', // Localized date format (e.g., "Jan 1, 2024" or "1 janv. 2024")
     fromStr = format(value.from, dateFormat, { locale });

    if (!value.to || !isValidDate(value.to)) {
      // Only start date selected - show that we're waiting for end date
      return t('dateRangePicker.selectEndDate', '{{date}} → select end date', { date: fromStr });
    }

    const toStr = format(value.to, dateFormat, { locale });

    // Same day selection
    if (value.from.getTime() === value.to.getTime()) {
      return fromStr;
    }

    return `${fromStr} → ${toStr}`;
  }, [value, placeholder, locale, t]),

  // Determine if a value is currently selected (for styling)
  // Simple computation - no need for useMemo overhead
   hasSelection = value?.from !== undefined && isValidDate(value.from),

  // Pass value directly to Calendar - no memoization needed as value changes are the intended re-render trigger
   selected = value ? { from: value.from, to: value.to } : undefined,

  // Handle date selection from the calendar
  // react-day-picker v9 passes the updated range directly to onSelect
   handleSelect = useCallback(
    (range: RdpDateRange | undefined) => {
      // Pass the range through to parent
      // Note: range.from and range.to may both be set (complete range)
      // or only range.from may be set (start of selection)
      if (!range) {
        onChange(undefined);
        return;
      }

      // Pass the new range to parent
      onChange({ from: range.from, to: range.to });

      // Auto-close popover when range is complete (two different dates selected)
      // IMPORTANT: react-day-picker v9 sets BOTH from AND to on the FIRST click
      // (when min=0), both pointing to the same date. We must NOT close in this case
      // because the user is just starting their selection, not completing it.
      // We only close when from !== to, indicating the user has selected two different dates.
      if (range.from && range.to && range.from.getTime() !== range.to.getTime()) {
        requestAnimationFrame(() => {
          setOpen(false);
        });
      }
    },
    [onChange]
  ),

  // Determine the default month to show in the calendar
   defaultMonth = useMemo((): Date | undefined => {
    if (value?.from && isValidDate(value.from)) {
      return value.from;
    }
    if (minDate && isValidDate(minDate)) {
      return minDate;
    }
    return undefined;
  }, [value, minDate]),

  // Accessible label for the trigger button
  // Simple computation - no need for useMemo overhead
   accessibleLabel = ariaLabel ?? t('dateRangePicker.ariaLabel', 'Date range picker'),

  // Handle clear button click - resets selection
   handleClear = useCallback(() => {
    onChange(undefined);
  }, [onChange]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          disabled={disabled}
          aria-label={accessibleLabel}
          aria-describedby={ariaDescribedBy}
          aria-expanded={open}
          aria-haspopup="dialog"
          className={cn(
            'w-full justify-start text-left font-normal',
            !hasSelection && 'text-muted-foreground',
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{displayText}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0"
        align="start"
        role="dialog"
        aria-label={t('dateRangePicker.calendarDialog', 'Select date range')}
      >
        <Calendar
          mode="range"
          selected={selected}
          onSelect={handleSelect}
          numberOfMonths={numberOfMonths}
          disabled={disabledDays}
          defaultMonth={defaultMonth}
          locale={locale}
          modifiers={modifiers}
          modifiersClassNames={modifiersClassNames}
          initialFocus
        />
        {/* Footer with booked indicator and clear button */}
        <div className="flex items-center justify-between px-3 pb-3">
          {bookedDates.length > 0 ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="relative flex h-4 w-4 items-center justify-center">
                <span className="absolute h-1 w-1 rounded-full bg-destructive opacity-70" />
              </span>
              <span>{t('dateRangePicker.alreadyBooked', 'Already assigned')}</span>
            </div>
          ) : (
            <div />
          )}
          {hasSelection && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              className="h-7 px-2 text-xs"
              aria-label={t('dateRangePicker.clear', 'Clear selection')}
            >
              <X className="h-3 w-3 mr-1" aria-hidden="true" />
              {t('dateRangePicker.clear', 'Clear')}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
});

export { DateRangePicker };
export type { DateRangePickerProps, DateRange, BookedRange };
