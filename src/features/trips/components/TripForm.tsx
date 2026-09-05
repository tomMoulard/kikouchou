/**
 * @fileoverview Trip Form Component for creating and editing trips.
 * Provides form validation, date pickers, and handles submission with loading states.
 *
 * @module features/trips/components/TripForm
 */

import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  type Ref,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useFormSubmission } from '@/hooks';
import { format, isBefore, isValid, parseISO, startOfDay } from 'date-fns';
import { CalendarIcon, Plus, X } from 'lucide-react';
import { nanoid } from 'nanoid';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { MAX_LENGTHS } from '@/lib/db/sanitize';
import { toISODateStringFromString } from '@/lib/db/utils';
import { getDateLocale } from '@/lib/i18n/date-locale';
import type { Coordinates } from '@/lib/geocoding';
import {
  LocationAutocomplete,
  ImportBadge,
  type TripImportData,
} from '@/features/trips/components/LocationAutocomplete';
import type { HexColor, Trip, TripFormData, TripId } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum characters for a trip description — the repository's own limit, for
 * the same reason the name below takes its limit from there rather than
 * restating it. Until the sanitiser bounded this field the two were independent
 * by necessity; now that it does, a second literal here would be a ceiling the
 * counter could show while the save applied a different one.
 */
const DESCRIPTION_MAX_LENGTH = MAX_LENGTHS.tripDescription;

/**
 * Maximum characters for a trip name — the repository's own limit, not a
 * second opinion about it.
 *
 * `sanitizeTripData` has always clipped the name to this on save, and the field
 * let you type past it and said nothing: the trip came back renamed, with no
 * indication of why. The description field next to it has been bounded like this
 * all along.
 */
const NAME_MAX_LENGTH = MAX_LENGTHS.tripName;

/**
 * Maximum characters for a guest name — the person repository's own limit, for
 * the same reason the two fields above take theirs from there.
 */
const GUEST_NAME_MAX_LENGTH = MAX_LENGTHS.personName;

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
  /** Callback when form dirty state changes (for unsaved changes guard). */
  readonly onDirtyChange?: (isDirty: boolean) => void;
  /** Callback when a previous trip is selected for import (passes source trip ID). */
  readonly onImportSourceChange?: (sourceTripId: TripId | null) => void;
  /**
   * Name to pre-fill the first guest — "you" — with, in create mode.
   *
   * The page reads it off the signed-in account; signed out there is none, and
   * the row is the user's to fill in. Passed in rather than read from
   * `useAuth()` here so this form stays renderable without an `AuthProvider`.
   */
  readonly currentUserName?: string;
  /**
   * Callback when the create-mode guest list changes, with the trimmed,
   * non-empty guests in list order.
   *
   * Guests are not part of {@link TripFormData}: the trip repository spreads
   * that object straight into the Dexie record, so a field that is not a trip
   * field would be persisted onto the trip and projected into the CRDT
   * document. Like `onImportSourceChange`, this reports the extra create-mode
   * data out so the page can act on it once the trip exists.
   */
  readonly onGuestsChange?: (guests: readonly NewTripGuest[]) => void;
  /**
   * Handle for pushing guests into the list from outside — see
   * {@link TripFormHandle}.
   */
  readonly ref?: Ref<TripFormHandle>;
  /**
   * Extra controls rendered directly under the guest list.
   *
   * Exists for the create page's guest-group picker: it belongs beside the
   * guests it adds and above "Save" to be part of the same decision, but it is
   * not a trip field and has no business inside this component's state.
   */
  readonly children?: ReactNode;
}

/**
 * A guest the create form will turn into a `Person`.
 *
 * Everything past `name` is optional because a typed row has none of it: the
 * page assigns a colour from the palette and the rest stays unset. A guest that
 * arrived from a saved group brings its own, and those fields are the whole
 * reason a group is worth keeping — retyping four names is tedious, retyping
 * four phone numbers and a peanut allergy is why people give up.
 */
export interface NewTripGuest {
  readonly name: string;
  readonly color?: HexColor;
  readonly headcount?: number;
  readonly notes?: string;
  readonly phone?: string;
}

/**
 * What the create page can do to the guest list from outside it.
 *
 * An imperative handle rather than lifting the list into the page: the "you"
 * row follows the account through three interacting pieces of state
 * (`currentUserName`, `hasEditedFirstGuest`, `resolvedGuests`), and moving that
 * out to give one caller an append would be a large change to buy a small one.
 * Appending to a list a child owns is what a handle is for.
 */
export interface TripFormHandle {
  /**
   * Adds guests to the end of the list.
   *
   * Anyone already present by `sourceMemberId` is skipped, so importing the
   * same family twice does not double it. Names are not compared: two people
   * called Alice are two people.
   */
  readonly addGuests: (guests: readonly ImportedTripGuest[]) => void;
}

/** A guest arriving from a saved group, carrying the member it came from. */
export interface ImportedTripGuest extends NewTripGuest {
  /** The group member this came from; the identity an append de-duplicates on. */
  readonly sourceMemberId: string;
}

/**
 * One row of the create-mode guest list.
 */
interface GuestRow {
  /**
   * React key, and nothing more.
   *
   * Rows are removed from the middle of the list, and keying on the array index
   * would hand the removed row's DOM node — with the focus and the text
   * selection inside it — to whichever guest shuffled up into its place.
   */
  readonly id: string;
  /** The raw field value; trimmed only on the way out. */
  readonly name: string;
  /**
   * What a saved group brought with this person, when it came from one.
   *
   * Deliberately not rendered: a guest is a guest, and marking the imported
   * ones would split one list into two in the only place the user is trying to
   * see it as one.
   */
  readonly imported?: Omit<ImportedTripGuest, 'name'>;
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
const DISPLAY_DATE_FORMAT = 'PPP';

/**
 * Date format for display (localized).
 */
const ISO_DATE_FORMAT = 'yyyy-MM-dd';

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
 * Formats a Date object to ISO date string (YYYY-MM-DD).
 */
function formatToISO(date: Date | undefined): string {
  if (!date) {return '';}
  return format(date, ISO_DATE_FORMAT);
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

/**
 * The guest list a fresh create form starts with: one row, for the user.
 *
 * Its name is left blank because the component derives it from the account —
 * see `resolvedGuests`.
 */
function buildInitialGuests(): readonly GuestRow[] {
  return [{ id: nanoid(), name: '' }];
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
  onDirtyChange,
  onImportSourceChange,
  currentUserName,
  onGuestsChange,
  ref,
  children,
}: TripFormProps) {
  const { t, i18n } = useTranslation();
  const locale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);

  /**
   * Guests belong to trip *creation* only. An existing trip's guests are owned
   * by the Guests page, and a second editor for them here would have to
   * reconcile additions, renames and deletions against records that already
   * carry colours, stay dates and room assignments.
   */
  const isCreateMode = trip === undefined;

  // ============================================================================
  // Import State
  // ============================================================================

  /** Tracks the source trip selected for import (null = no import) */
  const [importSource, setImportSource] = useState<{
    readonly tripId: TripId;
    readonly tripName: string;
    readonly roomCount: number;
  } | null>(null);

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
      description: trip?.description ?? '',
      coordinates: trip?.coordinates,
    }),
    [trip],
  );

  const [name, setName] = useState(initialValues.name);
  const [location, setLocation] = useState(initialValues.location);
  // Date state is stored as string internally, converted to ISODateString on submit
  const [startDate, setStartDate] = useState<string>(initialValues.startDate);
  const [endDate, setEndDate] = useState<string>(initialValues.endDate);
  const [description, setDescription] = useState(initialValues.description);
  const [coordinates, setCoordinates] = useState<Coordinates | undefined>(
    initialValues.coordinates,
  );
  const [guests, setGuests] = useState<readonly GuestRow[]>(buildInitialGuests);
  const [hasEditedFirstGuest, setHasEditedFirstGuest] = useState(false);

  /*
    The first row follows the account until the user takes it over.

    `AuthProvider` never gates rendering on the session — it loads supabase-js
    dynamically and resolves a tick later — so this form reliably mounts with
    `currentUserName` still undefined and is handed the real one on a later
    render. Seeding the state at mount would therefore have shown a blank field
    to every signed-in user.

    Deriving it instead of storing it keeps that a one-liner and removes the
    guesswork: `hasEditedFirstGuest` records the takeover as the fact it is,
    rather than inferring it from whether the field still looks like the
    prefill. Signing out mid-form clears an unedited row, which is right — that
    name is no longer anybody the app knows about.
  */
  const resolvedGuests = useMemo((): readonly GuestRow[] => {
    if (hasEditedFirstGuest) {return guests;}
    const [first, ...rest] = guests;
    if (!first) {return guests;}
    return [{ ...first, name: currentUserName ?? '' }, ...rest];
  }, [guests, hasEditedFirstGuest, currentUserName]);

  // A list still holding exactly the prefill is pristine: the account name was
  // put there by the form, not typed by the user, and it must not on its own
  // arm the unsaved-changes guard on a form nobody has touched.
  const isGuestListDirty = useMemo(() => {
    if (!isCreateMode) {return false;}
    if (resolvedGuests.length !== 1) {return true;}
    return (resolvedGuests[0]?.name ?? '') !== (currentUserName ?? '');
  }, [isCreateMode, resolvedGuests, currentUserName]);

  // Compute dirty state: any field differs from initial values. Coordinates
  // count: nudging the map pin is the only edit some trips need, and without
  // this the unsaved-changes guard would let it be navigated away silently.
  const isDirty = useMemo(
    () =>
      name !== initialValues.name ||
      location !== initialValues.location ||
      startDate !== initialValues.startDate ||
      endDate !== initialValues.endDate ||
      description !== initialValues.description ||
      !isSameCoordinates(coordinates, initialValues.coordinates) ||
      isGuestListDirty,
    [
      name,
      location,
      startDate,
      endDate,
      description,
      coordinates,
      initialValues,
      isGuestListDirty,
    ],
  );

  // What the page will turn into Person records: trimmed, blanks dropped. A row
  // added with "+" and left empty is an abandoned click, not a nameless guest.
  //
  // Whatever a saved group brought rides along — a typed row simply has none of
  // it, which is what makes one list able to hold both.
  const guestsToCreate = useMemo(
    (): readonly NewTripGuest[] =>
      resolvedGuests
        .map((guest) => ({ ...guest.imported, name: guest.name.trim() }))
        .filter((guest) => guest.name !== ''),
    [resolvedGuests],
  );

  useEffect(() => {
    if (!isCreateMode) {return;}
    onGuestsChange?.(guestsToCreate);
  }, [isCreateMode, guestsToCreate, onGuestsChange]);

  // Notify parent of dirty state changes
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // Validation errors
  const [errors, setErrors] = useState<FormErrors>({});

  // Sync form state when trip prop changes (for edit mode navigation)
  // Uses ref-based approach to avoid setState-in-effect lint warning
  const prevTripIdRef = useRef(trip?.id);
  if (prevTripIdRef.current !== trip?.id) {
    prevTripIdRef.current = trip?.id;
    setName(trip?.name ?? '');
    setLocation(trip?.location ?? '');
    setStartDate(trip?.startDate ?? '');
    setEndDate(trip?.endDate ?? '');
    setDescription(trip?.description ?? '');
    setCoordinates(trip?.coordinates);
    setImportSource(null);
    setGuests(buildInitialGuests());
    setHasEditedFirstGuest(false);
    setErrors({});
  }

  // Date picker popover state
  const [isStartDateOpen, setIsStartDateOpen] = useState(false);
  const [isEndDateOpen, setIsEndDateOpen] = useState(false);

  // ============================================================================
  // Guest List Focus
  // ============================================================================

  /** Live inputs, by row id, so a row added or removed can be followed. */
  const guestInputsRef = useRef(new Map<string, HTMLInputElement>());
  /** The row to focus once the render that adds or removes one has committed. */
  const pendingGuestFocusRef = useRef<string | null>(null);

  /*
    Runs after every render, gated on the ref — the row to focus does not exist
    yet at the moment "+" is clicked, and after a removal the focused element is
    gone, which drops focus on `<body>` and loses a keyboard user's place in the
    form entirely.
  */
  useEffect(() => {
    const pendingId = pendingGuestFocusRef.current;
    if (pendingId === null) {return;}
    pendingGuestFocusRef.current = null;
    guestInputsRef.current.get(pendingId)?.focus();
  });

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

    // Nothing to validate in the guest list. Every row is optional, the first
    // one included — see the fieldset's own note.

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
   * Handles importing data from a previously used trip.
   * Pre-fills location, description, and coordinates; stores import source for room cloning.
   */
  const handleImportTrip = useCallback(
    (data: TripImportData) => {
      const { trip: sourceTip, rooms } = data;

      // Pre-fill location, and its pin alongside it — adopting the name while
      // keeping an older trip's coordinates would pin the new trip elsewhere.
      if (sourceTip.location) {
        setLocation(sourceTip.location);
        setCoordinates(sourceTip.coordinates);
      }

      // Pre-fill description only if current description is empty
      setDescription((prev) => {
        if (!prev.trim() && sourceTip.description) {
          return sourceTip.description;
        }
        return prev;
      });

      // Store import source info for the badge and for room cloning on submit
      const source = {
        tripId: sourceTip.id,
        tripName: sourceTip.name,
        roomCount: rooms.length,
      };
      setImportSource(source);
      onImportSourceChange?.(sourceTip.id);
    },
    [onImportSourceChange],
  );

  /**
   * Handles removing the import selection.
   */
  const handleRemoveImport = useCallback(() => {
    setImportSource(null);
    onImportSourceChange?.(null);
  }, [onImportSourceChange]);

  /**
   * Handles a guest name change, by row id.
   */
  const firstGuestId = resolvedGuests[0]?.id;
  const handleGuestNameChange = useCallback(
    (id: string, value: string) => {
      setGuests((prev) =>
        prev.map((guest) => (guest.id === id ? { ...guest, name: value } : guest)),
      );
      if (id === firstGuestId) {
        // From here the row is the user's, and the account no longer writes to
        // it — not when it arrives late, and not when it goes away. Clearing
        // the row therefore sticks, which is how somebody says "not me".
        setHasEditedFirstGuest(true);
      }
    },
    [firstGuestId],
  );

  /**
   * Appends an empty guest row and puts the cursor in it.
   */
  const handleAddGuest = useCallback(() => {
    const id = nanoid();
    pendingGuestFocusRef.current = id;
    setGuests((prev) => [...prev, { id, name: '' }]);
  }, []);

  /**
   * Appends guests that came from a saved group.
   *
   * They land in the same list as the typed ones and look identical there —
   * which is the point. A group is a shortcut for typing names, not a second
   * kind of guest, and showing it as one would split the list the user is
   * trying to read as a whole.
   *
   * The blank row a signed-out form starts with is filled rather than left
   * stranded above the arrivals; anything already imported from the same member
   * is skipped, so adding the same family twice is a no-op instead of a double.
   */
  const addGuests = useCallback((incoming: readonly ImportedTripGuest[]) => {
    setGuests((prev) => {
      const present = new Set(
          prev
            .map((guest) => guest.imported?.sourceMemberId)
            .filter((id): id is string => id !== undefined),
        ),
        fresh = incoming.filter((guest) => !present.has(guest.sourceMemberId));

      if (fresh.length === 0) {
        return prev;
      }

      const rows = fresh.map(({ name, ...imported }) => ({
        id: nanoid(),
        name,
        imported,
      }));

      // An untouched trailing blank is an empty row the user has not typed in;
      // leaving it between the typed guests and the imported ones would read as
      // a gap in the list.
      const last = prev[prev.length - 1];
      if (prev.length > 1 && last && last.name.trim() === '' && !last.imported) {
        return [...prev.slice(0, -1), ...rows];
      }

      return [...prev, ...rows];
    });
  }, []);

  useImperativeHandle(ref, () => ({ addGuests }), [addGuests]);

  /**
   * Removes a guest row, moving focus to the row above it.
   *
   * The first row is the user and has no remove control; the index guard is the
   * invariant rather than a defensive flourish, since a stale id could
   * otherwise reach here from a click landing mid-render.
   */
  const handleRemoveGuest = useCallback(
    (id: string) => {
      const index = resolvedGuests.findIndex((guest) => guest.id === id);
      if (index <= 0) {return;}
      pendingGuestFocusRef.current = resolvedGuests[index - 1]?.id ?? null;
      setGuests((prev) => prev.filter((guest) => guest.id !== id));
    },
    [resolvedGuests],
  );

  /**
   * Handles description textarea change.
   */
  const handleDescriptionChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      setDescription(e.target.value);
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

      /*
        A start date that has moved past the end date leaves the form holding a
        range the end picker itself cannot produce — it disables every day
        before the start — and the only thing the form did about it was report
        an error and refuse to submit.

        Drop the stale end date instead. The end picker now opens on the new
        start's month (below), so a valid range is one tap away, and the invalid
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
          startDate: toISODateStringFromString(startDate),
          endDate: toISODateStringFromString(endDate),
          description: description.trim() || undefined,
          coordinates,
        });
      } catch {
        // Error handled by useFormSubmission hook (sets submitError)
      }
    },
    [validateForm, doSubmit, name, location, startDate, endDate, description, coordinates],
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
          excludeTripId={trip?.id}
        />
        {importSource && (
          <ImportBadge
            tripName={importSource.tripName}
            roomCount={importSource.roomCount}
            onRemove={handleRemoveImport}
            disabled={isSubmitting}
          />
        )}
      </div>

      {/* Description Field */}
      <div className="space-y-2">
        <Label htmlFor="trip-description">{t('trips.description')}</Label>
        <Textarea
          id="trip-description"
          value={description}
          onChange={handleDescriptionChange}
          placeholder={t('trips.descriptionPlaceholder')}
          disabled={isSubmitting}
          rows={4}
          maxLength={DESCRIPTION_MAX_LENGTH}
          className="resize-none"
        />
        <p className="text-xs text-muted-foreground text-right">
          {description.length}/{DESCRIPTION_MAX_LENGTH}
        </p>
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
                aria-invalid={Boolean(errors.startDate)}
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
                // A selected date does not move react-day-picker's month on its
                // own; without this the picker opens on today, so re-opening
                // the dates of any trip not in the current month starts with
                // paging back to it.
                defaultMonth={startDateValue}
                locale={locale}
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
                aria-invalid={Boolean(errors.endDate)}
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
                // Falling back to the start date is the half that matters: with
                // that `disabled` above and a trip a few months out, opening on
                // today put the user in front of a month where every day was
                // greyed out and the only live control was the month arrow.
                defaultMonth={endDateValue ?? startDateValue}
                locale={locale}
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

      {/* Guest List — create mode only (see `isCreateMode`) */}
      {isCreateMode && (
        // `disabled` on the fieldset reaches every control inside it, inputs
        // and buttons alike, so submitting freezes the whole list at once.
        <fieldset className="space-y-2" disabled={isSubmitting}>
          <legend className="mb-2 flex items-center text-sm leading-none font-medium">
            {t('trips.guests', 'Guests')}
            <span className="text-muted-foreground ml-1 text-xs font-normal">
              ({t('common.optional', 'optional')})
            </span>
          </legend>

          {/*
            Every row is optional, the first one included.

            It is pre-filled with the account because the organiser is usually
            going, but they are not always: somebody who hosts — an Airbnb owner
            planning for their guests — is arranging a trip they are not on.
            Clearing the row is how they say so, and it stays cleared.
          */}
          <p id="trip-guests-hint" className="text-xs text-muted-foreground">
            {t('trips.guestsHint', 'Who is coming? Clear your own name if you are not going — you can add guests later.')}
          </p>

          <ul className="space-y-2">
            {resolvedGuests.map((guest, index) => {
              const isCurrentUser = index === 0;
              return (
                <li key={guest.id} className="flex items-center gap-2">
                  <Input
                    ref={(element) => {
                      const inputs = guestInputsRef.current;
                      if (element) {
                        inputs.set(guest.id, element);
                      } else {
                        inputs.delete(guest.id);
                      }
                    }}
                    type="text"
                    value={guest.name}
                    onChange={(event) => handleGuestNameChange(guest.id, event.target.value)}
                    placeholder={
                      isCurrentUser
                        ? t('trips.guestYouPlaceholder', 'Your name')
                        : t('trips.guestNamePlaceholder', 'e.g. Marie')
                    }
                    maxLength={GUEST_NAME_MAX_LENGTH}
                    aria-label={
                      isCurrentUser
                        ? t('trips.guestYouLabel', 'Your name')
                        : t('trips.guestNumberLabel', 'Guest {{number}}', { number: index + 1 })
                    }
                    aria-describedby="trip-guests-hint"
                  />
                  {isCurrentUser ? (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {t('trips.guestYou', 'You')}
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveGuest(guest.id)}
                      aria-label={t('trips.removeGuest', 'Remove guest {{number}}', {
                        number: index + 1,
                      })}
                    >
                      <X className="size-4" aria-hidden="true" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>

          <Button type="button" variant="outline" size="sm" onClick={handleAddGuest}>
            <Plus className="size-4" aria-hidden="true" />
            {t('trips.addGuest', 'Add guest')}
          </Button>

          {/*
            The guest-group picker, when a caller supplies one. Inside the
            fieldset because it adds guests too — typing one and importing a
            saved family are two ways to answer the same question, and splitting
            them across the form would make the second look unrelated.
          */}
          {children}
        </fieldset>
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

export { TripForm };
export type { TripFormProps };
