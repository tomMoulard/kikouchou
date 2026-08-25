/**
 * @fileoverview Activity form for creating and editing trip activities.
 * Handles validation, controlled inputs and submission state.
 *
 * @module features/activities/components/ActivityForm
 * @see TransportForm.tsx for the reference implementation pattern
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
import { format, isValid, parseISO } from 'date-fns';
import { Check } from 'lucide-react';
import { useFormSubmission } from '@/hooks';

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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ActivityCategoryIcon } from '@/components/shared/ActivityCategoryIcon';
import { LocationPicker, type Coordinates } from '@/components/shared/LocationPicker';
import {
  toActivityInstant,
  toAllDayActivityInstant,
} from '@/features/activities/utils/activity-utils';

import { cn } from '@/lib/utils';
import { ACTIVITY_CATEGORIES, DEFAULT_ACTIVITY_CATEGORY } from '@/types';
import type {
  Activity,
  ActivityCategory,
  ActivityFormData,
  ISODateString,
  Person,
  PersonId,
} from '@/types';


// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the ActivityForm component.
 */
interface ActivityFormProps {
  /** Existing activity for edit mode. If undefined, the form is in create mode. */
  readonly activity?: Activity;
  /** Guests available as organizer and participants. */
  readonly persons: readonly Person[];
  /** Day pre-selected in create mode (YYYY-MM-DD), e.g. the clicked calendar cell. */
  readonly defaultDate?: ISODateString;
  /** Callback when the form is successfully submitted with validated data. */
  readonly onSubmit: (data: ActivityFormData) => Promise<void>;
  /** Callback when the cancel button is clicked. */
  readonly onCancel: () => void;
  /** Callback when the form dirty state changes (for the unsaved changes guard). */
  readonly onDirtyChange?: (isDirty: boolean) => void;
}

/**
 * Form validation errors.
 */
interface FormErrors {
  title?: string;
  start?: string;
  end?: string;
  maxParticipants?: string;
}

/**
 * Internal form state. Optional fields use strings to avoid uncontrolled inputs.
 */
interface FormState {
  title: string;
  category: ActivityCategory;
  allDay: boolean;
  /** `datetime-local` value used when allDay is false */
  startDatetime: string;
  /** `datetime-local` value used when allDay is false */
  endDatetime: string;
  /** `date` value used when allDay is true */
  startDate: string;
  /** `date` value used when allDay is true */
  endDate: string;
  location: string;
  coordinates: Coordinates | undefined;
  organizerId: PersonId | '';
  participantIds: PersonId[];
  maxParticipants: string;
  notes: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Special value for "no selection" in select dropdowns. */
const NO_SELECTION = '__none__';

/** Default start time for a new timed activity. */
const DEFAULT_START_TIME = '10:00';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Converts an ISO datetime to the `datetime-local` input format.
 */
function toDatetimeLocalValue(isoDatetime: string | undefined): string {
  if (!isoDatetime) {
    return '';
  }
  const date = parseISO(isoDatetime);
  return isValid(date) ? format(date, "yyyy-MM-dd'T'HH:mm") : '';
}

/** Matches a bare local calendar day, as produced by a `date` input. */
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Converts an ISO datetime to the `date` input format (local day).
 */
function toDateValue(isoDatetime: string | undefined): string {
  if (!isoDatetime) {
    return '';
  }
  const date = parseISO(isoDatetime);
  return isValid(date) ? format(date, 'yyyy-MM-dd') : '';
}

/**
 * Converts a `datetime-local` value to the stored UTC ISO instant.
 */
function fromDatetimeLocalValue(value: string): string {
  if (!value) {
    return '';
  }
  return toActivityInstant(value) ?? '';
}

/**
 * Converts a `date` value to an ISO datetime at the start or end of that local day.
 */
function fromDateValue(value: string, edge: 'start' | 'end'): string {
  if (!DAY_KEY_PATTERN.test(value)) {
    return '';
  }
  return toAllDayActivityInstant(value, edge) ?? '';
}

/**
 * Creates the initial form state from an activity, or sensible defaults.
 */
function getInitialFormState(
  activity?: Activity,
  defaultDate?: ISODateString,
): FormState {
  const fallbackDate = defaultDate ?? '';

  return {
    title: activity?.title ?? '',
    category: activity?.category ?? DEFAULT_ACTIVITY_CATEGORY,
    allDay: activity?.allDay ?? false,
    startDatetime: activity
      ? toDatetimeLocalValue(activity.startDatetime)
      : fallbackDate
        ? `${fallbackDate}T${DEFAULT_START_TIME}`
        : '',
    endDatetime: activity ? toDatetimeLocalValue(activity.endDatetime) : '',
    startDate: activity ? toDateValue(activity.startDatetime) : fallbackDate,
    endDate: activity ? toDateValue(activity.endDatetime) : '',
    location: activity?.location ?? '',
    coordinates: activity?.coordinates,
    organizerId: activity?.organizerId ?? '',
    participantIds: [...(activity?.participantIds ?? [])],
    maxParticipants:
      activity?.maxParticipants === undefined ? '' : String(activity.maxParticipants),
    notes: activity?.notes ?? '',
  };
}

/**
 * Compares two participant lists ignoring order.
 */
function areParticipantsEqual(
  a: readonly PersonId[],
  b: readonly PersonId[],
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const set = new Set(b);
  return a.every((personId) => set.has(personId));
}

// ============================================================================
// Component
// ============================================================================

/**
 * Form for creating and editing an activity.
 *
 * Features:
 * - Title, category, all-day toggle and start/end pickers
 * - Location with map lookup via LocationPicker
 * - Organizer select and a togglable participant list
 * - Optional participant cap, validated against the current sign-ups
 * - Validation on submit, with inline field errors
 *
 * @param props - Component props
 * @returns The activity form element
 *
 * @example
 * ```tsx
 * <ActivityForm
 *   persons={persons}
 *   onSubmit={async (data) => await createActivity(data)}
 *   onCancel={() => setOpen(false)}
 * />
 * ```
 */
const ActivityForm = memo(function ActivityForm({
  activity,
  persons,
  defaultDate,
  onSubmit,
  onCancel,
  onDirtyChange,
}: ActivityFormProps) {
  const { t } = useTranslation();

  const [formState, setFormState] = useState<FormState>(() =>
    getInitialFormState(activity, defaultDate),
  );
  const [errors, setErrors] = useState<FormErrors>({});

  const initialFormState = useMemo(
    () => getInitialFormState(activity, defaultDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only recompute when editing a different activity
    [activity?.id, defaultDate],
  );

  const isDirty = useMemo(
    () =>
      formState.title !== initialFormState.title ||
      formState.category !== initialFormState.category ||
      formState.allDay !== initialFormState.allDay ||
      formState.startDatetime !== initialFormState.startDatetime ||
      formState.endDatetime !== initialFormState.endDatetime ||
      formState.startDate !== initialFormState.startDate ||
      formState.endDate !== initialFormState.endDate ||
      formState.location !== initialFormState.location ||
      formState.coordinates?.lat !== initialFormState.coordinates?.lat ||
      formState.coordinates?.lon !== initialFormState.coordinates?.lon ||
      formState.organizerId !== initialFormState.organizerId ||
      formState.maxParticipants !== initialFormState.maxParticipants ||
      formState.notes !== initialFormState.notes ||
      !areParticipantsEqual(formState.participantIds, initialFormState.participantIds),
    [formState, initialFormState],
  );

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // Sync form state when editing a different activity
  useEffect(() => {
    setFormState(getInitialFormState(activity, defaultDate));
    setErrors({});
  }, [activity?.id, defaultDate]); // eslint-disable-line react-hooks/exhaustive-deps -- Only sync on activity.id change

  // ============================================================================
  // Validation
  // ============================================================================

  const validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    if (!formState.title.trim()) {
      newErrors.title = t('common.required');
    }

    const startIso = formState.allDay
      ? fromDateValue(formState.startDate, 'start')
      : fromDatetimeLocalValue(formState.startDatetime);

    if (!startIso) {
      newErrors.start = t('common.required');
    }

    const endIso = formState.allDay
      ? fromDateValue(formState.endDate, 'end')
      : fromDatetimeLocalValue(formState.endDatetime);

    const hasEndInput = formState.allDay ? formState.endDate : formState.endDatetime;
    if (hasEndInput && !endIso) {
      newErrors.end = t('validation.invalidDate', { defaultValue: 'Invalid date' });
    } else if (startIso && endIso && endIso < startIso) {
      newErrors.end = t(
        'activities.errors.endBeforeStart',
        'The end must be after the start',
      );
    }

    if (formState.maxParticipants) {
      const cap = Number(formState.maxParticipants);
      if (!Number.isFinite(cap) || cap < 1) {
        newErrors.maxParticipants = t(
          'activities.errors.invalidCap',
          'The cap must be at least 1',
        );
      } else if (formState.participantIds.length > cap) {
        newErrors.maxParticipants = t(
          'activities.errors.capBelowParticipants',
          'There are already more participants than this cap',
        );
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formState, t]);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  const handleTitleChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target;
    setFormState((prev) => ({ ...prev, title: value }));
    setErrors((prev) => (prev.title ? { ...prev, title: undefined } : prev));
  }, []);

  const handleCategoryChange = useCallback((value: string) => {
    setFormState((prev) => ({ ...prev, category: value as ActivityCategory }));
  }, []);

  /**
   * Switching the all-day toggle carries the day over between the two input
   * modes so the user never has to retype the date.
   */
  const handleAllDayChange = useCallback((checked: boolean) => {
    setFormState((prev) => {
      if (checked) {
        return {
          ...prev,
          allDay: true,
          startDate: prev.startDate || prev.startDatetime.slice(0, 10),
          endDate: prev.endDate || prev.endDatetime.slice(0, 10),
        };
      }

      return {
        ...prev,
        allDay: false,
        startDatetime:
          prev.startDatetime ||
          (prev.startDate ? `${prev.startDate}T${DEFAULT_START_TIME}` : ''),
        endDatetime: prev.endDatetime,
      };
    });
    setErrors((prev) => ({ ...prev, start: undefined, end: undefined }));
  }, []);

  const handleStartChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target;
    setFormState((prev) =>
      prev.allDay ? { ...prev, startDate: value } : { ...prev, startDatetime: value },
    );
    setErrors((prev) => (prev.start ? { ...prev, start: undefined } : prev));
  }, []);

  const handleEndChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target;
    setFormState((prev) =>
      prev.allDay ? { ...prev, endDate: value } : { ...prev, endDatetime: value },
    );
    setErrors((prev) => (prev.end ? { ...prev, end: undefined } : prev));
  }, []);

  const handleOrganizerChange = useCallback((value: string) => {
    const organizerId = value === NO_SELECTION ? '' : (value as PersonId);
    setFormState((prev) => ({
      ...prev,
      organizerId,
      // The organizer is joining by definition — sign them up automatically.
      participantIds:
        organizerId && !prev.participantIds.includes(organizerId)
          ? [...prev.participantIds, organizerId]
          : prev.participantIds,
    }));
  }, []);

  const handleParticipantToggle = useCallback((personId: PersonId) => {
    setFormState((prev) => ({
      ...prev,
      participantIds: prev.participantIds.includes(personId)
        ? prev.participantIds.filter((candidate) => candidate !== personId)
        : [...prev.participantIds, personId],
    }));
    setErrors((prev) =>
      prev.maxParticipants ? { ...prev, maxParticipants: undefined } : prev,
    );
  }, []);

  const handleMaxParticipantsChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const { value } = e.target;
      setFormState((prev) => ({ ...prev, maxParticipants: value }));
      setErrors((prev) =>
        prev.maxParticipants ? { ...prev, maxParticipants: undefined } : prev,
      );
    },
    [],
  );

  const handleNotesChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      setFormState((prev) => ({ ...prev, notes: e.target.value }));
    },
    [],
  );

  const handleLocationChange = useCallback(
    (location: string, coordinates: Coordinates | undefined) => {
      setFormState((prev) => ({ ...prev, location, coordinates }));
    },
    [],
  );

  const { isSubmitting, submitError, handleSubmit: doSubmit } =
    useFormSubmission<ActivityFormData>(onSubmit);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();

      if (!validateForm()) {
        return;
      }

      const startDatetime = formState.allDay
        ? fromDateValue(formState.startDate, 'start')
        : fromDatetimeLocalValue(formState.startDatetime);

      // An all-day activity with no end date must still carry a real end
      // instant, or `getActivityEndInstant` falls back to local midnight and it
      // reads as already over the moment it is created. The assistant's write
      // path applies the same default.
      const endDatetime = formState.allDay
        ? fromDateValue(formState.endDate, 'end') ||
          fromDateValue(formState.startDate, 'end')
        : fromDatetimeLocalValue(formState.endDatetime);

      const cap = Number(formState.maxParticipants);

      const data: ActivityFormData = {
        title: formState.title.trim(),
        category: formState.category,
        startDatetime,
        endDatetime: endDatetime || undefined,
        allDay: formState.allDay,
        location: formState.location.trim() || undefined,
        coordinates: formState.location.trim() ? formState.coordinates : undefined,
        participantIds: [...formState.participantIds],
        organizerId: formState.organizerId || undefined,
        maxParticipants:
          formState.maxParticipants && Number.isFinite(cap) ? cap : undefined,
        notes: formState.notes.trim() || undefined,
      };

      try {
        await doSubmit(data);
      } catch {
        // Error surfaced by useFormSubmission via submitError
      }
    },
    [validateForm, doSubmit, formState],
  );

  // ============================================================================
  // Render
  // ============================================================================

  const startValue = formState.allDay ? formState.startDate : formState.startDatetime;
  const endValue = formState.allDay ? formState.endDate : formState.endDatetime;
  const dateInputType = formState.allDay ? 'date' : 'datetime-local';

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {/* Title */}
      <div className="space-y-2">
        <Label htmlFor="activity-title">
          {t('activities.title_field', 'Title')}
          <span className="text-destructive ml-1" aria-hidden="true">*</span>
        </Label>
        <Input
          id="activity-title"
          type="text"
          value={formState.title}
          onChange={handleTitleChange}
          placeholder={t('activities.titlePlaceholder')}
          aria-invalid={Boolean(errors.title)}
          aria-describedby={errors.title ? 'activity-title-error' : undefined}
          disabled={isSubmitting}
        />
        {errors.title && (
          <p id="activity-title-error" className="text-sm text-destructive" role="alert">
            {errors.title}
          </p>
        )}
      </div>

      {/* Category */}
      <div className="space-y-2">
        <Label htmlFor="activity-category">{t('activities.category')}</Label>
        <Select
          value={formState.category}
          onValueChange={handleCategoryChange}
          disabled={isSubmitting}
        >
          <SelectTrigger id="activity-category" className="w-full">
            <SelectValue placeholder={t('activities.category')} />
          </SelectTrigger>
          <SelectContent>
            {ACTIVITY_CATEGORIES.map((category) => (
              <SelectItem key={category} value={category}>
                <div className="flex items-center gap-2">
                  <ActivityCategoryIcon category={category} />
                  {t(`activities.categories.${category}`)}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* All-day toggle */}
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="activity-all-day" className="cursor-pointer">
            {t('activities.allDay')}
          </Label>
          <p className="text-sm text-muted-foreground">
            {t('activities.allDayDescription')}
          </p>
        </div>
        <Switch
          id="activity-all-day"
          checked={formState.allDay}
          onCheckedChange={handleAllDayChange}
          disabled={isSubmitting}
        />
      </div>

      {/* Start / End */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="activity-start">
            {t('activities.start')}
            <span className="text-destructive ml-1" aria-hidden="true">*</span>
          </Label>
          <Input
            id="activity-start"
            type={dateInputType}
            value={startValue}
            onChange={handleStartChange}
            aria-invalid={Boolean(errors.start)}
            aria-describedby={errors.start ? 'activity-start-error' : undefined}
            disabled={isSubmitting}
          />
          {errors.start && (
            <p id="activity-start-error" className="text-sm text-destructive" role="alert">
              {errors.start}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="activity-end">{t('activities.end')}</Label>
          <Input
            id="activity-end"
            type={dateInputType}
            value={endValue}
            onChange={handleEndChange}
            aria-invalid={Boolean(errors.end)}
            aria-describedby={errors.end ? 'activity-end-error' : undefined}
            disabled={isSubmitting}
          />
          {errors.end ? (
            <p id="activity-end-error" className="text-sm text-destructive" role="alert">
              {errors.end}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">{t('activities.endHint')}</p>
          )}
        </div>
      </div>

      {/* Location */}
      <div className="space-y-2">
        <Label htmlFor="activity-location">{t('activities.location')}</Label>
        <LocationPicker
          id="activity-location"
          value={formState.location}
          onChange={handleLocationChange}
          placeholder={t('activities.locationPlaceholder')}
          aria-label={t('activities.location')}
          disabled={isSubmitting}
        />
      </div>

      {/* Organizer */}
      <div className="space-y-2">
        <Label htmlFor="activity-organizer">{t('activities.organizer')}</Label>
        <Select
          value={formState.organizerId || NO_SELECTION}
          onValueChange={handleOrganizerChange}
          disabled={isSubmitting || persons.length === 0}
        >
          <SelectTrigger id="activity-organizer" className="w-full">
            <SelectValue placeholder={t('activities.organizerPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_SELECTION}>—</SelectItem>
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
      </div>

      {/* Participants */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium leading-none">
          {t('activities.participants')}
        </legend>
        <p className="text-sm text-muted-foreground">
          {t('activities.participantsDescription')}
        </p>
        {persons.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('persons.empty')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {persons.map((person) => {
              const isSelected = formState.participantIds.includes(person.id);
              return (
                <button
                  key={person.id}
                  type="button"
                  onClick={() => handleParticipantToggle(person.id)}
                  disabled={isSubmitting}
                  aria-pressed={isSelected}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm',
                    'transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    'disabled:opacity-50',
                    isSelected
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-input text-muted-foreground hover:bg-muted',
                  )}
                >
                  <span
                    className="size-3 rounded-full shrink-0"
                    style={{ backgroundColor: person.color }}
                    aria-hidden="true"
                  />
                  {person.name}
                  {isSelected && <Check className="size-3.5 shrink-0" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        )}
      </fieldset>

      {/* Participant cap */}
      <div className="space-y-2">
        <Label htmlFor="activity-max-participants">
          {t('activities.maxParticipants')}
        </Label>
        <Input
          id="activity-max-participants"
          type="number"
          inputMode="numeric"
          min={1}
          value={formState.maxParticipants}
          onChange={handleMaxParticipantsChange}
          placeholder={t('activities.maxParticipantsPlaceholder')}
          aria-invalid={Boolean(errors.maxParticipants)}
          aria-describedby={
            errors.maxParticipants ? 'activity-max-participants-error' : undefined
          }
          disabled={isSubmitting}
          className="w-full sm:w-40"
        />
        {errors.maxParticipants && (
          <p
            id="activity-max-participants-error"
            className="text-sm text-destructive"
            role="alert"
          >
            {errors.maxParticipants}
          </p>
        )}
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <Label htmlFor="activity-notes">{t('activities.notes')}</Label>
        <Textarea
          id="activity-notes"
          value={formState.notes}
          onChange={handleNotesChange}
          placeholder={t('activities.notesPlaceholder')}
          disabled={isSubmitting}
          rows={3}
        />
      </div>

      {/* Submission error */}
      {submitError && (
        <div
          className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {submitError}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
          {isSubmitting ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </form>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { ActivityForm };
export type { ActivityFormProps };
