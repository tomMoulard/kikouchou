/**
 * DateRangePicker Component
 *
 * A start and an end date, each a native `<input type="date">`, so a phone
 * opens its own date wheel or calendar sheet rather than a calendar drawn by
 * the app. A drawn calendar had to fit a popover or a dialog on a 360px screen,
 * and the system picker already fits every screen it ships on, with the
 * platform's own gestures and accessibility. The cost is that it is styled by
 * the browser, and that it shows dates in the browser's locale rather than the
 * app's.
 *
 * Selection behavior:
 * 1. The start input sets `from`; an end now before it is dropped
 * 2. The end input sets `to`, and cannot go before the start
 * 3. Clearing both reports `undefined`
 *
 * Neither input is bounded by the trip: its dates are indicative, and a guest
 * may arrive before it starts or leave after it ends.
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
 *     />
 *   );
 * }
 * ```
 */

import { type ChangeEvent, memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { format, isBefore, isValid, parseISO } from 'date-fns';
import { X } from 'lucide-react';

import { getDateLocale } from '@/lib/i18n/date-locale';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Represents a date range with optional start and end dates.
 */
interface DateRange {
  readonly from: Date | undefined;
  readonly to: Date | undefined;
}

/**
 * Represents an already booked date range, listed under the inputs.
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
  /** Whether the picker is disabled */
  readonly disabled?: boolean;
  /** Additional CSS classes for both inputs */
  readonly className?: string;
  /** Accessible label for the pair of inputs */
  readonly 'aria-label'?: string;
  /** ID of element that describes this picker */
  readonly 'aria-describedby'?: string;
  /** Id of the start input. The end input gets `${id}-end`. */
  readonly id?: string;
  /** Date ranges that are already booked (listed under the inputs) */
  readonly bookedRanges?: readonly BookedRange[];
}

/** The value format of `<input type="date">`. */
const INPUT_DATE_FORMAT = 'yyyy-MM-dd';

/**
 * Type guard to check if a date is valid.
 */
function isValidDate(date: Date | undefined): date is Date {
  return date !== undefined && isValid(date);
}

/**
 * Writes a date as an `<input type="date">` value, `''` when absent.
 */
function toInputValue(date: Date | undefined): string {
  return isValidDate(date) ? format(date, INPUT_DATE_FORMAT) : '';
}

/**
 * Reads an `<input type="date">` value as a local midnight, the same day a
 * calendar click produced.
 */
function fromInputValue(value: string): Date | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : undefined;
}

/**
 * DateRangePicker component for selecting a range of dates.
 *
 * Features:
 * - Native date inputs, so each device shows its own picker
 * - An end never before the start
 * - Lists the ranges already booked, which a native picker cannot mark
 * - Accessible: the two inputs are a named group
 */
const DateRangePicker = memo(({
  value,
  onChange,
  disabled = false,
  className,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  id,
  bookedRanges,
}: DateRangePickerProps): React.ReactElement => {
  const { t, i18n } = useTranslation(),

   locale = useMemo(
    () => getDateLocale(i18n.language),
    [i18n.language]
  ),

   fromValue = toInputValue(value?.from),
   toValue = toInputValue(value?.to),

  // Ranges with a valid start and end, in the app's language: the native
  // picker has no way to mark a day, so the clashes are spelled out instead.
   bookedLabels = useMemo((): string[] => {
    if (!bookedRanges) {
      return [];
    }
    return bookedRanges
      .filter((range) => isValidDate(range.from) && isValidDate(range.to))
      .map((range) => {
        const dates = `${format(range.from, 'PP', { locale })} → ${format(range.to, 'PP', { locale })}`;
        return range.label ? `${range.label} (${dates})` : dates;
      });
  }, [bookedRanges, locale]),

   hasSelection = fromValue !== '' || toValue !== '',

   accessibleLabel = ariaLabel ?? t('dateRangePicker.ariaLabel', 'Date range picker'),

   emit = useCallback(
    (from: Date | undefined, to: Date | undefined) => {
      onChange(from || to ? { from, to } : undefined);
    },
    [onChange],
  ),

   handleFromChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const from = fromInputValue(e.target.value);
      // An end the new start has overtaken is a range the end input itself
      // cannot produce, so it goes rather than standing there invalid.
      const to = from && value?.to && isBefore(value.to, from) ? undefined : value?.to;
      emit(from, to);
    },
    [emit, value?.to],
  ),

   handleToChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      emit(value?.from, fromInputValue(e.target.value));
    },
    [emit, value?.from],
  ),

   handleClear = useCallback(() => {
    onChange(undefined);
  }, [onChange]);

  const endId = id ? `${id}-end` : undefined;

  return (
    <div
      role="group"
      aria-label={accessibleLabel}
      aria-describedby={ariaDescribedBy}
      className="space-y-2"
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t('dateRangePicker.start', 'From')}
          <Input
            id={id}
            type="date"
            value={fromValue}
            onChange={handleFromChange}
            disabled={disabled}
            className={cn('text-foreground', className)}
          />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t('dateRangePicker.end', 'To')}
          <Input
            id={endId}
            type="date"
            value={toValue}
            onChange={handleToChange}
            min={fromValue || undefined}
            disabled={disabled}
            className={cn('text-foreground', className)}
          />
        </label>
      </div>

      {(bookedLabels.length > 0 || hasSelection) && (
        <div className="flex items-start justify-between gap-2">
          {bookedLabels.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('dateRangePicker.alreadyBooked', 'Already assigned: {{ranges}}', {
                ranges: bookedLabels.join(', '),
              })}
            </p>
          ) : (
            <div />
          )}
          {hasSelection && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClear}
              disabled={disabled}
              className="h-9 shrink-0 px-2 text-xs md:h-7"
              aria-label={t('dateRangePicker.clear', 'Clear selection')}
            >
              <X className="h-3 w-3 mr-1" aria-hidden="true" />
              {t('dateRangePicker.clear', 'Clear')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
});

export { DateRangePicker };
export type { DateRangePickerProps, DateRange, BookedRange };
