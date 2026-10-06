/**
 * @fileoverview A date and time control built from the same calendar the rest
 * of the app uses.
 *
 * A bare `datetime-local` input renders in the browser's locale, not the app's,
 * so an English interface showed `dd/mm/yyyy, --:--` to anyone whose browser was
 * set to French. It also has no month view worth the name on desktop. This pairs
 * the shadcn `Calendar` in a `Popover` — what `TripForm` and `DateRangePicker`
 * already show — with a plain `time` input, which is the one part of the native
 * control that behaves.
 *
 * The value is the `datetime-local` string (`YYYY-MM-DDTHH:mm`) the callers
 * already store, so it is a drop-in for the input it replaces.
 *
 * @module components/shared/DateTimePicker
 */

import { type ChangeEvent, type FocusEvent, memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format, isValid, parseISO } from 'date-fns';
import { CalendarIcon } from 'lucide-react';

import { getDateLocale } from '@/lib/i18n/date-locale';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the DateTimePicker component.
 */
interface DateTimePickerProps {
  /** Id of the date trigger. The time input gets `${id}-time`. */
  readonly id: string;
  /** Current value in `datetime-local` format, or `''` when unset. */
  readonly value: string;
  /** Called with the new `datetime-local` value, or `''` when incomplete. */
  readonly onChange: (value: string) => void;
  /** Called when focus leaves the whole control. */
  readonly onBlur?: () => void;
  /** Whether both fields are disabled. */
  readonly disabled?: boolean;
  /** Whether the fields carry a validation error. */
  readonly hasError?: boolean;
  /** Id of the element describing the error. */
  readonly 'aria-describedby'?: string;
  /** Accessible name for the date field. */
  readonly dateLabel: string;
  /** Accessible name for the time field. */
  readonly timeLabel: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Localized long date, the same one the trip form shows. */
const DISPLAY_DATE_FORMAT = 'PPP';

/**
 * Time given to a date picked on its own.
 *
 * Midday rather than midnight: a transport at 00:00 reads as "no time given"
 * and lands on the wrong side of a day boundary in every timezone east of the
 * viewer.
 */
const DEFAULT_TIME = '12:00';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Joins a date part and a time part back into a `datetime-local` value.
 *
 * @param date - `YYYY-MM-DD`, or `''`
 * @param time - `HH:mm`, or `''`
 * @returns The combined value, or `''` when either half is missing
 */
function combine(date: string, time: string): string {
  if (!date || !time) {
    return '';
  }
  return `${date}T${time}`;
}

/**
 * Reads the calendar day out of a `datetime-local` value.
 */
function datePart(value: string): string {
  return value.slice(0, 10);
}

/**
 * Reads the wall clock out of a `datetime-local` value.
 */
function timePart(value: string): string {
  return value.slice(11, 16);
}

/**
 * Parses the date half of the value into a `Date` for the calendar.
 *
 * @param date - `YYYY-MM-DD`, or `''`
 * @returns The parsed date, or undefined when absent or unparseable
 */
function parseDatePart(date: string): Date | undefined {
  if (!date) {
    return undefined;
  }
  const parsed = parseISO(date);
  return isValid(parsed) ? parsed : undefined;
}

// ============================================================================
// Component
// ============================================================================

/**
 * A date and time control: a calendar popover next to a time input.
 *
 * Features:
 * - Shows the date in the app's language, not the browser's
 * - Picking a date with no time yet fills the time with midday
 * - Emits `''` while either half is missing, so callers validate as before
 * - Opens the calendar on the selected month rather than on today
 *
 * @param props - Component props
 * @returns The date and time control
 *
 * @example
 * ```tsx
 * <DateTimePicker
 *   id="transport-datetime"
 *   value={datetime}
 *   onChange={setDatetime}
 *   dateLabel={t('common.date')}
 *   timeLabel={t('common.time')}
 * />
 * ```
 */
const DateTimePicker = memo(function DateTimePicker({
  id,
  value,
  onChange,
  onBlur,
  disabled = false,
  hasError = false,
  'aria-describedby': ariaDescribedBy,
  dateLabel,
  timeLabel,
}: DateTimePickerProps) {
  const { t, i18n } = useTranslation();
  const locale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);

  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  // The two halves are held apart so a half-filled control keeps what the user
  // typed. `value` is `''` until both are set, and echoing that back into the
  // fields would wipe the half they just filled.
  const [date, setDate] = useState(() => datePart(value));
  const [time, setTime] = useState(() => timePart(value));

  // Adjusting state during render rather than in an effect, the pattern React
  // documents for state derived from a prop: a new `value` that is not the one
  // these two fields already spell out came from the caller — a prefill, or an
  // edit-mode reset — and has to land in them.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    if (value !== combine(date, time)) {
      setDate(datePart(value));
      setTime(timePart(value));
    }
  }

  const emit = useCallback(
    (nextDate: string, nextTime: string) => {
      onChange(combine(nextDate, nextTime));
    },
    [onChange],
  );

  const handleDateSelect = useCallback(
    (selected: Date | undefined) => {
      const nextDate = selected ? format(selected, 'yyyy-MM-dd') : '';
      // A date on its own is unusable, so picking one settles the time too.
      const nextTime = nextDate && !time ? DEFAULT_TIME : time;
      setDate(nextDate);
      setTime(nextTime);
      emit(nextDate, nextTime);
      setIsCalendarOpen(false);
    },
    [emit, time],
  );

  const handleTimeChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const nextTime = e.target.value;
      setTime(nextTime);
      emit(date, nextTime);
    },
    [date, emit],
  );

  /**
   * Reports the blur once for the control, not once per field.
   * Moving between the date button and the time input is not leaving it.
   */
  const handleBlur = useCallback(
    (e: FocusEvent<HTMLDivElement>) => {
      if (e.currentTarget.contains(e.relatedTarget)) {
        return;
      }
      onBlur?.();
    },
    [onBlur],
  );

  const selectedDate = useMemo(() => parseDatePart(date), [date]);

  return (
    <div className="flex flex-col gap-2 sm:flex-row" onBlur={handleBlur}>
      <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={dateLabel}
            aria-invalid={hasError}
            aria-describedby={ariaDescribedBy}
            aria-expanded={isCalendarOpen}
            aria-haspopup="dialog"
            className={cn(
              'w-full justify-start text-left font-normal sm:flex-1',
              !selectedDate && 'text-muted-foreground',
              hasError && 'border-destructive',
            )}
          >
            <CalendarIcon className="mr-2 size-4" aria-hidden="true" />
            {selectedDate
              ? format(selectedDate, DISPLAY_DATE_FORMAT, { locale })
              : t('common.pickDate', 'Pick a date')}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleDateSelect}
            // Without this the calendar opens on today, so any date outside
            // this month starts with paging back to it.
            defaultMonth={selectedDate}
            locale={locale}
            initialFocus
          />
        </PopoverContent>
      </Popover>

      <Input
        id={`${id}-time`}
        type="time"
        value={time}
        onChange={handleTimeChange}
        aria-label={timeLabel}
        aria-invalid={hasError}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        className="w-full sm:w-32"
      />
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { DateTimePicker };
export type { DateTimePickerProps };
