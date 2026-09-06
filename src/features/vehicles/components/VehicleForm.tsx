/**
 * @fileoverview Form for creating and editing one of the trip's cars.
 *
 * Every capacity field here is optional on purpose. A car nobody has measured
 * still earns its place — it names itself on a ride card — and an empty seat
 * count means "not measured", never zero: a warning raised against a limit
 * nobody entered is a warning about nothing, and the only way to silence it
 * would be to make everyone type a number they may not know.
 *
 * The child restraints are counted, not ticked. Two boosters in one car is the
 * ordinary case for a family, and a checkbox per kind cannot say it — so each
 * kind gets a stepper and the stored value is one entry per seat.
 *
 * @module features/vehicles/components/VehicleForm
 * @see GuestGroupForm.tsx for the inline-list pattern this follows
 * @see TransportForm.tsx for the guest select
 */

import {
  type ChangeEvent,
  type FormEvent,
  type ReactElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Plus } from 'lucide-react';

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
import { useFormSubmission } from '@/hooks';
import { MAX_LENGTHS } from '@/lib/db/sanitize';
import {
  CHILD_SEAT_KINDS,
  MAX_VEHICLE_SEAT_COUNT,
  MIN_VEHICLE_SEAT_COUNT,
} from '@/types';
import type {
  ChildSeatKind,
  Person,
  PersonId,
  Vehicle,
  VehicleFormData,
} from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for {@link VehicleForm}.
 */
export interface VehicleFormProps {
  /** Existing car for edit mode. Undefined means create. */
  readonly vehicle?: Vehicle;
  /** The trip's guests, offered as owners. */
  readonly persons: readonly Person[];
  /** Called with validated data on submit. */
  readonly onSubmit: (data: VehicleFormData) => Promise<void>;
  /** Called when the user cancels. */
  readonly onCancel: () => void;
  /** Called when the dirty state changes, for the unsaved-changes guard. */
  readonly onDirtyChange?: (isDirty: boolean) => void;
}

/**
 * How many restraints of each kind travel in this car.
 *
 * A `Record` over the union rather than a counted array: the form edits a
 * tally, the entity stores one entry per seat, and {@link expandTally} is the
 * single place the two shapes meet. Written out longhand so that adding a
 * fourth {@link ChildSeatKind} fails to compile here rather than silently
 * dropping that kind from the form.
 */
type ChildSeatTally = Record<ChildSeatKind, number>;

/** Field-level validation messages. */
interface FormErrors {
  name?: string;
  seatCount?: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Sentinel for "no owner" in the guest select.
 *
 * Radix refuses an empty `SelectItem` value, so the absence of a choice needs
 * a value of its own — the same sentinel `TransportForm` uses.
 */
const NO_OWNER = '__none__';

// ============================================================================
// Helper Functions
// ============================================================================

/** A tally with nothing in it. */
function emptyTally(): ChildSeatTally {
  return { rearFacing: 0, forwardFacing: 0, booster: 0 };
}

/** The stored one-entry-per-seat list as a tally. */
function tallyChildSeats(
  childSeats: readonly ChildSeatKind[] | undefined,
): ChildSeatTally {
  const tally = emptyTally();

  for (const kind of childSeats ?? []) {
    tally[kind] += 1;
  }

  return tally;
}

/**
 * The tally back as one entry per seat, in {@link CHILD_SEAT_KINDS} order.
 *
 * Bounded by the stepper, which is what keeps `Array.from({ length })` safe
 * here: an unbounded count reaching that call is how this codebase once OOM'd
 * a tab permanently.
 */
function expandTally(tally: ChildSeatTally): ChildSeatKind[] {
  return CHILD_SEAT_KINDS.flatMap((kind) =>
    Array.from({ length: tally[kind] }, () => kind),
  );
}

/** How many restraints the car carries in total. */
function totalChildSeats(tally: ChildSeatTally): number {
  return CHILD_SEAT_KINDS.reduce((total, kind) => total + tally[kind], 0);
}

/** The stored car as editable strings. */
function toSeatCountField(vehicle: Vehicle | undefined): string {
  return vehicle?.seatCount === undefined ? '' : String(vehicle.seatCount);
}

/** A comparable snapshot, for the dirty check. */
function snapshot(
  name: string,
  ownerId: string,
  isRental: boolean,
  seatCount: string,
  tally: ChildSeatTally,
  luggageNotes: string,
  notes: string,
): string {
  return JSON.stringify([
    name.trim(),
    ownerId,
    isRental,
    seatCount.trim(),
    expandTally(tally),
    luggageNotes.trim(),
    notes.trim(),
  ]);
}

// ============================================================================
// Component
// ============================================================================

/**
 * Vehicle form.
 *
 * @param props - Component props
 * @returns The form element
 *
 * @example
 * ```tsx
 * <VehicleForm
 *   vehicle={editing}
 *   persons={persons}
 *   onSubmit={async (data) => await updateVehicle(editing.id, data)}
 *   onCancel={close}
 * />
 * ```
 */
const VehicleForm = memo(function VehicleForm({
  vehicle,
  persons,
  onSubmit,
  onCancel,
  onDirtyChange,
}: VehicleFormProps): ReactElement {
  const { t } = useTranslation();

  const [name, setName] = useState(vehicle?.name ?? '');
  const [ownerId, setOwnerId] = useState<string>(vehicle?.ownerId ?? NO_OWNER);
  const [isRental, setIsRental] = useState(vehicle?.isRental ?? false);
  const [seatCount, setSeatCount] = useState(() => toSeatCountField(vehicle));
  const [childSeats, setChildSeats] = useState<ChildSeatTally>(() =>
    tallyChildSeats(vehicle?.childSeats),
  );
  const [luggageNotes, setLuggageNotes] = useState(vehicle?.luggageNotes ?? '');
  const [notes, setNotes] = useState(vehicle?.notes ?? '');
  const [errors, setErrors] = useState<FormErrors>({});
  const [initial, setInitial] = useState<string>(() =>
    snapshot(
      vehicle?.name ?? '',
      vehicle?.ownerId ?? NO_OWNER,
      vehicle?.isRental ?? false,
      toSeatCountField(vehicle),
      tallyChildSeats(vehicle?.childSeats),
      vehicle?.luggageNotes ?? '',
      vehicle?.notes ?? '',
    ),
  );

  const isDirty = useMemo(
    () =>
      snapshot(name, ownerId, isRental, seatCount, childSeats, luggageNotes, notes) !==
      initial,
    [childSeats, initial, isRental, luggageNotes, name, notes, ownerId, seatCount],
  );

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // Re-seed when a different car is opened in the same mounted dialog.
  useEffect(() => {
    const nextName = vehicle?.name ?? '',
      nextOwnerId = vehicle?.ownerId ?? NO_OWNER,
      nextIsRental = vehicle?.isRental ?? false,
      nextSeatCount = toSeatCountField(vehicle),
      nextChildSeats = tallyChildSeats(vehicle?.childSeats),
      nextLuggageNotes = vehicle?.luggageNotes ?? '',
      nextNotes = vehicle?.notes ?? '';

    setName(nextName);
    setOwnerId(nextOwnerId);
    setIsRental(nextIsRental);
    setSeatCount(nextSeatCount);
    setChildSeats(nextChildSeats);
    setLuggageNotes(nextLuggageNotes);
    setNotes(nextNotes);
    setInitial(
      snapshot(
        nextName,
        nextOwnerId,
        nextIsRental,
        nextSeatCount,
        nextChildSeats,
        nextLuggageNotes,
        nextNotes,
      ),
    );
    setErrors((prev) => (Object.keys(prev).length === 0 ? prev : {}));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Keyed on the car's identity: re-seeding on every prop reference would discard what the user is typing.
  }, [vehicle?.id]);

  const {
    isSubmitting,
    submitError,
    handleSubmit: doSubmit,
  } = useFormSubmission<VehicleFormData>(onSubmit);

  const seatTotal = useMemo(() => totalChildSeats(childSeats), [childSeats]);

  /**
   * Whether the stored owner is somebody this device knows about.
   *
   * `deletePerson` clears the `ownerId` of every car the guest owned, so a
   * dangling id is not what a local delete leaves behind. It is what a car
   * arriving over sync can carry: the row names a guest whose own record has
   * not been projected yet, or was deleted on the other device. Without this
   * the select renders blank with no explanation, and saving would quietly
   * keep the id.
   */
  const ownerExists = useMemo(
    () => ownerId === NO_OWNER || persons.some((person) => person.id === ownerId),
    [ownerId, persons],
  );

  // ============================================================================
  // Event Handlers
  // ============================================================================

  const handleNameChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setName(event.target.value);
    setErrors((prev) => (prev.name ? { ...prev, name: undefined } : prev));
  }, []);

  const handleSeatCountChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setSeatCount(event.target.value);
    setErrors((prev) => (prev.seatCount ? { ...prev, seatCount: undefined } : prev));
  }, []);

  const handleChildSeatChange = useCallback((kind: ChildSeatKind, delta: number) => {
    setChildSeats((prev) => {
      const next = Math.max(0, prev[kind] + delta);

      if (next === prev[kind]) {
        return prev;
      }
      // The cap is on the whole car, not on one kind: `childSeats` is stored as
      // one entry per seat and the schema bounds that array.
      if (delta > 0 && totalChildSeats(prev) >= MAX_VEHICLE_SEAT_COUNT) {
        return prev;
      }

      return { ...prev, [kind]: next };
    });
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();

      const nextErrors: FormErrors = {},
        trimmedName = name.trim(),
        trimmedSeatCount = seatCount.trim();
      let seats: number | undefined;

      if (trimmedName.length === 0) {
        nextErrors.name = t('common.required');
      }

      // An empty field means "not measured", so it is only parsed when it has
      // something in it — `Number('')` is 0, which would read as a car with no
      // seats at all.
      if (trimmedSeatCount.length > 0) {
        const parsed = Number(trimmedSeatCount);

        if (
          !Number.isInteger(parsed) ||
          parsed < MIN_VEHICLE_SEAT_COUNT ||
          parsed > MAX_VEHICLE_SEAT_COUNT
        ) {
          nextErrors.seatCount = t('vehicles.seatCountInvalid', {
            min: MIN_VEHICLE_SEAT_COUNT,
            max: MAX_VEHICLE_SEAT_COUNT,
          });
        } else {
          seats = parsed;
        }
      }

      setErrors(nextErrors);
      if (Object.keys(nextErrors).length > 0) {
        return;
      }

      const expanded = expandTally(childSeats),
        trimmedLuggage = luggageNotes.trim(),
        trimmedNotes = notes.trim();

      try {
        // Every optional key is present, `undefined` when empty: the update
        // repository only clears a field it is handed, so omitting the key
        // would make "delete the luggage note" a no-op.
        await doSubmit({
          name: trimmedName,
          ownerId: ownerId === NO_OWNER ? undefined : (ownerId as PersonId),
          isRental: isRental ? true : undefined,
          seatCount: seats,
          childSeats: expanded.length > 0 ? expanded : undefined,
          luggageNotes: trimmedLuggage.length > 0 ? trimmedLuggage : undefined,
          notes: trimmedNotes.length > 0 ? trimmedNotes : undefined,
        });
      } catch {
        // Reported through `submitError` by useFormSubmission.
      }
    },
    [childSeats, doSubmit, isRental, luggageNotes, name, notes, ownerId, seatCount, t],
  );

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {/* Name */}
      <div className="space-y-2">
        <Label htmlFor="vehicle-name">
          {t('vehicles.name')}
          <span className="text-destructive ml-1" aria-hidden="true">
            *
          </span>
        </Label>
        <Input
          id="vehicle-name"
          type="text"
          value={name}
          onChange={handleNameChange}
          maxLength={MAX_LENGTHS.vehicleName}
          placeholder={t('vehicles.namePlaceholder')}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? 'vehicle-name-error' : undefined}
          disabled={isSubmitting}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- The first control of a form the user has just chosen to open; without it focus stays on the dialog's close button.
          autoFocus
        />
        {errors.name && (
          <p id="vehicle-name-error" className="text-sm text-destructive" role="alert">
            {errors.name}
          </p>
        )}
      </div>

      {/* Owner */}
      <div className="space-y-2">
        <Label htmlFor="vehicle-owner">{t('vehicles.owner')}</Label>
        <Select
          value={ownerId}
          onValueChange={setOwnerId}
          disabled={isSubmitting}
        >
          <SelectTrigger id="vehicle-owner" className="w-full">
            <SelectValue placeholder={t('vehicles.noOwner')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_OWNER}>{t('vehicles.noOwner')}</SelectItem>
            {/*
              An owner this device cannot resolve gets an item of its own so
              that the trigger says what is stored. Without it Radix finds no
              matching item, falls back to the placeholder, and the control
              reads "Nobody in particular" over a car that names somebody —
              after which saving writes the id back under a label that denied
              it existed.
            */}
            {!ownerExists && (
              <SelectItem value={ownerId}>{t('vehicles.unknownOwner')}</SelectItem>
            )}
            {persons.map((person) => (
              <SelectItem key={person.id} value={person.id}>
                <span className="flex items-center gap-2">
                  <span
                    className="size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: person.color }}
                    aria-hidden="true"
                  />
                  {person.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t('vehicles.ownerHint')}</p>
        {!ownerExists && (
          // Explanation, not a validation error: the guest is missing from this
          // device, not from the world, and blocking the save would stop
          // somebody renaming a car until an unrelated row turns up.
          <p className="text-xs text-muted-foreground">
            {t('vehicles.unknownOwnerHint')}
          </p>
        )}
      </div>

      {/* Hire car */}
      <div className="flex items-center justify-between gap-4 rounded-md border p-3">
        <div className="space-y-1">
          <Label htmlFor="vehicle-rental">{t('vehicles.rental')}</Label>
          <p className="text-xs text-muted-foreground">{t('vehicles.rentalHint')}</p>
        </div>
        <Switch
          id="vehicle-rental"
          checked={isRental}
          onCheckedChange={setIsRental}
          disabled={isSubmitting}
        />
      </div>

      {/* Seats */}
      <div className="space-y-2">
        <Label htmlFor="vehicle-seat-count">{t('vehicles.seatCount')}</Label>
        <Input
          id="vehicle-seat-count"
          type="number"
          inputMode="numeric"
          min={MIN_VEHICLE_SEAT_COUNT}
          max={MAX_VEHICLE_SEAT_COUNT}
          step={1}
          value={seatCount}
          onChange={handleSeatCountChange}
          placeholder={t('vehicles.seatsUnknown')}
          aria-invalid={Boolean(errors.seatCount)}
          aria-describedby={
            errors.seatCount ? 'vehicle-seat-count-error' : 'vehicle-seat-count-hint'
          }
          disabled={isSubmitting}
          className="w-full sm:w-32"
        />
        <p id="vehicle-seat-count-hint" className="text-xs text-muted-foreground">
          {t('vehicles.seatCountHint')}
        </p>
        {errors.seatCount && (
          <p
            id="vehicle-seat-count-error"
            className="text-sm text-destructive"
            role="alert"
          >
            {errors.seatCount}
          </p>
        )}
      </div>

      {/* Child seats — one stepper per kind, because two boosters is ordinary */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium leading-none">
          {t('vehicles.childSeats')}
        </legend>
        <p className="text-xs text-muted-foreground">{t('vehicles.childSeatsHint')}</p>

        <div className="space-y-2">
          {CHILD_SEAT_KINDS.map((kind) => {
            const kindLabel = t(`childSeats.${kind}`),
              count = childSeats[kind];

            return (
              <div
                key={kind}
                className="flex items-center justify-between gap-3 rounded-md border p-2"
                role="group"
                aria-label={kindLabel}
              >
                <span className="text-sm">{kindLabel}</span>
                <span className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => handleChildSeatChange(kind, -1)}
                    disabled={isSubmitting || count === 0}
                    aria-label={t('vehicles.removeChildSeat', { kind: kindLabel })}
                  >
                    <Minus className="size-4" aria-hidden="true" />
                  </Button>
                  <output
                    className="w-6 text-center text-sm tabular-nums"
                    aria-label={t('vehicles.childSeatCount', { kind: kindLabel })}
                  >
                    {count}
                  </output>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => handleChildSeatChange(kind, 1)}
                    disabled={isSubmitting || seatTotal >= MAX_VEHICLE_SEAT_COUNT}
                    aria-label={t('vehicles.addChildSeat', { kind: kindLabel })}
                  >
                    <Plus className="size-4" aria-hidden="true" />
                  </Button>
                </span>
              </div>
            );
          })}
        </div>

        {seatTotal >= MAX_VEHICLE_SEAT_COUNT && (
          <p className="text-xs text-muted-foreground">
            {t('vehicles.childSeatsFull', { count: MAX_VEHICLE_SEAT_COUNT })}
          </p>
        )}
      </fieldset>

      {/* Luggage — free text, counted against nothing */}
      <div className="space-y-2">
        <Label htmlFor="vehicle-luggage">{t('vehicles.luggageNotes')}</Label>
        <Textarea
          id="vehicle-luggage"
          value={luggageNotes}
          onChange={(event) => setLuggageNotes(event.target.value)}
          maxLength={MAX_LENGTHS.vehicleLuggageNotes}
          placeholder={t('vehicles.luggageNotesPlaceholder')}
          disabled={isSubmitting}
          rows={2}
          className="resize-y"
        />
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <Label htmlFor="vehicle-notes">{t('vehicles.notes')}</Label>
        <Textarea
          id="vehicle-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={MAX_LENGTHS.vehicleNotes}
          placeholder={t('vehicles.notesPlaceholder')}
          disabled={isSubmitting}
          rows={2}
          className="resize-y"
        />
      </div>

      {submitError && (
        <div
          className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {submitError}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
        >
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

export { VehicleForm };
