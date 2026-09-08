/**
 * @fileoverview Transport Form Component for creating and editing transports.
 * Provides form validation, controlled inputs, and handles submission with loading states.
 *
 * @module features/transports/components/TransportForm
 * @see RoomForm.tsx for reference implementation pattern
 */

import {
  type ChangeEvent,
  type FormEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useFormSubmission } from '@/hooks';

import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { DateTimePicker } from '@/components/shared/DateTimePicker';
import { LocationPicker, type Coordinates } from '@/components/shared/LocationPicker';
import {
  formatDatetimeLocal,
  toISODatetime,
} from '@/features/transports/utils/datetime-input';
import type {
  Person,
  PersonId,
  Transport,
  TransportFormData,
  TransportMode,
  TransportType,
} from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the TransportForm component.
 */
interface TransportFormProps {
  /** Existing transport for edit mode. If undefined, form is in create mode. */
  readonly transport?: Transport;
  /** List of persons for the person and driver select dropdowns. */
  readonly persons: readonly Person[];
  /** Default transport type for create mode (from URL param). */
  readonly defaultType?: TransportType;
  /** First day of the trip (`YYYY-MM-DD`), used to prefill an arrival. */
  readonly tripStartDate?: string;
  /** Last day of the trip (`YYYY-MM-DD`), used to prefill a departure. */
  readonly tripEndDate?: string;
  /** Callback when form is successfully submitted with validated data. */
  readonly onSubmit: (data: TransportFormData) => Promise<void>;
  /** Callback when cancel button is clicked. */
  readonly onCancel: () => void;
  /** Callback when form dirty state changes (for unsaved changes guard). */
  readonly onDirtyChange?: (isDirty: boolean) => void;
}

/**
 * Form validation errors.
 */
interface FormErrors {
  personId?: string;
  type?: string;
  datetime?: string;
  location?: string;
}

/**
 * Internal form state that uses strings for optional fields to avoid uncontrolled warnings.
 */
interface FormState {
  personId: PersonId | '';
  type: TransportType;
  datetime: string;
  startLocation: string;
  startCoordinates: Coordinates | undefined;
  location: string;
  coordinates: Coordinates | undefined;
  transportMode: TransportMode | '';
  transportNumber: string;
  driverId: PersonId | '';
  notes: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Available transport modes.
 */
const TRANSPORT_MODES: TransportMode[] = ['train', 'plane', 'car', 'bus', 'other'];

/**
 * Special value for "no selection" in select dropdowns.
 */
const NO_SELECTION = '__none__';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Builds a safe datetime-local value from an ISO date string.
 * Uses midday to avoid DST gaps around night/morning hours.
 */
function toLocalDatetimeMidday(date: string | undefined): string {
  if (!date) {
    return '';
  }
  // Expect YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return '';
  }
  return `${date}T12:00`;
}

/**
 * Creates initial form state from a transport or defaults.
 *
 * The datetime of a new transport starts on the day the trip itself starts or
 * ends, whichever matches the type. The dialog knows the trip, so an empty
 * field asking the user to find that date again was work the form could do.
 *
 * @param transport - Existing transport for edit mode
 * @param defaultType - Default type for create mode
 * @param tripStartDate - First day of the trip (`YYYY-MM-DD`)
 * @param tripEndDate - Last day of the trip (`YYYY-MM-DD`)
 * @returns Initial form state
 */
function getInitialFormState(
  transport?: Transport,
  defaultType?: TransportType,
  tripStartDate?: string,
  tripEndDate?: string,
): FormState {
  const type = transport?.type ?? defaultType ?? 'arrival';
  return {
    personId: transport?.personId ?? '',
    type,
    datetime: transport?.datetime
      ? formatDatetimeLocal(transport.datetime)
      : toLocalDatetimeMidday(type === 'arrival' ? tripStartDate : tripEndDate),
    startLocation: transport?.startLocation ?? '',
    startCoordinates: transport?.startCoordinates,
    location: transport?.location ?? '',
    coordinates: transport?.coordinates,
    transportMode: transport?.transportMode ?? '',
    transportNumber: transport?.transportNumber ?? '',
    driverId: transport?.driverId ?? '',
    notes: transport?.notes ?? '',
  };
}

/**
 * Validates a datetime string.
 *
 * @param datetime - ISO datetime string to validate
 * @returns true if valid
 */
function isValidDatetime(datetime: string): boolean {
  if (!datetime) {return false;}
  try {
    const date = new Date(datetime);
    return !isNaN(date.getTime());
  } catch {
    return false;
  }
}

// ============================================================================
// Component
// ============================================================================

/**
 * Transport form component for creating and editing transports.
 *
 * Features:
 * - Controlled form inputs for all transport fields
 * - Type selection via radio buttons (arrival/departure)
 * - Person and driver selection via dropdowns
 * - Date and time selection via datetime-local input
 * - Transport mode selection
 * - Needs pickup toggle via switch
 * - Validation on blur and submit
 * - Edit mode pre-fills existing transport data
 * - Loading state during submission
 * - Error display for validation and submission errors
 * - Full accessibility support (ARIA attributes)
 *
 * @param props - Component props
 * @returns The transport form element
 *
 * @example
 * ```tsx
 * // Create mode
 * <TransportForm
 *   persons={persons}
 *   defaultType="arrival"
 *   onSubmit={async (data) => await createTransport(data)}
 *   onCancel={() => navigate(-1)}
 * />
 *
 * // Edit mode
 * <TransportForm
 *   transport={existingTransport}
 *   persons={persons}
 *   onSubmit={async (data) => await updateTransport(transport.id, data)}
 *   onCancel={() => navigate(-1)}
 * />
 * ```
 */
const TransportForm = memo(function TransportForm({
  transport,
  persons,
  defaultType,
  tripStartDate,
  tripEndDate,
  onSubmit,
  onCancel,
  onDirtyChange,
}: TransportFormProps) {
  const { t } = useTranslation();

  // ============================================================================
  // Form State
  // ============================================================================

  // Form field values
  const [formState, setFormState] = useState<FormState>(() =>
    getInitialFormState(transport, defaultType, tripStartDate, tripEndDate),
  );

  // Whether the user has set the datetime themselves. Until they have, the
  // form keeps moving it to whatever the chosen person and type imply.
  const [isDatetimeTouched, setIsDatetimeTouched] = useState(false);

  // Whether the optional "Details" section is expanded. Open from the start in
  // edit mode when it already holds something, so nothing hides behind a
  // heading the user has no reason to click.
  const [isDetailsOpen, setIsDetailsOpen] = useState(
    () =>
      Boolean(
        transport?.transportMode ??
          transport?.transportNumber ??
          transport?.driverId ??
          transport?.notes,
      ),
  );

  // Validation errors
  const [errors, setErrors] = useState<FormErrors>({});

  // Compute initial values for dirty comparison
  const initialFormState = useMemo(
    () => getInitialFormState(transport, defaultType, tripStartDate, tripEndDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only recompute on transport.id change
    [transport?.id, defaultType, tripStartDate, tripEndDate],
  );

  // Compute dirty state
  const isDirty = useMemo(
    () =>
      formState.personId !== initialFormState.personId ||
      formState.type !== initialFormState.type ||
      formState.datetime !== initialFormState.datetime ||
      formState.location !== initialFormState.location ||
      formState.startLocation !== initialFormState.startLocation ||
      formState.transportMode !== initialFormState.transportMode ||
      formState.transportNumber !== initialFormState.transportNumber ||
      formState.driverId !== initialFormState.driverId ||
      formState.notes !== initialFormState.notes ||
      formState.coordinates?.lat !== initialFormState.coordinates?.lat ||
      formState.coordinates?.lon !== initialFormState.coordinates?.lon ||
      formState.startCoordinates?.lat !== initialFormState.startCoordinates?.lat ||
      formState.startCoordinates?.lon !== initialFormState.startCoordinates?.lon,
    [formState, initialFormState],
  );

  // Notify parent of dirty state changes
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // Submission state (handled by useFormSubmission hook below)

  // ============================================================================
  // Derived State
  // ============================================================================

  /**
   * Filter driver options to exclude the currently selected person.
   */
  const driverOptions = useMemo(() => {
    if (!formState.personId) {return persons;}
    return persons.filter((p) => p.id !== formState.personId);
  }, [persons, formState.personId]);

  /**
   * Check if the selected person still exists.
   */
  const selectedPersonExists = useMemo(() => {
    if (!formState.personId) {return true;} // No selection is valid for showing placeholder
    return persons.some((p) => p.id === formState.personId);
  }, [persons, formState.personId]);

  // ============================================================================
  // Lifecycle Effects
  // ============================================================================

  // Sync form state when transport prop changes (for edit mode navigation)
  useEffect(() => {
    setFormState(getInitialFormState(transport, defaultType, tripStartDate, tripEndDate));
    setErrors({});
    setIsDatetimeTouched(false);
  }, [transport?.id, defaultType]); // eslint-disable-line react-hooks/exhaustive-deps -- Only sync on transport.id change

  /**
   * The day a new transport starts out on: the chosen person's own stay dates
   * when they have them, the trip's own dates otherwise, picked by type.
   */
  const suggestedDatetime = useMemo((): string => {
    const person = persons.find((p) => p.id === formState.personId);
    const personDate =
      formState.type === 'arrival' ? person?.stayStartDate : person?.stayEndDate;
    const tripDate = formState.type === 'arrival' ? tripStartDate : tripEndDate;
    return toLocalDatetimeMidday(personDate ?? tripDate);
  }, [formState.personId, formState.type, persons, tripStartDate, tripEndDate]);

  // Follow the suggestion while the user has not set a datetime of their own.
  // Switching Arrival to Departure moves the day with it; touching the control
  // once stops the form from moving it again.
  useEffect(() => {
    if (transport || isDatetimeTouched || !suggestedDatetime) {
      return;
    }
    setFormState((prev) =>
      prev.datetime === suggestedDatetime ? prev : { ...prev, datetime: suggestedDatetime },
    );
  }, [suggestedDatetime, isDatetimeTouched, transport]);

  // Clear driver if it matches the newly selected person
  useEffect(() => {
    if (formState.personId && formState.driverId === formState.personId) {
      setFormState((prev) => ({ ...prev, driverId: '' }));
    }
  }, [formState.personId, formState.driverId]);

  // ============================================================================
  // Validation
  // ============================================================================

  /**
   * Validates the personId field.
   */
  const validatePersonId = useCallback(
    (value: string): string | undefined => {
      if (!value) {
        return t('common.required');
      }
      // Check if person still exists
      if (!persons.some((p) => p.id === value)) {
        return t('errors.personNotFound');
      }
      return undefined;
    },
    [t, persons],
  );

  /**
   * Validates the datetime field.
   */
  const validateDatetime = useCallback(
    (value: string): string | undefined => {
      if (!value) {
        return t('common.required');
      }
      if (!isValidDatetime(value)) {
        return t('validation.invalidDate', { defaultValue: 'Invalid date' });
      }
      return undefined;
    },
    [t],
  );

  /**
   * Validates the location field.
   */
  const validateLocation = useCallback(
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

    // Validate personId
    const personIdError = validatePersonId(formState.personId);
    if (personIdError) {
      newErrors.personId = personIdError;
    }

    // Validate datetime (convert to ISO for validation)
    const isoDatetime = toISODatetime(formState.datetime);
    const datetimeError = validateDatetime(isoDatetime);
    if (datetimeError) {
      newErrors.datetime = datetimeError;
    }

    // Validate location
    const locationError = validateLocation(formState.location);
    if (locationError) {
      newErrors.location = locationError;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formState, validatePersonId, validateDatetime, validateLocation]);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles type radio button change.
   */
  const handleTypeChange = useCallback((value: string) => {
    setFormState((prev) => ({
      ...prev,
      type: value as TransportType,
    }));
  }, []);

  /**
   * Handles person select change.
   */
  const handlePersonChange = useCallback(
    (value: string) => {
      const personId = value === NO_SELECTION ? '' : (value as PersonId);
      setFormState((prev) => ({ ...prev, personId }));
      // Clear error when user selects
      setErrors((prev) => (prev.personId ? { ...prev, personId: undefined } : prev));
    },
    [],
  );

  /**
   * Handles a change from the date and time picker.
   */
  const handleDatetimeChange = useCallback(
    (value: string) => {
      setIsDatetimeTouched(true);
      setFormState((prev) => ({ ...prev, datetime: value }));
      // Clear error when user picks a value
      setErrors((prev) => (prev.datetime ? { ...prev, datetime: undefined } : prev));
    },
    [],
  );

  /**
   * Handles datetime input blur for validation.
   */
  const handleDatetimeBlur = useCallback(() => {
    const isoDatetime = toISODatetime(formState.datetime);
    const error = validateDatetime(isoDatetime);
    if (error) {
      setErrors((prev) => ({ ...prev, datetime: error }));
    }
  }, [formState.datetime, validateDatetime]);

  /**
   * Handles transport mode select change.
   */
  const handleTransportModeChange = useCallback((value: string) => {
    const mode = value === NO_SELECTION ? '' : (value as TransportMode);
    setFormState((prev) => ({ ...prev, transportMode: mode }));
  }, []);

  /**
   * Handles transport number input change.
   */
  const handleTransportNumberChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setFormState((prev) => ({ ...prev, transportNumber: e.target.value }));
    },
    [],
  );

  /**
   * Handles driver select change.
   */
  const handleDriverChange = useCallback((value: string) => {
    const driverId = value === NO_SELECTION ? '' : (value as PersonId);
    setFormState((prev) => ({ ...prev, driverId }));
  }, []);

  /**
   * Handles notes textarea change.
   */
  const handleNotesChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      setFormState((prev) => ({ ...prev, notes: e.target.value }));
    },
    [],
  );

  /**
   * Toggles the optional "Details" section.
   */
  const handleToggleDetails = useCallback(() => {
    setIsDetailsOpen((prev) => !prev);
  }, []);

  /**
   * Submission handler via useFormSubmission hook.
   */
  const { isSubmitting, submitError, handleSubmit: doSubmit } = useFormSubmission<TransportFormData>(
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

      // Build form data with proper types
      const startTrimmed = formState.startLocation.trim();
      const data: TransportFormData = {
        personId: formState.personId as PersonId,
        type: formState.type,
        datetime: toISODatetime(formState.datetime),
        location: formState.location.trim(),
        coordinates: formState.coordinates,
        startLocation: startTrimmed || undefined,
        startCoordinates: startTrimmed ? formState.startCoordinates : undefined,
        transportMode: formState.transportMode || undefined,
        transportNumber: formState.transportNumber.trim() || undefined,
        driverId: formState.driverId || undefined,
        // Inferred from the driver rather than asked for separately: picking
        // someone to drive is what says this person is being collected, and the
        // form asked the same question twice.
        needsPickup: formState.driverId !== '',
        notes: formState.notes.trim() || undefined,
      };

      try {
        await doSubmit(data);
      } catch {
        // Error handled by useFormSubmission hook (sets submitError)
      }
    },
    [validateForm, doSubmit, formState],
  );

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {/* Type Selection - Radio Buttons */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium leading-none">
          {t('transports.type')}
          <span className="text-destructive ml-1" aria-hidden="true">*</span>
        </legend>
        <RadioGroup
          value={formState.type}
          onValueChange={handleTypeChange}
          disabled={isSubmitting}
          className="flex flex-row gap-6"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="arrival" id="type-arrival" />
            <Label htmlFor="type-arrival" className="font-normal cursor-pointer">
              {t('transports.arrival')}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="departure" id="type-departure" />
            <Label htmlFor="type-departure" className="font-normal cursor-pointer">
              {t('transports.departure')}
            </Label>
          </div>
        </RadioGroup>
      </fieldset>

      {/* Person Select */}
      <div className="space-y-2">
        <Label htmlFor="transport-person">
          {t('assignments.person')}
          <span className="text-destructive ml-1" aria-hidden="true">*</span>
        </Label>
        <Select
          value={formState.personId || NO_SELECTION}
          onValueChange={handlePersonChange}
          disabled={isSubmitting || persons.length === 0}
        >
          <SelectTrigger
            id="transport-person"
            className="w-full"
            aria-invalid={Boolean(errors.personId) || !selectedPersonExists}
            aria-describedby={errors.personId ? 'transport-person-error' : undefined}
          >
            <SelectValue placeholder={t('assignments.selectPerson')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_SELECTION}>
              {t('assignments.selectPerson')}
            </SelectItem>
            {persons.map((person) => (
              <SelectItem key={person.id} value={person.id}>
                <div className="flex items-center gap-2">
                  <div
                    className="size-3 rounded-full shrink-0"
                    style={{ backgroundColor: person.color }}
                    aria-hidden="true"
                  />
                  {person.name}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.personId && (
          <p
            id="transport-person-error"
            className="text-sm text-destructive"
            role="alert"
          >
            {errors.personId}
          </p>
        )}
        {!selectedPersonExists && formState.personId && (
          <p className="text-sm text-destructive" role="alert">
            {t('errors.personNotFound')}
          </p>
        )}
        {persons.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t('persons.empty')}
          </p>
        )}
      </div>

      {/* Datetime Field */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium leading-none">
          {t('transports.datetime')}
          <span className="text-destructive ml-1" aria-hidden="true">*</span>
        </legend>
        <DateTimePicker
          id="transport-datetime"
          value={formState.datetime}
          onChange={handleDatetimeChange}
          onBlur={handleDatetimeBlur}
          hasError={Boolean(errors.datetime)}
          aria-describedby={errors.datetime ? 'transport-datetime-error' : undefined}
          disabled={isSubmitting}
          dateLabel={t('common.date', 'Date')}
          timeLabel={t('common.time', 'Time')}
        />
        {errors.datetime && (
          <p
            id="transport-datetime-error"
            className="text-sm text-destructive"
            role="alert"
          >
            {errors.datetime}
          </p>
        )}
      </fieldset>

      {/* Optional starting place (map: route from start to main location) */}
      <div className="space-y-2">
        <Label htmlFor="transport-start-location">
          {t('transports.startingPlace', 'Starting place')}
        </Label>
        <p className="text-xs text-muted-foreground">
          {t('transports.startLocationHint')}
        </p>
        <LocationPicker
          id="transport-start-location"
          value={formState.startLocation}
          onChange={(startLocation, startCoordinates) => {
            setFormState((prev) => ({ ...prev, startLocation, startCoordinates }));
          }}
          placeholder={t('transports.startLocationPlaceholder')}
          disabled={isSubmitting}
          aria-label={t('transports.startingPlace', 'Starting place')}
        />
      </div>

      {/* Location Field - OpenStreetMap LocationPicker */}
      <div className="space-y-2">
        <Label htmlFor="transport-location">
          {t('transports.location')}
          <span className="text-destructive ml-1" aria-hidden="true">*</span>
        </Label>
        <LocationPicker
          id="transport-location"
          value={formState.location}
          onChange={(location, coordinates) => {
            setFormState((prev) => ({ ...prev, location, coordinates }));
            // Clear error when user selects a location
            setErrors((prev) => (prev.location ? { ...prev, location: undefined } : prev));
          }}
          placeholder={t('transports.locationPlaceholder')}
          hasError={Boolean(errors.location)}
          aria-label={t('transports.location')}
          disabled={isSubmitting}
        />
        {errors.location && (
          <p
            id="transport-location-error"
            className="text-sm text-destructive"
            role="alert"
          >
            {errors.location}
          </p>
        )}
      </div>

      {/* Optional details, folded away: mode, number, driver and notes are
          rarely known when the transport is first written down. */}
      <div className="rounded-md border">
        <button
          type="button"
          onClick={handleToggleDetails}
          aria-expanded={isDetailsOpen}
          aria-controls="transport-details"
          className={cn(
            'flex w-full items-center justify-between gap-2 px-3 py-2 text-sm font-medium',
            'rounded-md hover:bg-accent/60 transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <span>{t('transports.details', 'Details')}</span>
          <ChevronDown
            className={cn('size-4 shrink-0 transition-transform', isDetailsOpen && 'rotate-180')}
            aria-hidden="true"
          />
        </button>

        {isDetailsOpen && (
          <div id="transport-details" className="space-y-6 border-t px-3 py-3">
            {/* Transport Mode Select */}
            <div className="space-y-2">
              <Label htmlFor="transport-mode">{t('transports.mode')}</Label>
              <Select
                value={formState.transportMode || NO_SELECTION}
                onValueChange={handleTransportModeChange}
                disabled={isSubmitting}
              >
                <SelectTrigger id="transport-mode" className="w-full">
                  <SelectValue placeholder={t('transports.mode')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SELECTION}>—</SelectItem>
                  {TRANSPORT_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {t(`transports.modes.${mode}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Transport Number Field */}
            <div className="space-y-2">
              <Label htmlFor="transport-number">{t('transports.number')}</Label>
              <Input
                id="transport-number"
                type="text"
                inputMode="text"
                value={formState.transportNumber}
                onChange={handleTransportNumberChange}
                placeholder={t('transports.numberPlaceholder')}
                disabled={isSubmitting}
              />
            </div>

            {/* Driver Select */}
            <div className="space-y-2">
              <Label htmlFor="transport-driver">{t('transports.driver')}</Label>
              <Select
                value={formState.driverId || NO_SELECTION}
                onValueChange={handleDriverChange}
                disabled={isSubmitting || driverOptions.length === 0}
              >
                <SelectTrigger id="transport-driver" className="w-full">
                  <SelectValue placeholder={t('transports.driverPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SELECTION}>—</SelectItem>
                  {driverOptions.map((person) => (
                    <SelectItem key={person.id} value={person.id}>
                      <div className="flex items-center gap-2">
                        <div
                          className="size-3 rounded-full shrink-0"
                          style={{ backgroundColor: person.color }}
                          aria-hidden="true"
                        />
                        {person.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {driverOptions.length === 0 && formState.personId && (
                <p className="text-sm text-muted-foreground">
                  {t('transports.noOtherPersons', { defaultValue: 'No other persons available' })}
                </p>
              )}
            </div>

            {/* Notes Field */}
            <div className="space-y-2">
              <Label htmlFor="transport-notes">{t('transports.notes')}</Label>
              <Textarea
                id="transport-notes"
                value={formState.notes}
                onChange={handleNotesChange}
                placeholder={t('transports.notesPlaceholder')}
                disabled={isSubmitting}
                rows={3}
              />
            </div>
          </div>
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

      {/* Action Buttons. Sticky against the bottom of the dialog's scroll area:
          the form is nine fields tall, and on a short window Save used to sit
          below the fold with nothing saying it was there. */}
      <div className="sticky bottom-0 z-10 flex flex-col-reverse gap-2 border-t bg-background pt-4 pb-1 sm:flex-row sm:justify-end">
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
          disabled={isSubmitting || persons.length === 0}
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

export { TransportForm };
export type { TransportFormProps };
