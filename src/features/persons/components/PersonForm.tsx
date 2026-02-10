/**
 * @fileoverview Person Form Component for creating and editing persons.
 * Provides form validation, controlled inputs with ColorPicker integration,
 * and handles submission with loading states.
 *
 * @module features/persons/components/PersonForm
 * @see RoomForm.tsx for reference implementation pattern
 */

import {
  type ChangeEvent,
  type FormEvent,
  memo,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useFormSubmission } from '@/hooks';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ColorPicker, DEFAULT_COLORS } from '@/components/shared/ColorPicker';
import { DateRangePicker, type DateRange } from '@/components/shared/DateRangePicker';
import { useTripContext } from '@/contexts/TripContext';
import { parseISO, format } from 'date-fns';
import { toHexColor, toISODateStringFromString } from '@/lib/db/utils';
import type { Person, PersonFormData } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the PersonForm component.
 */
interface PersonFormProps {
  /** Existing person for edit mode. If undefined, form is in create mode. */
  readonly person?: Person;
  /** Callback when form is successfully submitted with validated data. */
  readonly onSubmit: (data: PersonFormData) => Promise<void>;
  /** Callback when cancel button is clicked. */
  readonly onCancel: () => void;
}

/**
 * Form validation errors.
 */
interface FormErrors {
  name?: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default color for new persons (first color in palette).
 */
const DEFAULT_COLOR = DEFAULT_COLORS[0] ?? '#3b82f6';

// ============================================================================
// Component
// ============================================================================

/**
 * Person form component for creating and editing persons.
 *
 * Features:
 * - Controlled form inputs for name and color
 * - Validation on blur (name) and submit (all fields)
 * - Edit mode pre-fills existing person data
 * - Loading state during submission
 * - Error display for validation and submission errors
 * - Full accessibility support (ARIA attributes)
 *
 * @param props - Component props
 * @returns The person form element
 *
 * @example
 * ```tsx
 * // Create mode
 * <PersonForm
 *   onSubmit={async (data) => await createPerson(data)}
 *   onCancel={() => navigate(-1)}
 * />
 *
 * // Edit mode
 * <PersonForm
 *   person={existingPerson}
 *   onSubmit={async (data) => await updatePerson(person.id, data)}
 *   onCancel={() => navigate(-1)}
 * />
 * ```
 */
const PersonForm = memo(function PersonForm({
  person,
  onSubmit,
  onCancel,
}: PersonFormProps) {
  const { t } = useTranslation();
  const { currentTrip } = useTripContext();

  // ============================================================================
  // Form State
  // ============================================================================

  // Form field values
  const [name, setName] = useState(person?.name ?? '');
  // Color state is stored as string internally, converted to HexColor on submit
  const [color, setColor] = useState<string>(person?.color ?? DEFAULT_COLOR);
  const [stayDates, setStayDates] = useState<DateRange | undefined>(() => {
    if (person?.stayStartDate && person?.stayEndDate) {
      return {
        from: parseISO(person.stayStartDate),
        to: parseISO(person.stayEndDate),
      };
    }
    return undefined;
  });

  // Validation errors
  const [errors, setErrors] = useState<FormErrors>({});

  // ============================================================================
  // Lifecycle Effects
  // ============================================================================

  // Sync form state when person prop changes (for edit mode navigation)
  // Only depends on person.id to avoid resetting on every prop reference change
  useEffect(() => {
    setName(person?.name ?? '');
    setColor(person?.color ?? DEFAULT_COLOR);
    // Sync stay dates from person
    if (person?.stayStartDate && person?.stayEndDate) {
      setStayDates({
        from: parseISO(person.stayStartDate),
        to: parseISO(person.stayEndDate),
      });
    } else {
      setStayDates(undefined);
    }
    // Use callback to avoid creating new object if already empty
    setErrors((prev) => (Object.keys(prev).length === 0 ? prev : {}));
  }, [person?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- Only sync on person.id change

  // ============================================================================
  // Validation
  // ============================================================================

  /**
   * Validates the name field.
   */
  const validateName = useCallback(
    (value: string): string | undefined => {
      const trimmed = value.trim();
      if (!trimmed) {
        return t('common.required');
      }
      return undefined;
    },
    [t],
  );

  /**
   * Validates all form fields.
   * Returns true if valid, false otherwise.
   */
  const validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    // Validate name
    const nameError = validateName(name);
    if (nameError) {
      newErrors.name = nameError;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, validateName]);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles name input change.
   * Uses functional update to avoid dependency on error state.
   */
  const handleNameChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const {value} = e.target;
      setName(value);
      // Clear error when user starts typing (functional update avoids stale closure)
      setErrors((prev) => (prev.name ? { ...prev, name: undefined } : prev));
    },
    [],
  );

  /**
   * Handles name input blur for validation.
   */
  const handleNameBlur = useCallback(() => {
    const error = validateName(name);
    if (error) {
      setErrors((prev) => ({ ...prev, name: error }));
    }
  }, [name, validateName]);

  /**
   * Handles color selection from ColorPicker.
   */
  const handleColorChange = useCallback((newColor: string) => {
    setColor(newColor);
  }, []);

  /**
   * Handles stay date range selection.
   */
  const handleStayDatesChange = useCallback((range: DateRange | undefined) => {
    setStayDates(range);
  }, []);

  /**
   * Trip date constraints for the date picker.
   */
  const tripStartDate = currentTrip?.startDate ? parseISO(currentTrip.startDate) : undefined;
  const tripEndDate = currentTrip?.endDate ? parseISO(currentTrip.endDate) : undefined;

  /**
   * Submission handler via useFormSubmission hook.
   */
  const { isSubmitting, submitError, handleSubmit: doSubmit } = useFormSubmission<PersonFormData>(
    onSubmit,
  );

  /**
   * Handles form submission with validation and data building.
   */
  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();

      // Validate form
      if (!validateForm()) {return;}

      // Format dates and convert to branded types
      const formattedStartDate = stayDates?.from ? format(stayDates.from, 'yyyy-MM-dd') : undefined;
      const formattedEndDate = stayDates?.to ? format(stayDates.to, 'yyyy-MM-dd') : undefined;

      try {
        await doSubmit({
          name: name.trim(),
          color: toHexColor(color),
          stayStartDate: formattedStartDate ? toISODateStringFromString(formattedStartDate) : undefined,
          stayEndDate: formattedEndDate ? toISODateStringFromString(formattedEndDate) : undefined,
        });
      } catch {
        // Error handled by useFormSubmission hook (sets submitError)
      }
    },
    [validateForm, doSubmit, name, color, stayDates],
  );

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {/* Name Field */}
      <div className="space-y-2">
        <Label htmlFor="person-name">
          {t('persons.name')}
          <span className="text-destructive ml-1" aria-hidden="true">*</span>
        </Label>
        <Input
          id="person-name"
          type="text"
          value={name}
          onChange={handleNameChange}
          onBlur={handleNameBlur}
          placeholder={t('persons.namePlaceholder')}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? 'person-name-error' : undefined}
          disabled={isSubmitting}
          autoFocus
        />
        {errors.name && (
          <p
            id="person-name-error"
            className="text-sm text-destructive"
            role="alert"
          >
            {errors.name}
          </p>
        )}
      </div>

      {/* Color Field */}
      <div className="space-y-2">
        <Label>{t('persons.color')}</Label>
        <ColorPicker
          value={color}
          onChange={handleColorChange}
          disabled={isSubmitting}
          label={t('persons.color')}
        />
      </div>

      {/* Stay Dates Field (Optional) */}
      {currentTrip && (
        <div className="space-y-2">
          <Label>{t('persons.stayDates', 'Stay dates')} <span className="text-muted-foreground text-xs">({t('common.optional', 'optional')})</span></Label>
          <DateRangePicker
            value={stayDates}
            onChange={handleStayDatesChange}
            minDate={tripStartDate}
            maxDate={tripEndDate}
            placeholder={t('persons.stayDatesPlaceholder', 'Select arrival and departure dates')}
            disabled={isSubmitting}
          />
          <p className="text-xs text-muted-foreground">
            {t('persons.stayDatesHint', 'When will this guest be at the trip?')}
          </p>
        </div>
      )}

      {/* Submission Error */}
      {submitError && (
        <div
          className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {submitError}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          {t('common.cancel')}
        </Button>
        <Button
          type="submit"
          disabled={isSubmitting}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </form>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { PersonForm };
export type { PersonFormProps };
