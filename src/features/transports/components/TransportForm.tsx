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
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { format, parseISO } from 'date-fns';

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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { LocationPicker } from '@/components/shared/LocationPicker';
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
  /** Callback when form is successfully submitted with validated data. */
  readonly onSubmit: (data: TransportFormData) => Promise<void>;
  /** Callback when cancel button is clicked. */
  readonly onCancel: () => void;
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
  location: string;
  transportMode: TransportMode | '';
  transportNumber: string;
  driverId: PersonId | '';
  needsPickup: boolean;
  notes: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Available transport modes.
 */
const TRANSPORT_MODES: TransportMode[] = ['train', 'plane', 'car', 'bus', 'other'],

/**
 * Special value for "no selection" in select dropdowns.
 */
 NO_SELECTION = '__none__';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Creates initial form state from a transport or defaults.
 *
 * @param transport - Existing transport for edit mode
 * @param defaultType - Default type for create mode
 * @returns Initial form state
 */
function getInitialFormState(
  transport?: Transport,
  defaultType?: TransportType,
): FormState {
  return {
    personId: transport?.personId ?? '',
    type: transport?.type ?? defaultType ?? 'arrival',
    datetime: transport?.datetime ? formatDatetimeLocal(transport.datetime) : '',
    location: transport?.location ?? '',
    transportMode: transport?.transportMode ?? '',
    transportNumber: transport?.transportNumber ?? '',
    driverId: transport?.driverId ?? '',
    needsPickup: transport?.needsPickup ?? false,
    notes: transport?.notes ?? '',
  };
}

/**
 * Converts ISO datetime string to datetime-local input format.
 *
 * @param isoDatetime - ISO datetime string
 * @returns datetime-local format (YYYY-MM-DDTHH:mm)
 */
function formatDatetimeLocal(isoDatetime: string): string {
  try {
    const date = parseISO(isoDatetime);
    if (isNaN(date.getTime())) {return '';}
    return format(date, "yyyy-MM-dd'T'HH:mm");
  } catch {
    return '';
  }
}

/**
 * Converts datetime-local input format to ISO datetime string.
 *
 * @param localDatetime - datetime-local format (YYYY-MM-DDTHH:mm)
 * @returns ISO datetime string
 */
function toISODatetime(localDatetime: string): string {
  if (!localDatetime) {return '';}
  try {
    // Datetime-local gives us local time, convert to ISO
    const date = new Date(localDatetime);
    if (isNaN(date.getTime())) {return '';}
    return date.toISOString();
  } catch {
    return '';
  }
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
const TransportForm = memo(({
  transport,
  persons,
  defaultType,
  onSubmit,
  onCancel,
}: TransportFormProps) => {
  const { t } = useTranslation(),

  // ============================================================================
  // Form State
  // ============================================================================

  // Form field values
   [formState, setFormState] = useState<FormState>(() =>
    getInitialFormState(transport, defaultType),
  ),

  // Validation errors
   [errors, setErrors] = useState<FormErrors>({}),

  // Submission state
   [isSubmitting, setIsSubmitting] = useState(false),
   [submitError, setSubmitError] = useState<string | null>(null),

  // Refs for preventing race conditions and memory leaks
   isSubmittingRef = useRef(false),
   isMountedRef = useRef(true),

  // ============================================================================
  // Derived State
  // ============================================================================

  /**
   * Filter driver options to exclude the currently selected person.
   */
   driverOptions = useMemo(() => {
    if (!formState.personId) {return persons;}
    return persons.filter((p) => p.id !== formState.personId);
  }, [persons, formState.personId]),

  /**
   * Check if the selected person still exists.
   */
   selectedPersonExists = useMemo(() => {
    if (!formState.personId) {return true;} // No selection is valid for showing placeholder
    return persons.some((p) => p.id === formState.personId);
  }, [persons, formState.personId]);

  // ============================================================================
  // Lifecycle Effects
  // ============================================================================

  // Cleanup on unmount
  useEffect(() => () => {
      isMountedRef.current = false;
    }, []);

  // Sync form state when transport prop changes (for edit mode navigation)
  useEffect(() => {
    setFormState(getInitialFormState(transport, defaultType));
    setErrors({});
    setSubmitError(null);
  }, [transport?.id, defaultType]); // eslint-disable-line react-hooks/exhaustive-deps -- Only sync on transport.id change

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
  ),

  /**
   * Validates the datetime field.
   */
   validateDatetime = useCallback(
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
  ),

  /**
   * Validates the location field.
   */
   validateLocation = useCallback(
    (value: string): string | undefined => {
      const trimmed = value.trim();
      if (!trimmed) {
        return t('common.required');
      }
      return undefined;
    },
    [t],
  ),

  /**
   * Validates all form fields.
   * Returns true if valid, false otherwise.
   */
   validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {},

    // Validate personId
     personIdError = validatePersonId(formState.personId);
    if (personIdError) {
      newErrors.personId = personIdError;
    }

    // Validate datetime (convert to ISO for validation)
    const isoDatetime = toISODatetime(formState.datetime),
     datetimeError = validateDatetime(isoDatetime);
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
  }, [formState, validatePersonId, validateDatetime, validateLocation]),

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles type radio button change.
   */
   handleTypeChange = useCallback((value: string) => {
    setFormState((prev) => ({
      ...prev,
      type: value as TransportType,
    }));
  }, []),

  /**
   * Handles person select change.
   */
   handlePersonChange = useCallback(
    (value: string) => {
      const personId = value === NO_SELECTION ? '' : (value as PersonId);
      setFormState((prev) => ({ ...prev, personId }));
      // Clear error when user selects
      setErrors((prev) => (prev.personId ? { ...prev, personId: undefined } : prev));
    },
    [],
  ),

  /**
   * Handles datetime input change.
   */
   handleDatetimeChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const {value} = e.target;
      setFormState((prev) => ({ ...prev, datetime: value }));
      // Clear error when user types
      setErrors((prev) => (prev.datetime ? { ...prev, datetime: undefined } : prev));
    },
    [],
  ),

  /**
   * Handles datetime input blur for validation.
   */
   handleDatetimeBlur = useCallback(() => {
    const isoDatetime = toISODatetime(formState.datetime),
     error = validateDatetime(isoDatetime);
    if (error) {
      setErrors((prev) => ({ ...prev, datetime: error }));
    }
  }, [formState.datetime, validateDatetime]),

  /**
   * Handles transport mode select change.
   */
   handleTransportModeChange = useCallback((value: string) => {
    const mode = value === NO_SELECTION ? '' : (value as TransportMode);
    setFormState((prev) => ({ ...prev, transportMode: mode }));
  }, []),

  /**
   * Handles transport number input change.
   */
   handleTransportNumberChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setFormState((prev) => ({ ...prev, transportNumber: e.target.value }));
    },
    [],
  ),

  /**
   * Handles driver select change.
   */
   handleDriverChange = useCallback((value: string) => {
    const driverId = value === NO_SELECTION ? '' : (value as PersonId);
    setFormState((prev) => ({ ...prev, driverId }));
  }, []),

  /**
   * Handles needs pickup switch change.
   */
   handleNeedsPickupChange = useCallback((checked: boolean) => {
    setFormState((prev) => ({ ...prev, needsPickup: checked }));
  }, []),

  /**
   * Handles notes textarea change.
   */
   handleNotesChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      setFormState((prev) => ({ ...prev, notes: e.target.value }));
    },
    [],
  ),

  /**
   * Handles form submission.
   */
   handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();

      // Prevent double submission using ref for synchronous check
      if (isSubmittingRef.current) {return;}

      // Validate form
      if (!validateForm()) {return;}

      isSubmittingRef.current = true;
      setIsSubmitting(true);
      setSubmitError(null);

      try {
        // Build form data with proper types
        const data: TransportFormData = {
          personId: formState.personId as PersonId,
          type: formState.type,
          datetime: toISODatetime(formState.datetime),
          location: formState.location.trim(),
          transportMode: formState.transportMode || undefined,
          transportNumber: formState.transportNumber.trim() || undefined,
          driverId: formState.driverId || undefined,
          needsPickup: formState.needsPickup,
          notes: formState.notes.trim() || undefined,
        };

        await onSubmit(data);
        // Success - parent component handles navigation
      } catch (error) {
        console.error('Failed to save transport:', error);
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
    [validateForm, onSubmit, formState, t],
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
      <div className="space-y-2">
        <Label htmlFor="transport-datetime">
          {t('transports.datetime')}
          <span className="text-destructive ml-1" aria-hidden="true">*</span>
        </Label>
        <Input
          id="transport-datetime"
          type="datetime-local"
          value={formState.datetime}
          onChange={handleDatetimeChange}
          onBlur={handleDatetimeBlur}
          aria-invalid={Boolean(errors.datetime)}
          aria-describedby={errors.datetime ? 'transport-datetime-error' : undefined}
          disabled={isSubmitting}
          className="w-full sm:w-auto"
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
          onChange={(location) => {
            setFormState((prev) => ({ ...prev, location }));
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

      {/* Needs Pickup Switch */}
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="transport-needs-pickup" className="cursor-pointer">
            {t('transports.needsPickup')}
          </Label>
          <p className="text-sm text-muted-foreground">
            {t('transports.needsPickupDescription', {
              defaultValue: 'Mark if someone needs to pick up or drop off this person',
            })}
          </p>
        </div>
        <Switch
          id="transport-needs-pickup"
          checked={formState.needsPickup}
          onCheckedChange={handleNeedsPickupChange}
          disabled={isSubmitting}
        />
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
          disabled={isSubmitting || persons.length === 0}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </form>
  );
});

TransportForm.displayName = 'TransportForm';

// ============================================================================
// Exports
// ============================================================================

export { TransportForm };
export type { TransportFormProps };
