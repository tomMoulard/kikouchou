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
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Plus, X } from 'lucide-react';
import { useFormSubmission } from '@/hooks';
import { useMealPlannerEnabled } from '@/hooks/useMealPlannerEnabled';

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
import { Textarea } from '@/components/ui/textarea';
import { ColorPicker } from '@/components/shared/ColorPicker';
import { DEFAULT_COLORS } from '@/components/shared/color-palette';
import { DateRangePicker, type DateRange } from '@/components/shared/DateRangePicker';
import { ContactNameInput } from '@/features/persons/components/ContactNameInput';
import { DietaryTagPicker } from '@/features/persons/components/DietaryTagPicker';
import { useTripContext } from '@/contexts/TripContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { parseISO, format } from 'date-fns';
import type { ContactSuggestion } from '@/lib/contacts';
import { MAX_EXTRA_STAYS, MAX_LENGTHS, normalizeExtraStays } from '@/lib/db/sanitize';
import { formatPhone, phoneCountriesFor, phoneProblem } from '@/lib/phone';
import { toHexColor, toISODateStringFromString } from '@/lib/db/utils';
import { cn } from '@/lib/utils';
import { pickRandomUnusedColor } from '@/lib/utils/guest-colors';
import {
  CHILD_SEAT_KINDS,
  MAX_PERSON_HEADCOUNT,
  MIN_PERSON_HEADCOUNT,
  getPersonHeadcount,
  normalizePersonHeadcount,
} from '@/types';
import type { ChildSeatKind, DietaryTag, Person, PersonFormData } from '@/types';

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
  /** A phone number no phone could dial */
  phone?: string;
  /** A further stay with only one of its two days picked */
  extraStays?: string;
}

/** One further stay being edited: a stable key for React, and its range. */
interface ExtraStayRow {
  readonly key: string;
  readonly range: DateRange | undefined;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * The value the child-seat select carries for "no seat needed".
 *
 * Radix refuses an empty string as an item value — it reserves it for the
 * placeholder — so absence needs a name of its own. It never leaves this file:
 * submit maps it back to `undefined`, which is what the guest stores.
 */
const NO_CHILD_SEAT = 'none';

/**
 * How close to the notes' limit the counter appears. Below it, a count is
 * noise; past it, the person needs to see the wall coming.
 */
const NOTES_COUNTER_FROM = Math.floor(MAX_LENGTHS.personNotes * 0.8);

/** Whether a guest already carries a diet, so the details open on it. */
function hasDiet(person: Person | undefined): boolean {
  return (person?.dietaryTags?.length ?? 0) > 0 || Boolean(person?.dietaryNote);
}

/**
 * Parses the headcount input into a valid headcount.
 * Empty or malformed input falls back to the minimum (one person).
 */
function parseHeadcountInput(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? MIN_PERSON_HEADCOUNT : normalizePersonHeadcount(parsed);
}

// ============================================================================
// Further stays
// ============================================================================

let extraStayRowSequence = 0;

/** A fresh key for a further-stay row, unique for the page's lifetime. */
function nextExtraStayKey(): string {
  extraStayRowSequence += 1;
  return `stay-${extraStayRowSequence}`;
}

/** The editable rows for a guest's stored further stays. */
function buildExtraStayRows(person: Person | undefined): ExtraStayRow[] {
  return normalizeExtraStays(person?.extraStays).map((stay) => ({
    key: nextExtraStayKey(),
    range: { from: parseISO(stay.startDate), to: parseISO(stay.endDate) },
  }));
}

/** A row as the `start|end` text the dirty check compares. */
function extraStayRowsSignature(rows: readonly ExtraStayRow[]): string {
  return rows
    .map(
      (row) =>
        `${row.range?.from ? format(row.range.from, 'yyyy-MM-dd') : ''}|${
          row.range?.to ? format(row.range.to, 'yyyy-MM-dd') : ''
        }`,
    )
    .join(',');
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
  const { t, i18n } = useTranslation();
  // Where a number typed without a "+" may be from, likeliest first.
  const phoneCountries = useMemo(
    () =>
      phoneCountriesFor(
        typeof navigator === 'undefined' ? undefined : navigator.language,
        i18n.language,
      ),
    [i18n.language],
  );
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
  // Further stays after the first one: a guest who comes back in August.
  const [extraStayRows, setExtraStayRows] = useState<ExtraStayRow[]>(() =>
    buildExtraStayRows(person),
  );
  // The guest the rows were last built for; `undefined` until the first sync.
  const syncedPersonIdRef = useRef<string | null | undefined>(undefined);
  const [notes, setNotes] = useState(person?.notes ?? '');
  const [phone, setPhone] = useState(person?.phone ?? '');
  // Headcount is kept as a string so the field can be cleared while typing;
  // it is normalized on blur and on submit.
  const [headcount, setHeadcount] = useState(() =>
    String(getPersonHeadcount(person ?? {})),
  );
  // Absent is the answer for every adult, so the select starts on "none needed"
  // and most of a roster never touches it.
  const [childSeat, setChildSeat] = useState<ChildSeatKind | undefined>(
    () => person?.childSeat,
  );
  // The diet fields belong to the meal planner and show only with its flag.
  // With the flag off they are neither shown nor submitted, so saving a guest
  // here never clears a diet another member typed in.
  const mealPlanner = useMealPlannerEnabled();
  const [dietaryTags, setDietaryTags] = useState<DietaryTag[]>(
    () => [...(person?.dietaryTags ?? [])],
  );
  const [dietaryNote, setDietaryNote] = useState(person?.dietaryNote ?? '');
  // Extra details stay collapsed by default, but open when the guest already
  // stands for several people, or already needs a seat, so neither value is
  // silently hidden behind a closed section.
  const [isExtraOpen, setIsExtraOpen] = useState(
    () =>
      getPersonHeadcount(person ?? {}) > MIN_PERSON_HEADCOUNT ||
      person?.childSeat !== undefined ||
      (mealPlanner && hasDiet(person)),
  );

  const [initialSnapshot, setInitialSnapshot] = useState<{
    readonly name: string;
    readonly color: string;
    readonly stayStartDate: string;
    readonly stayEndDate: string;
    readonly extraStays: string;
    readonly notes: string;
    readonly phone: string;
    readonly headcount: number;
    readonly childSeat: ChildSeatKind | undefined;
    readonly dietaryTags: string;
    readonly dietaryNote: string;
  } | null>(null);

  const currentStayStart = stayDates?.from ? format(stayDates.from, 'yyyy-MM-dd') : '';
  const currentStayEnd = stayDates?.to ? format(stayDates.to, 'yyyy-MM-dd') : '';
  const currentHeadcount = parseHeadcountInput(headcount);
  const currentExtraStays = extraStayRowsSignature(extraStayRows);

  // Compute dirty state: compare current values against initial (person prop)
  const isDirty = useMemo(
    () => {
      if (!initialSnapshot) return false;

      return (
        name !== initialSnapshot.name ||
        color !== initialSnapshot.color ||
        currentStayStart !== initialSnapshot.stayStartDate ||
        currentStayEnd !== initialSnapshot.stayEndDate ||
        currentExtraStays !== initialSnapshot.extraStays ||
        notes !== initialSnapshot.notes ||
        phone !== initialSnapshot.phone ||
        currentHeadcount !== initialSnapshot.headcount ||
        childSeat !== initialSnapshot.childSeat ||
        dietaryTags.join(',') !== initialSnapshot.dietaryTags ||
        dietaryNote !== initialSnapshot.dietaryNote
      );
    },
    [
      childSeat,
      dietaryNote,
      dietaryTags,
      color,
      currentHeadcount,
      currentExtraStays,
      currentStayEnd,
      currentStayStart,
      name,
      notes,
      phone,
      initialSnapshot,
    ],
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
    // Rebuilt only for another guest. This effect also runs when the used
    // colours change, and fresh rows (new keys) on every run would wipe a stay
    // being typed and re-render for ever.
    const isOtherGuest = syncedPersonIdRef.current !== (person?.id ?? null);
    syncedPersonIdRef.current = person?.id ?? null;
    const nextExtraStayRows = isOtherGuest ? buildExtraStayRows(person) : null;
    if (nextExtraStayRows) {
      setExtraStayRows(nextExtraStayRows);
    }

    const nextNotes = person?.notes ?? '';
    setNotes(nextNotes);

    const nextPhone = person?.phone ?? '';
    setPhone(nextPhone);

    const nextHeadcount = getPersonHeadcount(person ?? {});
    setHeadcount(String(nextHeadcount));

    const nextChildSeat = person?.childSeat;
    setChildSeat(nextChildSeat);
    const nextDietaryTags = [...(person?.dietaryTags ?? [])];
    setDietaryTags(nextDietaryTags);
    const nextDietaryNote = person?.dietaryNote ?? '';
    setDietaryNote(nextDietaryNote);
    setIsExtraOpen(
      nextHeadcount > MIN_PERSON_HEADCOUNT ||
        nextChildSeat !== undefined ||
        (mealPlanner && hasDiet(person)),
    );

    setInitialSnapshot((previous) => ({
      name: nextName,
      color: nextColor,
      stayStartDate: person?.stayStartDate ?? '',
      stayEndDate: person?.stayEndDate ?? '',
      extraStays: nextExtraStayRows
        ? extraStayRowsSignature(nextExtraStayRows)
        : (previous?.extraStays ?? ''),
      notes: nextNotes,
      phone: nextPhone,
      headcount: nextHeadcount,
      childSeat: nextChildSeat,
      dietaryTags: nextDietaryTags.join(','),
      dietaryNote: nextDietaryNote,
    }));

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
   * Validates the phone field: only what no phone could dial is refused.
   */
  const validatePhone = useCallback(
    (value: string): string | undefined => {
      switch (phoneProblem(value)) {
        case 'characters':
          return t('persons.phoneCharacters', 'Only digits, spaces and + ( ) - . can go in a phone number');
        case 'tooShort':
          return t('persons.phoneTooShort', 'This number is too short to call');
        case 'tooLong':
          return t('persons.phoneTooLong', 'A phone number has 15 digits at most');
        default:
          return undefined;
      }
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

    const phoneError = validatePhone(phone);
    if (phoneError) {
      newErrors.phone = phoneError;
    }

    // A further stay needs both days: half a stay is not a period anyone can
    // read, and dropping it silently would lose what was typed.
    if (extraStayRows.some((row) => Boolean(row.range?.from) !== Boolean(row.range?.to))) {
      newErrors.extraStays = t(
        'persons.stayIncomplete',
        'Pick the arrival and the departure day of every stay',
      );
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [extraStayRows, name, phone, t, validateName, validatePhone]);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles name input change.
   * Uses functional update to avoid dependency on error state.
   */
  const handleNameChange = useCallback((value: string) => {
    setName(value);
    // Clear error when user starts typing (functional update avoids stale closure)
    setErrors((prev) => (prev.name ? { ...prev, name: undefined } : prev));
  }, []);

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

  const handleAddExtraStay = useCallback(() => {
    setExtraStayRows((prev) =>
      prev.length >= MAX_EXTRA_STAYS ? prev : [...prev, { key: nextExtraStayKey(), range: undefined }],
    );
  }, []);

  const handleExtraStayChange = useCallback((key: string, range: DateRange | undefined) => {
    setExtraStayRows((prev) => prev.map((row) => (row.key === key ? { ...row, range } : row)));
    setErrors((prev) => (prev.extraStays ? { ...prev, extraStays: undefined } : prev));
  }, []);

  const handleRemoveExtraStay = useCallback((key: string) => {
    setExtraStayRows((prev) => prev.filter((row) => row.key !== key));
    setErrors((prev) => (prev.extraStays ? { ...prev, extraStays: undefined } : prev));
  }, []);

  const handleNotesChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setNotes(e.target.value);
  }, []);

  const handlePhoneChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setPhone(e.target.value);
    setErrors((prev) => (prev.phone ? { ...prev, phone: undefined } : prev));
  }, []);

  /**
   * Leaving the phone field checks it, then lays a number it recognises out
   * the way its country writes it ("0612345678" → "06 12 34 56 78").
   */
  const handlePhoneBlur = useCallback(() => {
    const error = validatePhone(phone);
    if (error) {
      setErrors((prev) => ({ ...prev, phone: error }));
      return;
    }
    setPhone((current) => formatPhone(current, phoneCountries));
  }, [phone, phoneCountries, validatePhone]);

  /**
   * Fills the form from a contact picked in the name field's suggestions.
   *
   * The phone is written only when the picked line carries one, so a contact
   * with no number does not wipe a number the user already typed.
   */
  const handlePickContact = useCallback((contact: ContactSuggestion) => {
    setName(contact.name);
    setErrors((prev) => (prev.name ? { ...prev, name: undefined } : prev));
    if (contact.phone !== undefined) {
      setPhone(contact.phone);
    }
  }, []);

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
   * Records the declared child restraint, mapping the "none needed" option back
   * to absence rather than storing a fourth kind meaning "no seat".
   */
  const handleChildSeatChange = useCallback((value: string) => {
    setChildSeat(value === NO_CHILD_SEAT ? undefined : (value as ChildSeatKind));
  }, []);

  /**
   * Adds or removes one diet tag, keeping the order the form offers them in.
   */
  const handleDietaryNoteChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setDietaryNote(e.target.value);
  }, []);

  /**
   * Toggles the collapsible "more details" section.
   */
  const handleToggleExtra = useCallback(() => {
    setIsExtraOpen((prev) => !prev);
  }, []);

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

      // Complete rows only (validation refused a half one), in date order.
      const extraStays = normalizeExtraStays(
        extraStayRows.map((row) => ({
          startDate: row.range?.from ? format(row.range.from, 'yyyy-MM-dd') : undefined,
          endDate: row.range?.to ? format(row.range.to, 'yyyy-MM-dd') : undefined,
        })),
      );

      try {
        const trimmedNotes = notes.trim();
        // Formatted here too: a number picked from the contacts, or typed
        // and submitted with Enter, never left the field.
        const trimmedPhone = formatPhone(phone, phoneCountries).trim();
        await doSubmit({
          name: name.trim(),
          color: toHexColor(color),
          stayStartDate: formattedStartDate ? toISODateStringFromString(formattedStartDate) : undefined,
          stayEndDate: formattedEndDate ? toISODateStringFromString(formattedEndDate) : undefined,
          // Always sent, `undefined` when empty, so removing the last further
          // stay clears it rather than keeping the stored list.
          extraStays: extraStays.length > 0 ? extraStays : undefined,
          notes: trimmedNotes.length > 0 ? trimmedNotes : undefined,
          phone: trimmedPhone.length > 0 ? trimmedPhone : undefined,
          headcount: parseHeadcountInput(headcount),
          childSeat,
          ...(mealPlanner && {
            dietaryTags: dietaryTags.length > 0 ? [...dietaryTags] : undefined,
            dietaryNote: dietaryNote.trim().length > 0 ? dietaryNote.trim() : undefined,
          }),
        });
      } catch {
        // Error handled by useFormSubmission hook (sets submitError)
      }
    },
    [
      validateForm,
      doSubmit,
      name,
      color,
      stayDates,
      extraStayRows,
      notes,
      phone,
      phoneCountries,
      headcount,
      childSeat,
      mealPlanner,
      dietaryTags,
      dietaryNote,
    ],
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
        {/* In a store app, typing here lists matching contacts from the
            phone's address book. On the web it is a plain text field. */}
        <ContactNameInput
          id="person-name"
          value={name}
          onChange={handleNameChange}
          onPickContact={handlePickContact}
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
          onBlur={handlePhoneBlur}
          placeholder={t('persons.phonePlaceholder', '+33 6 12 34 56 78')}
          aria-invalid={Boolean(errors.phone)}
          aria-describedby={errors.phone ? 'person-phone-error person-phone-hint' : 'person-phone-hint'}
          disabled={isSubmitting}
        />
        {errors.phone && (
          <p id="person-phone-error" className="text-sm text-destructive" role="alert">
            {errors.phone}
          </p>
        )}
        <p id="person-phone-hint" className="text-xs text-muted-foreground">
          {t(
            'persons.phoneHint',
            'Everyone you share the trip with can see this number. It is handy for the station pickup.',
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
            aria-label={t('persons.stayDates', 'Stay dates')}
            disabled={isSubmitting}
          />
          <p className="text-xs text-muted-foreground">
            {t('persons.stayDatesHint', 'When will this guest be at the trip?')}
          </p>

          {/* Further stays: a guest who comes back later in the trip. */}
          {extraStayRows.map((row, index) => (
            <div key={row.key} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <DateRangePicker
                  value={row.range}
                  onChange={(range) => {
                    handleExtraStayChange(row.key, range);
                  }}
                  aria-label={t('persons.extraStayLabel', 'Stay {{number}}', { number: index + 2 })}
                  disabled={isSubmitting}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  handleRemoveExtraStay(row.key);
                }}
                disabled={isSubmitting}
                aria-label={t('persons.removeStay', 'Remove stay {{number}}', { number: index + 2 })}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
          {errors.extraStays && (
            <p id="person-extra-stays-error" className="text-sm text-destructive" role="alert">
              {errors.extraStays}
            </p>
          )}
          {extraStayRows.length < MAX_EXTRA_STAYS && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddExtraStay}
              disabled={isSubmitting}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t('persons.addStay', 'Add another stay')}
            </Button>
          )}
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
          // The same limit the save enforces: past it, a paste was clipped by
          // nothing and the whole guest failed to save.
          maxLength={MAX_LENGTHS.personNotes}
          aria-describedby="person-notes-hint"
          className="min-h-24 max-h-64 resize-y"
        />
        <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
          <p id="person-notes-hint">
            {t('persons.notesHint', 'Diet, allergies, or anything hosts should know.')}
          </p>
          {notes.length >= NOTES_COUNTER_FROM && (
            <p className="shrink-0 tabular-nums" aria-live="polite">
              {notes.length} / {MAX_LENGTHS.personNotes}
            </p>
          )}
        </div>
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
            {/* The section auto-opens when a seat is already set, but the user
                can collapse it again; without this the value would then be
                invisible on a form they are about to save. */}
            {childSeat !== undefined && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                {t(`childSeats.${childSeat}`)}
              </span>
            )}
            {mealPlanner && dietaryTags.length > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                {dietaryTags.map((tag) => t(`diets.${tag}`)).join(' · ')}
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
                'How many people this entry stands for. Use 2 for a couple like "Alice+Auré". Meal headcounts use this.',
              )}
            </p>

            {/* Child seat. Declared by the parent, never derived: see
                `ChildSeatKind`. The two hints below are what keep the field
                honest — one says how to enter a child so the tally can see
                them, the other says what the app does not promise. */}
            <div className="border-t pt-3 space-y-2">
              <Label htmlFor="person-child-seat">{t('childSeats.label')}</Label>
              <Select
                value={childSeat ?? NO_CHILD_SEAT}
                onValueChange={handleChildSeatChange}
                disabled={isSubmitting}
              >
                <SelectTrigger
                  id="person-child-seat"
                  className="w-full"
                  aria-describedby="person-child-seat-hint person-child-seat-disclaimer"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CHILD_SEAT}>{t('childSeats.none')}</SelectItem>
                  {CHILD_SEAT_KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {t(`childSeats.${kind}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p id="person-child-seat-hint" className="text-xs text-muted-foreground">
                {t(
                  'persons.childSeatHint',
                  'Give a child who needs a seat their own guest entry. A car counts one seat per entry, whatever number of people it stands for.',
                )}
              </p>
              <p id="person-child-seat-disclaimer" className="text-xs text-muted-foreground">
                {t(
                  'persons.childSeatDisclaimer',
                  "The app records what you pick and checks it against no country's rules.",
                )}
              </p>
            </div>

            {/* Diet. Counted on every meal of the planner this guest eats. */}
            {mealPlanner && (
              <div className="border-t pt-3 space-y-2">
                <DietaryTagPicker
                  value={dietaryTags}
                  onChange={setDietaryTags}
                  hintId="person-diet-hint"
                  disabled={isSubmitting}
                />
                <Label htmlFor="person-dietary-note">{t('diets.noteLabel')}</Label>
                <Input
                  id="person-dietary-note"
                  value={dietaryNote}
                  onChange={handleDietaryNoteChange}
                  placeholder={t('diets.notePlaceholder')}
                  maxLength={MAX_LENGTHS.personDietaryNote}
                  disabled={isSubmitting}
                />
              </div>
            )}
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
