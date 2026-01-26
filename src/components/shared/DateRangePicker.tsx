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

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format, isAfter, isSameDay, isValid } from 'date-fns';
import { enUS, fr } from 'date-fns/locale';
import type { Matcher, DateRange as RdpDateRange } from 'react-day-picker';
import { CalendarIcon } from 'lucide-react';

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
/**
 * Selection state for the two-click range picker.
 * - 'idle': No selection in progress, waiting for first click
 * - 'selecting': First date selected, waiting for second click
 * - 'complete': Both dates selected
 */
type SelectionState = 'idle' | 'selecting' | 'complete';

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
}: DateRangePickerProps): React.ReactElement => {
  const { t, i18n } = useTranslation(),
   [open, setOpen] = useState(false),

  // Track selection state for two-click behavior
   [selectionState, setSelectionState] = useState<SelectionState>('idle'),
  
  // Track the pending start date during selection
   pendingStartRef = useRef<Date | undefined>(undefined);

  // Reset selection state when popover closes or value changes externally
  useEffect(() => {
    if (!open) {
      // Use timeout to avoid synchronous setState in effect
      const timer = setTimeout(() => {
        setSelectionState('idle');
        pendingStartRef.current = undefined;
      }, 0);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [open]);

  // Sync selection state with external value
  useEffect(() => {
    // Use timeout to avoid synchronous setState in effect
    const timer = setTimeout(() => {
      if (value?.from && value?.to) {
        setSelectionState('complete');
      } else if (value?.from) {
        setSelectionState('selecting');
        pendingStartRef.current = value.from;
      } else {
        setSelectionState('idle');
        pendingStartRef.current = undefined;
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [value?.from, value?.to]);

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

  // Memoize selected value to prevent unnecessary Calendar re-renders
   selected = useMemo(
    () => (value ? { from: value.from, to: value.to } : undefined),
    [value]
  ),

  // Handle date selection from the calendar with two-click behavior
  // Click 1: Select start date
  // Click 2: Select end date (auto-closes)
  // Click 3: Reset and start new selection
   handleSelect = useCallback(
    (range: RdpDateRange | undefined) => {
      // If range is undefined or empty, start fresh
      if (!range?.from) {
        onChange(undefined);
        setSelectionState('idle');
        pendingStartRef.current = undefined;
        return;
      }

      const clickedDate = range.from;

      // Determine behavior based on current state
      if (selectionState === 'complete') {
        // Already have a complete selection - start new selection with this date
        pendingStartRef.current = clickedDate;
        onChange({ from: clickedDate, to: undefined });
        setSelectionState('selecting');
        return;
      }

      if (selectionState === 'selecting' && pendingStartRef.current) {
        // Second click - complete the range
        let startDate = pendingStartRef.current,
         endDate = clickedDate;

        // Normalize: ensure from <= to
        if (isAfter(startDate, endDate)) {
          [startDate, endDate] = [endDate, startDate];
        }

        // If same day clicked, treat as single-day range
        if (isSameDay(startDate, endDate)) {
          onChange({ from: startDate, to: endDate });
        } else {
          onChange({ from: startDate, to: endDate });
        }

        setSelectionState('complete');
        pendingStartRef.current = undefined;

        // Auto-close popover after complete selection
        requestAnimationFrame(() => {
          setOpen(false);
        });
        return;
      }

      // First click - start new selection
      pendingStartRef.current = clickedDate;
      onChange({ from: clickedDate, to: undefined });
      setSelectionState('selecting');
    },
    [onChange, selectionState]
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
   accessibleLabel = ariaLabel ?? t('dateRangePicker.ariaLabel', 'Date range picker');

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
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
});

export { DateRangePicker };
export type { DateRangePickerProps, DateRange };
