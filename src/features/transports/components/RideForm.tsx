/**
 * @fileoverview The form behind one car journey: where the car meets people,
 * when, who drives it and which car it is.
 *
 * It is deliberately *not* `TransportForm` with different labels. Two of its
 * rules are the opposite of that form's, and both are the point of the entity:
 *
 * 1. **Every guest is offered as the driver, passengers included.** A legacy
 *    transport's driver was always somebody else — the person being collected
 *    could not also be collecting themselves — so `TransportForm` filters the
 *    traveller out of its driver list. A ride is a car, not a leg: Tom driving
 *    himself and Aurélia to the airport in the hire car is the ordinary case,
 *    and filtering him out makes it unexpressible. When the chosen driver also
 *    owns one of the ride's legs the form says so, from the passenger list
 *    `resolveRides` assembles — the same source as `ResolvedRide.isSelfDriven`.
 * 2. **The lead time is remembered per destination.** It is typed by whoever
 *    knows the road (see `Ride.leadTimeMinutes`), so falling back to thirty
 *    minutes for the fourth run to the same station turns a real answer into
 *    paperwork. The last ride to that place answers instead, matched through
 *    `normaliseStation` — the same folding `groupPickupsByProximity` groups on,
 *    so a station the app offered to share a car for is a station it remembers.
 *
 * Passengers are not edited here. Membership lives on the leg
 * (`Transport.rideId`), which is what lets two guests join the same car while
 * both offline without either join being lost.
 *
 * @module features/transports/components/RideForm
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
import { LocationPicker, type Coordinates } from '@/components/shared/LocationPicker';
import {
  formatDatetimeLocal,
  toISODatetime,
} from '@/features/transports/utils/datetime-input';
import {
  normaliseStation,
  toTransportInstant,
} from '@/features/transports/utils/pickup-utils';
import { useFormSubmission } from '@/hooks';
import { RideFormDataSchema } from '@/lib/validation/schemas';
import {
  DEFAULT_LEAD_TIME_MINUTES,
  MAX_LEAD_TIME_MINUTES,
  MIN_LEAD_TIME_MINUTES,
  RIDE_DIRECTIONS,
  type Person,
  type PersonId,
  type Ride,
  type RideDirection,
  type RideFormData,
  type Vehicle,
  type VehicleId,
} from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** Props for the {@link RideForm} component. */
export interface RideFormProps {
  /** Existing ride for edit mode. Undefined puts the form in create mode. */
  readonly ride?: Ride;
  /**
   * Every guest on the trip.
   *
   * All of them are offered as the driver — see the note at the top of this
   * file about self-driven rides.
   */
  readonly persons: readonly Person[];
  /** The trip's cars, for the vehicle select. */
  readonly vehicles: readonly Vehicle[];
  /**
   * The trip's existing rides, read only to remember a destination's lead time.
   */
  readonly rides: readonly Ride[];
  /**
   * Who is already booked into this ride, from `resolveRides`.
   *
   * Only used to tell the user that the driver they picked is also travelling.
   * The form never changes this list: membership lives on the leg.
   */
  readonly passengerIds?: readonly PersonId[];
  /** Direction to preselect in create mode. */
  readonly defaultDirection?: RideDirection;
  /** Called with validated data when the form is submitted. */
  readonly onSubmit: (data: RideFormData) => Promise<void>;
  /** Called when the cancel button is clicked. */
  readonly onCancel: () => void;
  /** Called whenever the dirty state changes, for the unsaved-changes guard. */
  readonly onDirtyChange?: (isDirty: boolean) => void;
}

/** Per-field validation messages, plus one for a failure with no field. */
interface FormErrors {
  meetDatetime?: string;
  location?: string;
  leadTimeMinutes?: string;
  notes?: string;
  form?: string;
}

/**
 * Form state, with strings for the optional fields so no input ever flips
 * between controlled and uncontrolled.
 */
interface FormState {
  direction: RideDirection;
  meetDatetime: string;
  location: string;
  coordinates: Coordinates | undefined;
  leadTimeMinutes: string;
  driverId: PersonId | '';
  vehicleId: VehicleId | '';
  notes: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Value a shadcn select uses for "nothing chosen" — it cannot carry `''`. */
const NO_SELECTION = '__none__',
  /**
   * Direction labels, spelled out rather than assembled from the direction.
   * A key built at runtime cannot be checked by the translation-key guard.
   */
  DIRECTION_LABEL_KEYS: Record<RideDirection, string> = {
    pickup: 'rides.directions.pickup',
    dropoff: 'rides.directions.dropoff',
  },
  /** Stable identity for the default passenger list, so effects do not churn. */
  NO_PASSENGERS: readonly PersonId[] = [];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * The lead time this trip last used for a destination.
 *
 * Rides that never stated one are skipped rather than read as thirty minutes:
 * an absent value carries no knowledge of the road, and letting it win would
 * bury the 55 minutes somebody actually measured last week.
 *
 * Only ever asked in create mode, so no ride has to be excluded from its own
 * memory: an existing ride already carries the answer it was saved with.
 *
 * @param rides - The trip's existing rides
 * @param location - The destination being typed
 * @returns The most recent matching lead time, or undefined when there is none
 */
function rememberedLeadTime(
  rides: readonly Ride[],
  location: string,
): number | undefined {
  const wanted = normaliseStation(location);
  if (!wanted) {
    return undefined;
  }

  let bestAt: number | undefined,
    bestLeadTime: number | undefined;

  for (const ride of rides) {
    if (
      ride.leadTimeMinutes === undefined ||
      normaliseStation(ride.location) !== wanted
    ) {
      continue;
    }

    const at = toTransportInstant(ride.meetDatetime);
    if (at === null) {
      continue;
    }
    if (bestAt === undefined || at > bestAt) {
      bestAt = at;
      bestLeadTime = ride.leadTimeMinutes;
    }
  }

  return bestLeadTime;
}

/**
 * Reads the lead time input.
 *
 * @param value - The raw input value
 * @returns The minutes, `undefined` when blank (the default applies), or
 *   `null` when the value is not a whole number of minutes in range
 */
function parseLeadTime(value: string): number | undefined | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const minutes = Number(trimmed);
  if (
    !Number.isInteger(minutes) ||
    minutes < MIN_LEAD_TIME_MINUTES ||
    minutes > MAX_LEAD_TIME_MINUTES
  ) {
    return null;
  }
  return minutes;
}

/**
 * Builds the initial state from an existing ride, or the create defaults.
 *
 * An existing ride that states no lead time opens with the field *blank*, not
 * with thirty in it. Filling it in would turn "nobody said" into a stated
 * answer the moment the driver is changed, and a stated thirty is then an
 * eligible memory — burying the 55 minutes an older ride to that same station
 * actually measured. Blank still reads as thirty everywhere, because that is
 * what `DEFAULT_LEAD_TIME_MINUTES` means; the label says so out loud.
 */
function getInitialFormState(
  ride?: Ride,
  defaultDirection?: RideDirection,
): FormState {
  return {
    direction: ride?.direction ?? defaultDirection ?? 'pickup',
    meetDatetime: ride?.meetDatetime ? formatDatetimeLocal(ride.meetDatetime) : '',
    location: ride?.location ?? '',
    coordinates: ride?.coordinates,
    leadTimeMinutes:
      ride === undefined
        ? String(DEFAULT_LEAD_TIME_MINUTES)
        : ride.leadTimeMinutes === undefined
          ? ''
          : String(ride.leadTimeMinutes),
    driverId: ride?.driverId ?? '',
    vehicleId: ride?.vehicleId ?? '',
    notes: ride?.notes ?? '',
  };
}

// ============================================================================
// Component
// ============================================================================

/**
 * Create/edit form for a car journey.
 *
 * @param props - Component props
 * @returns The ride form element
 *
 * @example
 * ```tsx
 * <RideForm
 *   persons={persons}
 *   vehicles={vehicles}
 *   rides={rides}
 *   onSubmit={async (data) => { await createRide(data); }}
 *   onCancel={() => setOpen(false)}
 * />
 * ```
 */
const RideForm = memo(function RideForm({
  ride,
  persons,
  vehicles,
  rides,
  passengerIds = NO_PASSENGERS,
  defaultDirection,
  onSubmit,
  onCancel,
  onDirtyChange,
}: RideFormProps) {
  const { t } = useTranslation();

  // ============================================================================
  // Form State
  // ============================================================================

  const [formState, setFormState] = useState<FormState>(() =>
      getInitialFormState(ride, defaultDirection),
    ),
    [errors, setErrors] = useState<FormErrors>({}),
    // Once the driver types a lead time, nothing overwrites it — not the
    // destination's memory, and not a later edit to the location.
    [isLeadTimeTouched, setIsLeadTimeTouched] = useState(false);

  const initialFormState = useMemo(
    () => getInitialFormState(ride, defaultDirection),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only recompute when the edited ride changes
    [ride?.id, defaultDirection],
  );

  const isDirty = useMemo(
    () =>
      formState.direction !== initialFormState.direction ||
      formState.meetDatetime !== initialFormState.meetDatetime ||
      formState.location !== initialFormState.location ||
      formState.leadTimeMinutes !== initialFormState.leadTimeMinutes ||
      formState.driverId !== initialFormState.driverId ||
      formState.vehicleId !== initialFormState.vehicleId ||
      formState.notes !== initialFormState.notes ||
      formState.coordinates?.lat !== initialFormState.coordinates?.lat ||
      formState.coordinates?.lon !== initialFormState.coordinates?.lon,
    [formState, initialFormState],
  );

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // ============================================================================
  // Derived State
  // ============================================================================

  /**
   * The lead time the trip already knows for this destination, when the user
   * has not typed one of their own. Drives both the prefill and the hint that
   * explains where the number came from.
   */
  const remembered = useMemo(
      () =>
        ride === undefined && !isLeadTimeTouched
          ? rememberedLeadTime(rides, formState.location)
          : undefined,
      [ride, isLeadTimeTouched, rides, formState.location],
    ),
    /**
     * Whether the chosen driver is also travelling in this car.
     *
     * The passenger list comes from `resolveRides`, which is what computes
     * `ResolvedRide.isSelfDriven` — this asks the same question of the driver
     * being *picked*, which is not yet the one the ride stores.
     */
    isSelfDriven = useMemo(
      () => formState.driverId !== '' && passengerIds.includes(formState.driverId),
      [formState.driverId, passengerIds],
    ),
    /**
     * The number the label states.
     *
     * Reads the field as typed rather than as validated: a value the schema
     * will refuse still has to be echoed back, or the label contradicts the
     * input the user is looking at. Blank means the stored default applies.
     */
    leadTimeCount = useMemo(() => {
      const trimmed = formState.leadTimeMinutes.trim(),
        minutes = Number(trimmed);
      return trimmed && Number.isFinite(minutes)
        ? minutes
        : DEFAULT_LEAD_TIME_MINUTES;
    }, [formState.leadTimeMinutes]);

  // ============================================================================
  // Lifecycle Effects
  // ============================================================================

  // Sync the form when the edited ride changes underneath it.
  useEffect(() => {
    setFormState(getInitialFormState(ride, defaultDirection));
    setErrors({});
    setIsLeadTimeTouched(false);
  }, [ride?.id, defaultDirection]); // eslint-disable-line react-hooks/exhaustive-deps -- Only sync when the edited ride changes

  // Apply the destination's remembered lead time.
  useEffect(() => {
    if (ride !== undefined || isLeadTimeTouched) {
      return;
    }
    const next = String(remembered ?? DEFAULT_LEAD_TIME_MINUTES);
    setFormState((previous) =>
      previous.leadTimeMinutes === next
        ? previous
        : { ...previous, leadTimeMinutes: next },
    );
  }, [ride, isLeadTimeTouched, remembered]);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  const handleDirectionChange = useCallback((value: string) => {
      setFormState((previous) => ({
        ...previous,
        direction: value as RideDirection,
      }));
    }, []),
    handleMeetDatetimeChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
      const { value } = event.target;
      setFormState((previous) => ({ ...previous, meetDatetime: value }));
      setErrors((previous) =>
        previous.meetDatetime ? { ...previous, meetDatetime: undefined } : previous,
      );
    }, []),
    handleLocationChange = useCallback(
      (location: string, coordinates?: Coordinates) => {
        setFormState((previous) => ({ ...previous, location, coordinates }));
        setErrors((previous) =>
          previous.location ? { ...previous, location: undefined } : previous,
        );
      },
      [],
    ),
    handleLeadTimeChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
      const { value } = event.target;
      setIsLeadTimeTouched(true);
      setFormState((previous) => ({ ...previous, leadTimeMinutes: value }));
      setErrors((previous) =>
        previous.leadTimeMinutes
          ? { ...previous, leadTimeMinutes: undefined }
          : previous,
      );
    }, []),
    handleDriverChange = useCallback((value: string) => {
      const driverId = value === NO_SELECTION ? '' : (value as PersonId);
      setFormState((previous) => ({ ...previous, driverId }));
    }, []),
    handleVehicleChange = useCallback((value: string) => {
      const vehicleId = value === NO_SELECTION ? '' : (value as VehicleId);
      setFormState((previous) => ({ ...previous, vehicleId }));
    }, []),
    handleNotesChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
      const { value } = event.target;
      setFormState((previous) => ({ ...previous, notes: value }));
      setErrors((previous) =>
        previous.notes ? { ...previous, notes: undefined } : previous,
      );
    }, []);

  const {
    isSubmitting,
    submitError,
    handleSubmit: doSubmit,
  } = useFormSubmission<RideFormData>(onSubmit);

  /**
   * Maps a schema rejection onto the fields, translated.
   *
   * Zod's own messages are English-only, so they never reach the screen. The
   * fields the form does not render fall back to one general message rather
   * than being swallowed — a refused save with nothing on screen is worse than
   * a vague one.
   */
  const mapSchemaIssues = useCallback(
    (paths: readonly string[]): FormErrors => {
      const next: FormErrors = {};

      for (const path of paths) {
        if (path === 'location') {
          next.location ??= t('rides.errors.locationTooLong');
        } else if (path === 'meetDatetime') {
          next.meetDatetime ??= t('validation.invalidDate');
        } else if (path === 'leadTimeMinutes') {
          next.leadTimeMinutes ??= t('rides.errors.invalidLeadTime', {
            min: MIN_LEAD_TIME_MINUTES,
            max: MAX_LEAD_TIME_MINUTES,
          });
        } else if (path === 'notes') {
          next.notes ??= t('rides.errors.notesTooLong');
        } else {
          next.form ??= t('errors.generic');
        }
      }

      return next;
    },
    [t],
  );

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();

      const meetDatetime = toISODatetime(formState.meetDatetime),
        location = formState.location.trim(),
        leadTimeMinutes = parseLeadTime(formState.leadTimeMinutes),
        fieldErrors: FormErrors = {};

      if (!formState.meetDatetime) {
        fieldErrors.meetDatetime = t('common.required');
      } else if (!meetDatetime) {
        fieldErrors.meetDatetime = t('validation.invalidDate');
      }
      if (!location) {
        fieldErrors.location = t('common.required');
      }
      if (leadTimeMinutes === null) {
        fieldErrors.leadTimeMinutes = t('rides.errors.invalidLeadTime', {
          min: MIN_LEAD_TIME_MINUTES,
          max: MAX_LEAD_TIME_MINUTES,
        });
      }

      if (Object.keys(fieldErrors).length > 0) {
        setErrors(fieldErrors);
        return;
      }

      const data: RideFormData = {
        direction: formState.direction,
        meetDatetime,
        location,
        coordinates: formState.coordinates,
        leadTimeMinutes: leadTimeMinutes ?? undefined,
        driverId: formState.driverId || undefined,
        vehicleId: formState.vehicleId || undefined,
        notes: formState.notes.trim() || undefined,
      };

      // The schema is the gate, not a second opinion: the checks above exist to
      // name the field in the user's language, and anything they missed —
      // a pasted 400-character place name, coordinates off the globe — is
      // refused here rather than written.
      const parsed = RideFormDataSchema.safeParse(data);
      if (!parsed.success) {
        setErrors(
          mapSchemaIssues(parsed.error.issues.map((issue) => String(issue.path[0]))),
        );
        return;
      }

      // Identity-stable when there was nothing to clear, so a submit from a
      // clean form does not re-render every field.
      setErrors((previous) =>
        Object.keys(previous).length === 0 ? previous : {},
      );

      try {
        await doSubmit(data);
      } catch {
        // Surfaced by useFormSubmission through submitError
      }
    },
    [formState, t, mapSchemaIssues, doSubmit],
  );

  // ============================================================================
  // Render
  // ============================================================================

  const leadTimeDescribedBy =
    [
      errors.leadTimeMinutes ? 'ride-lead-time-error' : undefined,
      remembered === undefined ? undefined : 'ride-lead-time-hint',
    ]
      .filter((id): id is string => id !== undefined)
      .join(' ') || undefined;

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {/* Direction */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium leading-none">
          {t('rides.direction')}
          <span className="text-destructive ml-1" aria-hidden="true">
            *
          </span>
        </legend>
        <RadioGroup
          value={formState.direction}
          onValueChange={handleDirectionChange}
          disabled={isSubmitting}
          className="flex flex-row gap-6"
        >
          {RIDE_DIRECTIONS.map((direction) => (
            <div key={direction} className="flex items-center gap-2">
              <RadioGroupItem value={direction} id={`ride-direction-${direction}`} />
              <Label
                htmlFor={`ride-direction-${direction}`}
                className="font-normal cursor-pointer"
              >
                {t(DIRECTION_LABEL_KEYS[direction])}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </fieldset>

      {/* Meeting time */}
      <div className="space-y-2">
        <Label htmlFor="ride-meet-datetime">
          {t('rides.meetDatetime')}
          <span className="text-destructive ml-1" aria-hidden="true">
            *
          </span>
        </Label>
        <Input
          id="ride-meet-datetime"
          type="datetime-local"
          value={formState.meetDatetime}
          onChange={handleMeetDatetimeChange}
          aria-invalid={Boolean(errors.meetDatetime)}
          aria-describedby={errors.meetDatetime ? 'ride-meet-datetime-error' : undefined}
          disabled={isSubmitting}
          className="w-full sm:w-auto"
        />
        {errors.meetDatetime && (
          <p id="ride-meet-datetime-error" className="text-sm text-destructive" role="alert">
            {errors.meetDatetime}
          </p>
        )}
      </div>

      {/* Meeting point */}
      <div className="space-y-2">
        <Label htmlFor="ride-location">
          {t('rides.location')}
          <span className="text-destructive ml-1" aria-hidden="true">
            *
          </span>
        </Label>
        <LocationPicker
          id="ride-location"
          value={formState.location}
          onChange={handleLocationChange}
          placeholder={t('rides.locationPlaceholder')}
          hasError={Boolean(errors.location)}
          aria-label={t('rides.location')}
          disabled={isSubmitting}
        />
        {errors.location && (
          <p id="ride-location-error" className="text-sm text-destructive" role="alert">
            {errors.location}
          </p>
        )}
      </div>

      {/* Lead time */}
      <div className="space-y-2">
        <Label htmlFor="ride-lead-time">
          {t('rides.leadTime', { count: leadTimeCount })}
        </Label>
        <Input
          id="ride-lead-time"
          type="number"
          inputMode="numeric"
          min={MIN_LEAD_TIME_MINUTES}
          max={MAX_LEAD_TIME_MINUTES}
          step={1}
          value={formState.leadTimeMinutes}
          onChange={handleLeadTimeChange}
          aria-invalid={Boolean(errors.leadTimeMinutes)}
          aria-describedby={leadTimeDescribedBy}
          disabled={isSubmitting}
          className="w-full sm:w-40"
        />
        {remembered !== undefined && (
          <p id="ride-lead-time-hint" className="text-xs text-muted-foreground">
            {t('rides.leadTimeRemembered', { location: formState.location.trim() })}
          </p>
        )}
        {errors.leadTimeMinutes && (
          <p id="ride-lead-time-error" className="text-sm text-destructive" role="alert">
            {errors.leadTimeMinutes}
          </p>
        )}
      </div>

      {/* Driver — every guest, passengers included */}
      <div className="space-y-2">
        <Label htmlFor="ride-driver">{t('rides.driver')}</Label>
        <Select
          name="ride-driver"
          value={formState.driverId || NO_SELECTION}
          onValueChange={handleDriverChange}
          disabled={isSubmitting || persons.length === 0}
        >
          <SelectTrigger id="ride-driver" className="w-full">
            <SelectValue placeholder={t('rides.noDriver')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_SELECTION}>{t('rides.noDriver')}</SelectItem>
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
        {isSelfDriven && (
          <p className="text-sm text-muted-foreground">{t('rides.selfDriven')}</p>
        )}
        {persons.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('persons.empty')}</p>
        )}
      </div>

      {/* Car */}
      <div className="space-y-2">
        <Label htmlFor="ride-vehicle">{t('rides.vehicle')}</Label>
        <Select
          name="ride-vehicle"
          value={formState.vehicleId || NO_SELECTION}
          onValueChange={handleVehicleChange}
          disabled={isSubmitting || vehicles.length === 0}
        >
          <SelectTrigger id="ride-vehicle" className="w-full">
            <SelectValue placeholder={t('rides.noVehicle')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_SELECTION}>{t('rides.noVehicle')}</SelectItem>
            {vehicles.map((vehicle) => (
              <SelectItem key={vehicle.id} value={vehicle.id}>
                {vehicle.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {vehicles.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('vehicles.noVehicles')}</p>
        )}
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <Label htmlFor="ride-notes">{t('transports.notes')}</Label>
        <Textarea
          id="ride-notes"
          value={formState.notes}
          onChange={handleNotesChange}
          placeholder={t('transports.notesPlaceholder')}
          aria-invalid={Boolean(errors.notes)}
          aria-describedby={errors.notes ? 'ride-notes-error' : undefined}
          disabled={isSubmitting}
          rows={3}
        />
        {errors.notes && (
          <p id="ride-notes-error" className="text-sm text-destructive" role="alert">
            {errors.notes}
          </p>
        )}
      </div>

      {/* Whole-form failure */}
      {(errors.form ?? submitError) && (
        <div
          className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {errors.form ?? submitError}
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

export { RideForm };
