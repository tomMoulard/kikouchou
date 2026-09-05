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
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { BookUser, ChevronDown } from 'lucide-react';
import { useFormSubmission } from '@/hooks';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ColorPicker, DEFAULT_COLORS } from '@/components/shared/ColorPicker';
import { DateRangePicker, type DateRange } from '@/components/shared/DateRangePicker';
import { useTripContext } from '@/contexts/TripContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { parseISO, format } from 'date-fns';
import { isContactPickerSupported, pickContact } from '@/lib/contacts';
import { MAX_LENGTHS } from '@/lib/db/sanitize';
import { toHexColor, toISODateStringFromString } from '@/lib/db/utils';
import { cn } from '@/lib/utils';
import { pickRandomUnusedColor } from '@/lib/utils/guest-colors';
import {
  MAX_PERSON_HEADCOUNT,
  MIN_PERSON_HEADCOUNT,
  getPersonHeadcount,
  normalizePersonHeadcount,
} from '@/types';
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
  /** Callback when form dirty state changes (for unsaved changes guard). */
  readonly onDirtyChange?: (isDirty: boolean) => void;
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
 * Parses the headcount input into a valid headcount.
 * Empty or malformed input falls back to the minimum (one person).
 */
function parseHeadcountInput(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? MIN_PERSON_HEADCOUNT : normalizePersonHeadcount(parsed);
}

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
  onDirtyChange,
}: PersonFormProps) {
  const { t } = useTranslation();
  const { currentTrip } = useTripContext();
  const { persons } = usePersonContext();

  const usedColors = useMemo(() => {
    const used = new Set<string>();
    for (const p of persons) {
      if (person?.id && p.id === person.id) continue;
      used.add(p.color);
    }
    return used;
  }, [person?.id, persons]);

  // ============================================================================
  // Form State
  // ============================================================================

  // Form field values
  const [name, setName] = useState(person?.name ?? '');
  // Color state is stored as string internally, converted to HexColor on submit
  const [color, setColor] = useState<string>(() => {
    if (person?.color) return person.color;
    return pickRandomUnusedColor({ usedColors, palette: DEFAULT_COLORS });
  });
  const [stayDates, setStayDates] = useState<DateRange | undefined>(() => {
    if (person?.stayStartDate && person?.stayEndDate) {
      return {
        from: parseISO(person.stayStartDate),
        to: parseISO(person.stayEndDate),
      };
    }
    return undefined;
  });
  const [notes, setNotes] = useState(person?.notes ?? '');
  const [phone, setPhone] = useState(person?.phone ?? '');
  // Set when an import fails for a reason worth naming. A dismissed picker is
  // not one of them, so the common outcome stays silent.
  const [contactError, setContactError] = useState<string | undefined>(undefined);
  // Headcount is kept as a string so the field can be cleared while typing;
  // it is normalized on blur and on submit.
  const [headcount, setHeadcount] = useState(() =>
    String(getPersonHeadcount(person ?? {})),
  );
  // Extra details stay collapsed by default, but open when the guest already
  // stands for several people so the value is not silently hidden.
  const [isExtraOpen, setIsExtraOpen] = useState(
    () => getPersonHeadcount(person ?? {}) > MIN_PERSON_HEADCOUNT,
  );

  // Whether this browser can open the OS contact picker at all. Read once on
  // mount rather than per render: it cannot change while the form is open, and
  // on the browsers that lack it (every one on iOS, and every desktop) the
  // button below is simply never rendered.
  const [canImportContacts] = useState(isContactPickerSupported);

  const [initialSnapshot, setInitialSnapshot] = useState<{
    readonly name: string;
    readonly color: string;
    readonly stayStartDate: string;
    readonly stayEndDate: string;
    readonly notes: string;
    readonly phone: string;
    readonly headcount: number;
  } | null>(null);

  const currentStayStart = stayDates?.from ? format(stayDates.from, 'yyyy-MM-dd') : '';
  const currentStayEnd = stayDates?.to ? format(stayDates.to, 'yyyy-MM-dd') : '';
  const currentHeadcount = parseHeadcountInput(headcount);

  // Compute dirty state: compare current values against initial (person prop)
  const isDirty = useMemo(
    () => {
      if (!initialSnapshot) return false;

      return (
        name !== initialSnapshot.name ||
        color !== initialSnapshot.color ||
        currentStayStart !== initialSnapshot.stayStartDate ||
        currentStayEnd !== initialSnapshot.stayEndDate ||
        notes !== initialSnapshot.notes ||
        phone !== initialSnapshot.phone ||
        currentHeadcount !== initialSnapshot.headcount
      );
    },
    [color, currentHeadcount, currentStayEnd, currentStayStart, name, notes, phone, initialSnapshot],
  );

  // Notify parent of dirty state changes
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // Validation errors
  const [errors, setErrors] = useState<FormErrors>({});

  // ============================================================================
  // Lifecycle Effects
  // ============================================================================

  // Sync form state when person prop changes (for edit mode navigation)
  // Only depends on person.id to avoid resetting on every prop reference change
  useEffect(() => {
    const nextName = person?.name ?? '';
    const nextColor = person?.color
      ? person.color
      : pickRandomUnusedColor({ usedColors, palette: DEFAULT_COLORS });

    setName(nextName);
    setColor(nextColor);
    // Sync stay dates from person
    if (person?.stayStartDate && person?.stayEndDate) {
      setStayDates({
        from: parseISO(person.stayStartDate),
        to: parseISO(person.stayEndDate),
      });
    } else {
      setStayDates(undefined);
    }

    const nextNotes = person?.notes ?? '';
    setNotes(nextNotes);

    const nextPhone = person?.phone ?? '';
    setPhone(nextPhone);
    setContactError(undefined);

    const nextHeadcount = getPersonHeadcount(person ?? {});
    setHeadcount(String(nextHeadcount));
    setIsExtraOpen(nextHeadcount > MIN_PERSON_HEADCOUNT);

    setInitialSnapshot({
      name: nextName,
      color: nextColor,
      stayStartDate: person?.stayStartDate ?? '',
      stayEndDate: person?.stayEndDate ?? '',
      notes: nextNotes,
      phone: nextPhone,
      headcount: nextHeadcount,
    });

    // Use callback to avoid creating new object if already empty
    setErrors((prev) => (Object.keys(prev).length === 0 ? prev : {}));
  }, [person?.id, usedColors]); // eslint-disable-line react-hooks/exhaustive-deps -- Only sync on person.id change

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

  const handleNotesChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setNotes(e.target.value);
  }, []);

  const handlePhoneChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setPhone(e.target.value);
  }, []);

  /**
   * Opens the device address book and fills in whatever the chosen contact has.
   *
   * Only the fields the contact actually carries are written, so importing a
   * number-less contact does not wipe a name the user already typed. A
   * dismissed picker leaves the form exactly as it was.
   */
  const handleImportFromContacts = useCallback(async () => {
    setContactError(undefined);

    const outcome = await pickContact();

    switch (outcome.status) {
      case 'picked': {
        const { contact } = outcome;
        if (contact.name !== undefined) {
          setName(contact.name);
          setErrors((prev) => (prev.name ? { ...prev, name: undefined } : prev));
        }
        if (contact.phone !== undefined) {
          setPhone(contact.phone);
        }
        if (contact.name === undefined && contact.phone === undefined) {
          setContactError(
            t('persons.contactEmpty', 'That contact has no name or phone number.'),
          );
        }
        return;
      }
      case 'cancelled':
        return;
      case 'unsupported':
        setContactError(
          t('persons.contactUnsupported', 'This browser cannot open your contacts.'),
        );
        return;
      default:
        setContactError(
          t('persons.contactFailed', 'Could not read your contacts. Enter the details by hand.'),
        );
    }
  }, [t]);

  /**
   * Handles headcount input change. Keeps the raw string so the field can be
   * emptied while typing; normalization happens on blur and on submit.
   */
  const handleHeadcountChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setHeadcount(e.target.value);
  }, []);

  /**
   * Snaps the headcount back into the allowed range when the field loses focus.
   */
  const handleHeadcountBlur = useCallback(() => {
    setHeadcount((prev) => String(parseHeadcountInput(prev)));
  }, []);

  /**
   * Toggles the collapsible "more details" section.
   */
  const handleToggleExtra = useCallback(() => {
    setIsExtraOpen((prev) => !prev);
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
        const trimmedNotes = notes.trim();
        const trimmedPhone = phone.trim();
        await doSubmit({
          name: name.trim(),
          color: toHexColor(color),
          stayStartDate: formattedStartDate ? toISODateStringFromString(formattedStartDate) : undefined,
          stayEndDate: formattedEndDate ? toISODateStringFromString(formattedEndDate) : undefined,
          notes: trimmedNotes.length > 0 ? trimmedNotes : undefined,
          phone: trimmedPhone.length > 0 ? trimmedPhone : undefined,
          headcount: parseHeadcountInput(headcount),
        });
      } catch {
        // Error handled by useFormSubmission hook (sets submitError)
      }
    },
    [validateForm, doSubmit, name, color, stayDates, notes, phone, headcount],
  );

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {/* Import from the device address book. Rendered only where the browser
          has the Contact Picker API — Chromium on Android, in practice. */}
      {canImportContacts && (
        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleImportFromContacts}
            disabled={isSubmitting}
            className="w-full sm:w-auto"
          >
            <BookUser className="size-4" aria-hidden="true" />
            {t('persons.importFromContacts', 'Fill in from contacts')}
          </Button>
          {contactError ? (
            <p className="text-sm text-destructive" role="alert">
              {contactError}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t(
                'persons.importFromContactsHint',
                'Your browser picks the contact — the app only sees the one you choose.',
              )}
            </p>
          )}
        </div>
      )}

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
          // eslint-disable-next-line jsx-a11y/no-autofocus -- The first control of a form the user has just chosen to open. Without it focus stays on the trigger — or, in a dialog, on the close button — and the user tabs to reach the field they came for.
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

      {/* Phone Field (Optional) */}
      <div className="space-y-2">
        <Label htmlFor="person-phone">
          {t('persons.phone', 'Phone')}{' '}
          <span className="text-muted-foreground text-xs">({t('common.optional', 'optional')})</span>
        </Label>
        <Input
          id="person-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={MAX_LENGTHS.personPhone}
          value={phone}
          onChange={handlePhoneChange}
          placeholder={t('persons.phonePlaceholder', '+33 6 12 34 56 78')}
          aria-describedby="person-phone-hint"
          disabled={isSubmitting}
        />
        <p id="person-phone-hint" className="text-xs text-muted-foreground">
          {t(
            'persons.phoneHint',
            'Everyone you share the trip with can see this number — handy for the station pickup.',
          )}
        </p>
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

      <div className="space-y-2">
        <Label htmlFor="person-notes">
          {t('persons.notes', 'Notes')}{' '}
          <span className="text-muted-foreground text-xs">({t('common.optional', 'optional')})</span>
        </Label>
        <Textarea
          id="person-notes"
          value={notes}
          onChange={handleNotesChange}
          placeholder={t('persons.notesPlaceholder', 'e.g. allergic to cats, vegan…')}
          disabled={isSubmitting}
          rows={4}
          className="min-h-24 resize-y"
        />
        <p className="text-xs text-muted-foreground">
          {t('persons.notesHint', 'Diet, allergies, or anything hosts should know.')}
        </p>
      </div>

      {/* Collapsible extra details (headcount) */}
      <div className="rounded-md border">
        <button
          type="button"
          onClick={handleToggleExtra}
          aria-expanded={isExtraOpen}
          aria-controls="person-extra-details"
          className={cn(
            'flex w-full items-center justify-between gap-2 px-3 py-2 text-sm font-medium',
            'rounded-md hover:bg-accent/60 transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <span className="flex items-center gap-2">
            {t('persons.moreDetails', 'More details')}
            {currentHeadcount > MIN_PERSON_HEADCOUNT && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground tabular-nums">
                {t('persons.headcountBadge', '{{count}} people', { count: currentHeadcount })}
              </span>
            )}
          </span>
          <ChevronDown
            className={cn('size-4 shrink-0 transition-transform', isExtraOpen && 'rotate-180')}
            aria-hidden="true"
          />
        </button>

        {isExtraOpen && (
          <div id="person-extra-details" className="border-t px-3 py-3 space-y-2">
            <Label htmlFor="person-headcount">
              {t('persons.headcount', 'Number of people')}
            </Label>
            <Input
              id="person-headcount"
              type="number"
              inputMode="numeric"
              min={MIN_PERSON_HEADCOUNT}
              max={MAX_PERSON_HEADCOUNT}
              step={1}
              value={headcount}
              onChange={handleHeadcountChange}
              onBlur={handleHeadcountBlur}
              disabled={isSubmitting}
              aria-describedby="person-headcount-hint"
              className="w-24"
            />
            <p id="person-headcount-hint" className="text-xs text-muted-foreground">
              {t(
                'persons.headcountHint',
                'How many people this entry stands for — use 2 for a couple like "Alice+Auré". Meal headcounts use this.',
              )}
            </p>
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
