/**
 * @fileoverview Trip Form Component for editing an existing trip.
 * Provides form validation, date pickers, and handles submission with loading states.
 *
 * New trips are created through `TripCreateWizard`. This form used to have a
 * create mode too, with a guest list, a room list, a description and a cover
 * photo. It was removed on 2026-11-27, when every new trip moved to the
 * wizard.
 *
 * @module features/trips/components/TripForm
 */

import {
  type ChangeEvent,
  type FormEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useFormSubmission } from '@/hooks';
import { isBefore, isValid, parseISO, startOfDay } from 'date-fns';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MAX_LENGTHS } from '@/lib/db/sanitize';
import { toISODateStringFromString } from '@/lib/db/utils';
import type { Coordinates } from '@/lib/geocoding';
import {
  LocationAutocomplete,
  type TripImportData,
} from '@/features/trips/components/LocationAutocomplete';
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES } from '@/types';
import type { Trip, TripFormData } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum characters for a trip name — the repository's own limit, not a
 * second opinion about it.
 *
 * `sanitizeTripData` has always clipped the name to this on save, and the field
 * let you type past it and said nothing: the trip came back renamed, with no
 * indication of why.
 */
const NAME_MAX_LENGTH = MAX_LENGTHS.tripName;

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the TripForm component.
 */
interface TripFormProps {
  /** The trip being edited. */
  readonly trip: Trip;
  /** Callback when form is successfully submitted with validated data. */
  readonly onSubmit: (data: TripFormData) => Promise<void>;
  /** Callback when cancel button is clicked. */
  readonly onCancel: () => void;
  /** Callback when form dirty state changes (for unsaved changes guard). */
  readonly onDirtyChange?: (isDirty: boolean) => void;
  /**
   * The field to put the cursor in when the form opens. `name` by default;
   * `dates` scrolls to the start date and focuses it, for the calendar
   * checklist's "Set the dates".
   */
  readonly focusField?: 'name' | 'dates';
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
// Utility Functions
// ============================================================================

/**
 * Parses an ISO date string to a Date object.
 * Returns undefined if the string is empty or invalid.
 */
function parseDate(dateString: string | undefined): Date | undefined {
  if (!dateString) {return undefined;}
  const date = parseISO(dateString);
  return isValid(date) ? date : undefined;
}

/**
 * Compares two optional coordinate pairs by value.
 *
 * The picker hands back a fresh object every time the marker moves, so
 * reference equality would report every render as a change.
 */
function isSameCoordinates(
  a: Coordinates | undefined,
  b: Coordinates | undefined,
): boolean {
  if (!a || !b) {return a === b;}
  return a.lat === b.lat && a.lon === b.lon;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Trip form component for editing a trip.
 *
 * Features:
 * - Controlled form inputs for name, location, start date, end date
 * - Native date inputs, so a phone opens its own date picker
 * - Validation on blur and submit
 * - Pre-fills the trip's current data
 * - Loading state during submission
 * - Error display for validation and submission errors
 *
 * @param props - Component props
 * @returns The trip form element
 *
 * @example
 * ```tsx
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
  onDirtyChange,
  focusField = 'name',
}: TripFormProps) {
  const { t } = useTranslation();

  // "Set the dates" from the calendar checklist lands here: the cursor goes
  // in the start date, not in the name, and the field is scrolled into view.
  const startDateRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusField !== 'dates') {
      return;
    }
    const field = startDateRef.current;
    field?.scrollIntoView?.({ block: 'center' });
    field?.focus({ preventScroll: true });
  }, [focusField]);

  // ============================================================================
  // Form State
  // ============================================================================

  // Initialize form values from the trip being edited
  const initialValues = useMemo(
    () => ({
      name: trip.name,
      location: trip.location ?? '',
      startDate: trip.startDate ?? '',
      endDate: trip.endDate ?? '',
      coordinates: trip.coordinates,
      currency: trip.currency ?? DEFAULT_CURRENCY,
    }),
    [trip],
  );

  const [name, setName] = useState(initialValues.name);
  const [location, setLocation] = useState(initialValues.location);
  // Date state is stored as string internally, converted to ISODateString on submit
  const [startDate, setStartDate] = useState<string>(initialValues.startDate);
  const [endDate, setEndDate] = useState<string>(initialValues.endDate);
  const [coordinates, setCoordinates] = useState<Coordinates | undefined>(
    initialValues.coordinates,
  );
  const [currency, setCurrency] = useState(initialValues.currency);

  // Compute dirty state: any field differs from initial values. Coordinates
  // count: nudging the map pin is the only edit some trips need, and without
  // this the unsaved-changes guard would let it be navigated away silently.
  // The description is not here: its own card saves it, so a change arriving
  // from there must not read as an unsaved form.
  const isDirty = useMemo(
    () =>
      name !== initialValues.name ||
      location !== initialValues.location ||
      startDate !== initialValues.startDate ||
      endDate !== initialValues.endDate ||
      currency !== initialValues.currency ||
      !isSameCoordinates(coordinates, initialValues.coordinates),
    [name, location, startDate, endDate, currency, coordinates, initialValues],
  );

  // Notify parent of dirty state changes
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // Validation errors
  const [errors, setErrors] = useState<FormErrors>({});

  // Sync form state when trip prop changes (for edit mode navigation)
  // Uses ref-based approach to avoid setState-in-effect lint warning
  const prevTripIdRef = useRef(trip.id);
  if (prevTripIdRef.current !== trip.id) {
    prevTripIdRef.current = trip.id;
    setName(trip.name);
    setLocation(trip.location ?? '');
    setStartDate(trip.startDate ?? '');
    setEndDate(trip.endDate ?? '');
    setCurrency(trip.currency ?? DEFAULT_CURRENCY);
    setCoordinates(trip.coordinates);
    setErrors({});
  }

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
      if (!start || !end) {return undefined;}

      const startParsed = parseDate(start);
      const endParsed = parseDate(end);

      if (!startParsed || !endParsed) {return undefined;}

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

    // The dates are optional: a trip is created without them and the
    // organiser sets them later. They go together, though: one date alone is
    // not a window any screen can read.
    const datesTogether = t('trips.datesTogether', 'Set both dates, or leave both empty');
    if (!startDate && endDate) {
      newErrors.startDate = datesTogether;
    }
    if (startDate && !endDate) {
      newErrors.endDate = datesTogether;
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
   * Handles location changes from the autocomplete component.
   *
   * Coordinates always travel with the name: free text arrives with none, a
   * place confirmed on the map arrives with its pin.
   */
  const handleLocationChange = useCallback(
    (value: string, nextCoordinates?: Coordinates) => {
      setLocation(value);
      setCoordinates(nextCoordinates);
    },
    [],
  );

  /**
   * Handles picking a previously used trip in the location suggestions.
   * Pre-fills the location and its coordinates, and nothing else.
   *
   * No "importing from" badge: this form edits a trip that exists, and the
   * rooms of the picked trip are not copied into it. The badge said they
   * would be, and the trip got no rooms.
   */
  const handleImportTrip = useCallback((data: TripImportData) => {
    const { trip: sourceTrip } = data;

    // Pre-fill location, and its pin alongside it — adopting the name while
    // keeping an older trip's coordinates would pin the new trip elsewhere.
    if (sourceTrip.location) {
      setLocation(sourceTrip.location);
      setCoordinates(sourceTrip.coordinates);
    }
  }, []);

  /**
   * Handles start date selection.
   * Uses functional update to avoid dependency on error state.
   */
  const handleStartDateChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const isoDate = e.target.value;
      setStartDate(isoDate);

      /*
        A start date that has moved past the end date leaves the form holding a
        range the end input itself cannot produce — its `min` is the start —
        and the only thing the form did about it was report
        an error and refuse to submit.

        Drop the stale end date instead. The end picker now opens on the new
        start (below), so a valid range is one pick away, and the invalid
        one stops being reachable at all rather than being reachable and
        rejected. `validateEndDate` stays as the backstop for the orders this
        cannot cover: a trip that arrived already inverted, from an import or a
        peer.
      */
      const endDateOvertaken =
        endDate !== '' && validateEndDate(isoDate, endDate) !== undefined;
      if (endDateOvertaken) {
        setEndDate('');
      }

      setErrors((prev) => {
        const newErrors: FormErrors = { ...prev, startDate: undefined };
        if (endDateOvertaken) {
          // Nothing left to complain about: the date complained of is gone.
          newErrors.endDate = undefined;
        } else if (endDate) {
          newErrors.endDate = validateEndDate(isoDate, endDate);
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
  const handleEndDateChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const isoDate = e.target.value;
      setEndDate(isoDate);

      // Validate or clear end date error
      setErrors((prev) => {
        if (isoDate && startDate) {
          const error = validateEndDate(startDate, isoDate);
          return { ...prev, endDate: error };
        } else if (prev.endDate && isoDate) {
          return { ...prev, endDate: undefined };
        }
        return prev;
      });
    },
    [startDate, validateEndDate],
  );

  /**
   * Empties both dates, which saves the trip as one without dates.
   */
  const handleClearDates = useCallback(() => {
    setStartDate('');
    setEndDate('');
    setErrors((prev) => ({ ...prev, startDate: undefined, endDate: undefined }));
  }, []);

  /**
   * Submission handler via useFormSubmission hook.
   */
  const { isSubmitting, submitError, handleSubmit: doSubmit } = useFormSubmission<TripFormData>(
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

      try {
        await doSubmit({
          name: name.trim(),
          location: location.trim() || undefined,
          // Absent when the dates are empty: a trip without dates.
          ...(startDate && endDate
            ? {
                startDate: toISODateStringFromString(startDate),
                endDate: toISODateStringFromString(endDate),
              }
            : {}),
          // No description: it has its own card and its own save, and sending
          // a value loaded here would overwrite whatever that card saved since.
          coordinates,
          currency,
        });
      } catch {
        // Error handled by useFormSubmission hook (sets submitError)
      }
    },
    [
      validateForm,
      doSubmit,
      name,
      location,
      startDate,
      endDate,
      coordinates,
      currency,
    ],
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
          maxLength={NAME_MAX_LENGTH}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? 'trip-name-error' : undefined}
          disabled={isSubmitting}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- The first control of a form the user has just chosen to open. Without it focus stays on the trigger — or, in a dialog, on the close button — and the user tabs to reach the field they came for.
          autoFocus={focusField === 'name'}
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

      {/* Location Field with Import Suggestions */}
      <div className="space-y-2">
        <Label htmlFor="trip-location">{t('trips.location')}</Label>
        <LocationAutocomplete
          id="trip-location"
          value={location}
          coordinates={coordinates}
          onChange={handleLocationChange}
          onImportTrip={handleImportTrip}
          placeholder={t('trips.locationPlaceholder')}
          disabled={isSubmitting}
          excludeTripId={trip.id}
        />
      </div>

      {/* Currency — what the money page labels every amount with. One per
          trip: a group renting one house pays for everything in one currency,
          and asking per receipt would be a question with one answer. */}
      <div className="space-y-2">
        <Label htmlFor="trip-currency">{t('trips.currency')}</Label>
        <Select value={currency} onValueChange={setCurrency} disabled={isSubmitting}>
          <SelectTrigger id="trip-currency" className="w-full sm:w-48">
            <SelectValue placeholder={t('trips.currency')} />
          </SelectTrigger>
          <SelectContent>
            {SUPPORTED_CURRENCIES.map((code) => (
              <SelectItem key={code} value={code}>
                {t(`trips.currencies.${code}`, { defaultValue: code })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t('trips.currencyHint')}</p>
      </div>

      {/* Date Fields. Optional, and "Clear dates" turns the trip back into one
          without dates. */}
      <div className="space-y-2">
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Start Date Field */}
        <div className="space-y-2">
          <Label htmlFor="trip-start-date">
            {t('trips.startDate')}
            <span className="text-muted-foreground ml-1 text-xs font-normal">
              ({t('common.optional', 'optional')})
            </span>
          </Label>
          <Input
            ref={startDateRef}
            id="trip-start-date"
            type="date"
            value={startDate}
            onChange={handleStartDateChange}
            disabled={isSubmitting}
            aria-invalid={Boolean(errors.startDate)}
            aria-describedby={errors.startDate ? 'trip-start-date-error' : undefined}
          />
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
            <span className="text-muted-foreground ml-1 text-xs font-normal">
              ({t('common.optional', 'optional')})
            </span>
          </Label>
          <Input
            id="trip-end-date"
            type="date"
            value={endDate}
            onChange={handleEndDateChange}
            min={startDate || undefined}
            disabled={isSubmitting}
            aria-invalid={Boolean(errors.endDate)}
            aria-describedby={errors.endDate ? 'trip-end-date-error' : undefined}
          />
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
      {(startDate || endDate) && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleClearDates}
          disabled={isSubmitting}
        >
          {t('trips.clearDates', 'Clear dates')}
        </Button>
      )}
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

// ============================================================================
// Exports
// ============================================================================

export { TripForm };
export type { TripFormProps };
