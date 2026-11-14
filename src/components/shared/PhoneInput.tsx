/**
 * @fileoverview The phone number field every form in the app uses.
 *
 * One field, so a number is checked and laid out the same way wherever it is
 * typed: the guest form, a guest group's members. Leaving the field refuses
 * what no phone could dial (`lib/phone`), with the reason under the field, and
 * lays out a number it recognises the way its country writes it
 * ("0612345678" -> "06 12 34 56 78").
 *
 * The form still owns the value and the error, because only the form knows
 * when it is being saved: it checks again then with `phoneErrorMessage`
 * and lays the number out with `usePhoneCountries`, for a number that
 * never left the field (picked from the contacts, or saved with Enter).
 *
 * @module components/shared/PhoneInput
 */

import { type ComponentProps, type FocusEvent, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/input';

import { usePhoneCountries } from '@/hooks/usePhoneCountries';

import { MAX_LENGTHS } from '@/lib/db/sanitize';
import { formatPhone, phoneErrorMessage } from '@/lib/phone';

// ============================================================================
// Type Definitions
// ============================================================================

/** Props for {@link PhoneInput}. */
export interface PhoneInputProps
  extends Omit<
    ComponentProps<typeof Input>,
    'type' | 'inputMode' | 'value' | 'onChange' | 'maxLength' | 'aria-invalid'
  > {
  /** The field's id; the error message takes `${id}-error`. */
  readonly id: string;
  /** The number as typed. */
  readonly value: string;
  /** Receives the number as typed, and as laid out when the field is left. */
  readonly onValueChange: (value: string) => void;
  /** The error to show under the field, if any. */
  readonly error?: string | undefined;
  /** Receives the error found when the field is left, and `undefined` on a new keystroke. */
  readonly onErrorChange: (error: string | undefined) => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * A phone number field: checked and laid out when it is left.
 *
 * @param props - See {@link PhoneInputProps}
 * @returns The field, and its error under it
 */
export const PhoneInput = memo(function PhoneInput({
  id,
  value,
  onValueChange,
  error,
  onErrorChange,
  onBlur,
  'aria-describedby': describedBy,
  placeholder,
  ...props
}: PhoneInputProps) {
  const { t } = useTranslation();
  const countries = usePhoneCountries();
  const errorId = `${id}-error`;

  const handleBlur = useCallback(
    (event: FocusEvent<HTMLInputElement>) => {
      onBlur?.(event);
      const found = phoneErrorMessage(t, value);
      if (found) {
        onErrorChange(found);
        return;
      }
      const formatted = formatPhone(value, countries);
      if (formatted !== value) {
        onValueChange(formatted);
      }
    },
    [countries, onBlur, onErrorChange, onValueChange, t, value],
  );

  return (
    <>
      <Input
        {...props}
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete={props.autoComplete ?? 'tel'}
        maxLength={MAX_LENGTHS.personPhone}
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value);
          if (error) {
            onErrorChange(undefined);
          }
        }}
        onBlur={handleBlur}
        placeholder={placeholder ?? t('persons.phonePlaceholder', '+33 6 12 34 56 78')}
        aria-invalid={Boolean(error)}
        aria-describedby={[error ? errorId : undefined, describedBy].filter(Boolean).join(' ') || undefined}
      />
      {error && (
        <p id={errorId} className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </>
  );
});
