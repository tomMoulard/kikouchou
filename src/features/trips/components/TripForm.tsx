/**
 * @fileoverview Trip Form Component for creating and editing trips.
 * Provides form validation, date pickers, and handles submission with loading states.
 *
 * @module features/trips/components/TripForm
 */

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ChangeEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { format, parseISO, isValid, isBefore, startOfDay, type Locale } from 'date-fns';
import { fr, enUS } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { Trip, TripFormData } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the TripForm component.
 */
interface TripFormProps {
  /** Existing trip for edit mode. If undefined, form is in create mode. */
  readonly trip?: Trip;
  /** Callback when form is successfully submitted with validated data. */
  readonly onSubmit: (data: TripFormData) => Promise<void>;
  /** Callback when cancel button is clicked. */
  readonly onCancel: () => void;
}

/**
 * Form validation errors.
 */
interface FormErrors {
  name?: string;
  startDate?: string;
  endDate?: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Date format for ISO string output (YYYY-MM-DD).
 */
const ISO_DATE_FORMAT = 'yyyy-MM-dd';

/**
 * Date format for display (localized).
 */
const DISPLAY_DATE_FORMAT = 'PPP';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Gets the date-fns locale based on i18n language.
 */
function getDateLocale(lang: string): Locale {
  return lang === 'fr' ? fr : enUS;
}

/**
 * Parses an ISO date string to a Date object.
 * Returns undefined if the string is empty or invalid.
 */
function parseDate(dateString: string | undefined): Date | undefined {
  if (!dateString) return undefined;
  const date = parseISO(dateString);
  return isValid(date) ? date : undefined;
}

/**
 * Formats a Date object to ISO date string (YYYY-MM-DD).
 */
function formatToISO(date: Date | undefined): string {
  if (!date) return '';
  return format(date, ISO_DATE_FORMAT);
}

// ============================================================================
// Component
// ============================================================================

/**
 * Trip form component for creating and editing trips.
 *
 * Features:
 * - Controlled form inputs for name, location, start date, end date
 * - Date pickers using shadcn/ui Calendar + Popover
 * - Validation on blur and submit
 * - Edit mode pre-fills existing trip data
 * - Loading state during submission
 * - Error display for validation and submission errors
 *
 * @param props - Component props
 * @returns The trip form element
 *
 * @example
 * ```tsx
 * // Create mode
 * <TripForm
 *   onSubmit={async (data) => await createTrip(data)}
 *   onCancel={() => navigate(-1)}
 * />
 *
 * // Edit mode
 * <TripForm
 *   trip={existingTrip}
 *   onSubmit={async (data) => await updateTrip(trip.id, data)}
 *   onCancel={() => navigate(-1)}
 * />
 * ```
 */
const TripForm = memo(function TripForm({
  trip,
  onSubmit,
  onCancel,
}: TripFormProps) {
  const { t, i18n } = useTranslation();
  const locale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);

  // ============================================================================
  // Form State
  // ============================================================================

  // Initialize form values from trip prop (edit mode) or empty (create mode)
  const initialValues = useMemo(
    () => ({
      name: trip?.name ?? '',
      location: trip?.location ?? '',
      startDate: trip?.startDate ?? '',
      endDate: trip?.endDate ?? '',
    }),
    [trip],
  );

  const [name, setName] = useState(initialValues.name);
  const [location, setLocation] = useState(initialValues.location);
  const [startDate, setStartDate] = useState(initialValues.startDate);
  const [endDate, setEndDate] = useState(initialValues.endDate);

  // Validation errors
  const [errors, setErrors] = useState<FormErrors>({});

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Refs for preventing race conditions and memory leaks
  const isSubmittingRef = useRef(false);
  const isMountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Sync form state when trip prop changes (for edit mode navigation)
  useEffect(() => {
    setName(trip?.name ?? '');
    setLocation(trip?.location ?? '');
    setStartDate(trip?.startDate ?? '');
    setEndDate(trip?.endDate ?? '');
    setErrors({});
    setSubmitError(null);
  }, [trip?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- Only sync on trip.id change

  // Date picker popover state
  const [isStartDateOpen, setIsStartDateOpen] = useState(false);
  const [isEndDateOpen, setIsEndDateOpen] = useState(false);

  // Parse dates for Calendar component
  const startDateValue = useMemo(() => parseDate(startDate), [startDate]);
  const endDateValue = useMemo(() => parseDate(endDate), [endDate]);

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
   * Validates the end date against start date.
   */
  const validateEndDate = useCallback(
    (start: string, end: string): string | undefined => {
      if (!start || !end) return undefined;

      const startParsed = parseDate(start);
      const endParsed = parseDate(end);

      if (!startParsed || !endParsed) return undefined;

      // End date must be on or after start date
      if (isBefore(startOfDay(endParsed), startOfDay(startParsed))) {
        return t('validation.endDateBeforeStart', 'End date must be on or after start date');
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

    // Validate start date is required
    if (!startDate) {
      newErrors.startDate = t('common.required');
    }

    // Validate end date is required
    if (!endDate) {
      newErrors.endDate = t('common.required');
    }

    // Validate end date >= start date
    const endDateError = validateEndDate(startDate, endDate);
    if (endDateError) {
      newErrors.endDate = endDateError;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, startDate, endDate, validateName, validateEndDate, t]);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles name input change.
   * Uses functional update to avoid dependency on error state.
   */
  const handleNameChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
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
   * Handles location input change.
   */
  const handleLocationChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setLocation(e.target.value);
    },
    [],
  );

  /**
   * Handles start date selection.
   * Uses functional update to avoid dependency on error state.
   */
  const handleStartDateSelect = useCallback(
    (date: Date | undefined) => {
      const isoDate = formatToISO(date);
      setStartDate(isoDate);
      setIsStartDateOpen(false);

      // Clear start date error and validate end date
      setErrors((prev) => {
        const newErrors = { ...prev };
        // Clear start date error
        if (newErrors.startDate) {
          newErrors.startDate = undefined;
        }
        // Validate end date if already set
        if (endDate && date) {
          const endDateError = validateEndDate(isoDate, endDate);
          newErrors.endDate = endDateError;
        }
        return newErrors;
      });
    },
    [endDate, validateEndDate],
  );

  /**
   * Handles end date selection.
   * Uses functional update to avoid dependency on error state.
   */
  const handleEndDateSelect = useCallback(
    (date: Date | undefined) => {
      const isoDate = formatToISO(date);
      setEndDate(isoDate);
      setIsEndDateOpen(false);

      // Validate or clear end date error
      setErrors((prev) => {
        if (date && startDate) {
          const error = validateEndDate(startDate, isoDate);
          return { ...prev, endDate: error };
        } else if (prev.endDate && date) {
          return { ...prev, endDate: undefined };
        }
        return prev;
      });
    },
    [startDate, validateEndDate],
  );

  /**
   * Handles form submission.
   * Uses refs for synchronous guard (prevents race condition) and unmount safety.
   */
  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();

      // Prevent double submission using ref for synchronous check
      if (isSubmittingRef.current) return;

      // Validate form
      if (!validateForm()) return;

      isSubmittingRef.current = true;
      setIsSubmitting(true);
      setSubmitError(null);

      try {
        await onSubmit({
          name: name.trim(),
          location: location.trim() || undefined,
          startDate,
          endDate,
        });
        // Success - parent component handles navigation
      } catch (error) {
        console.error('Failed to save trip:', error);
        // Only update state if component is still mounted
        if (isMountedRef.current) {
          setSubmitError(t('errors.saveFailed'));
        }
      } finally {
        isSubmittingRef.current = false;
        // Only update state if component is still mounted
        if (isMountedRef.current) {
          setIsSubmitting(false);
        }
      }
    },
    [validateForm, onSubmit, name, location, startDate, endDate, t],
  );

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {/* Name Field */}
      <div className="space-y-2">
        <Label htmlFor="trip-name">
          {t('trips.name')}
          <span className="text-destructive ml-1" aria-hidden="true">*</span>
        </Label>
        <Input
          id="trip-name"
          type="text"
          value={name}
          onChange={handleNameChange}
          onBlur={handleNameBlur}
          placeholder={t('trips.namePlaceholder')}
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? 'trip-name-error' : undefined}
          disabled={isSubmitting}
          autoFocus
        />
        {errors.name && (
          <p
            id="trip-name-error"
            className="text-sm text-destructive"
            role="alert"
          >
            {errors.name}
          </p>
        )}
      </div>

      {/* Location Field */}
      <div className="space-y-2">
        <Label htmlFor="trip-location">{t('trips.location')}</Label>
        <Input
          id="trip-location"
          type="text"
          value={location}
          onChange={handleLocationChange}
          placeholder={t('trips.locationPlaceholder')}
          disabled={isSubmitting}
        />
      </div>

      {/* Date Fields - Side by side on larger screens */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Start Date Field */}
        <div className="space-y-2">
          <Label htmlFor="trip-start-date">
            {t('trips.startDate')}
            <span className="text-destructive ml-1" aria-hidden="true">*</span>
          </Label>
          <Popover open={isStartDateOpen} onOpenChange={setIsStartDateOpen}>
            <PopoverTrigger asChild>
              <Button
                id="trip-start-date"
                type="button"
                variant="outline"
                disabled={isSubmitting}
                aria-invalid={!!errors.startDate}
                aria-describedby={errors.startDate ? 'trip-start-date-error' : undefined}
                aria-expanded={isStartDateOpen}
                aria-haspopup="dialog"
                className={cn(
                  'w-full justify-start text-left font-normal',
                  !startDateValue && 'text-muted-foreground',
                  errors.startDate && 'border-destructive',
                )}
              >
                <CalendarIcon className="mr-2 size-4" aria-hidden="true" />
                {startDateValue ? (
                  format(startDateValue, DISPLAY_DATE_FORMAT, { locale })
                ) : (
                  <span>{t('trips.startDate')}</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={startDateValue}
                onSelect={handleStartDateSelect}
                initialFocus
              />
            </PopoverContent>
          </Popover>
          {errors.startDate && (
            <p
              id="trip-start-date-error"
              className="text-sm text-destructive"
              role="alert"
            >
              {errors.startDate}
            </p>
          )}
        </div>

        {/* End Date Field */}
        <div className="space-y-2">
          <Label htmlFor="trip-end-date">
            {t('trips.endDate')}
            <span className="text-destructive ml-1" aria-hidden="true">*</span>
          </Label>
          <Popover open={isEndDateOpen} onOpenChange={setIsEndDateOpen}>
            <PopoverTrigger asChild>
              <Button
                id="trip-end-date"
                type="button"
                variant="outline"
                disabled={isSubmitting}
                aria-invalid={!!errors.endDate}
                aria-describedby={errors.endDate ? 'trip-end-date-error' : undefined}
                aria-expanded={isEndDateOpen}
                aria-haspopup="dialog"
                className={cn(
                  'w-full justify-start text-left font-normal',
                  !endDateValue && 'text-muted-foreground',
                  errors.endDate && 'border-destructive',
                )}
              >
                <CalendarIcon className="mr-2 size-4" aria-hidden="true" />
                {endDateValue ? (
                  format(endDateValue, DISPLAY_DATE_FORMAT, { locale })
                ) : (
                  <span>{t('trips.endDate')}</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={endDateValue}
                onSelect={handleEndDateSelect}
                disabled={startDateValue ? { before: startDateValue } : undefined}
                initialFocus
              />
            </PopoverContent>
          </Popover>
          {errors.endDate && (
            <p
              id="trip-end-date-error"
              className="text-sm text-destructive"
              role="alert"
            >
              {errors.endDate}
            </p>
          )}
        </div>
      </div>

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

TripForm.displayName = 'TripForm';

// ============================================================================
// Exports
// ============================================================================

export { TripForm };
export type { TripFormProps };
