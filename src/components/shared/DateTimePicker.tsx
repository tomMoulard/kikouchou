/**
 * @fileoverview A date and time control made of the browser's own date and
 * time inputs.
 *
 * Native rather than a drawn calendar: a phone then opens its own picker, which
 * fits its screen, where a popover calendar did not. The browser shows the date
 * in its own locale, not the app's; that is the price of it. Two inputs rather
 * than one `datetime-local`, so a date picked on its own can default its time.
 *
 * The value is the `datetime-local` string (`YYYY-MM-DDTHH:mm`) the callers
 * already store.
 *
 * @module components/shared/DateTimePicker
 */

import { type ChangeEvent, type FocusEvent, memo, useCallback, useState } from 'react';

import { Input } from '@/components/ui/input';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the DateTimePicker component.
 */
interface DateTimePickerProps {
  /** Id of the date input. The time input gets `${id}-time`. */
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

// ============================================================================
// Component
// ============================================================================

/**
 * A date and time control: a native date input next to a time input.
 *
 * Features:
 * - Uses the device's own date and time pickers
 * - Picking a date with no time yet fills the time with midday
 * - Emits `''` while either half is missing, so callers validate as before
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

  const handleDateChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const nextDate = e.target.value;
      // A date on its own is unusable, so picking one settles the time too.
      const nextTime = nextDate && !time ? DEFAULT_TIME : time;
      setDate(nextDate);
      setTime(nextTime);
      emit(nextDate, nextTime);
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
   * Moving between the date input and the time input is not leaving it.
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

  return (
    <div className="flex flex-col gap-2 sm:flex-row" onBlur={handleBlur}>
      <Input
        id={id}
        type="date"
        value={date}
        onChange={handleDateChange}
        aria-label={dateLabel}
        aria-invalid={hasError}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        className="w-full sm:flex-1"
      />

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
