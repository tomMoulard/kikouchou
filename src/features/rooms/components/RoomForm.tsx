/**
 * @fileoverview Room Form Component for creating and editing rooms.
 * Provides form validation, controlled inputs, and handles submission with loading states.
 *
 * @module features/rooms/components/RoomForm
 * @see TripForm.tsx for reference implementation pattern
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

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberStepper } from '@/components/ui/number-stepper';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RoomIconPicker } from '@/components/shared/RoomIconPicker';
import { buildBulkRoomNames } from '@/features/rooms/utils/room-naming';
import { MAX_ROOMS_PER_SAVE } from '@/lib/db';
import { cn } from '@/lib/utils';
import type { Room, RoomFormSubmission, RoomIcon } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the RoomForm component.
 */
interface RoomFormProps {
  /** Existing room for edit mode. If undefined, form is in create mode. */
  readonly room?: Room;
  /** Callback when form is successfully submitted with validated data. */
  readonly onSubmit: (data: RoomFormSubmission) => Promise<void>;
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
  capacity?: string;
  count?: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default capacity for new rooms.
 */
const DEFAULT_CAPACITY = 1;

/**
 * Minimum allowed capacity for a room.
 */
const MIN_CAPACITY = 1;

/**
 * How many rooms one save creates by default.
 */
const DEFAULT_COUNT = 1;

/**
 * Minimum number of rooms one save creates.
 */
const MIN_COUNT = 1;

// ============================================================================
// Component
// ============================================================================

/**
 * Room form component for creating and editing rooms.
 *
 * Features:
 * - Controlled form inputs for name, capacity, and description
 * - Create mode also asks how many identical rooms to make, and previews the
 *   names they would take
 * - Validation on blur (name) and submit (all fields)
 * - Edit mode pre-fills existing room data
 * - Loading state during submission
 * - Error display for validation and submission errors
 * - Full accessibility support (ARIA attributes)
 *
 * @param props - Component props
 * @returns The room form element
 *
 * @example
 * ```tsx
 * // Create mode
 * <RoomForm
 *   onSubmit={async (data) => await createRoom(data)}
 *   onCancel={() => navigate(-1)}
 * />
 *
 * // Edit mode
 * <RoomForm
 *   room={existingRoom}
 *   onSubmit={async (data) => await updateRoom(room.id, data)}
 *   onCancel={() => navigate(-1)}
 * />
 * ```
 */
const RoomForm = memo(function RoomForm({
  room,
  onSubmit,
  onCancel,
  onDirtyChange,
}: RoomFormProps) {
  const { t } = useTranslation();

  // ============================================================================
  // Form State
  // ============================================================================

  // Form field values
  const [name, setName] = useState(room?.name ?? '');
  const [capacity, setCapacity] = useState<number>(room?.capacity ?? DEFAULT_CAPACITY);
  const [description, setDescription] = useState(room?.description ?? '');
  const [icon, setIcon] = useState<RoomIcon | undefined>(room?.icon);
  // How many identical rooms to create. Create mode only: editing one room and
  // asking "how many?" would mean something else entirely.
  const [count, setCount] = useState<number>(DEFAULT_COUNT);

  const isCreateMode = room === undefined;

  // Validation errors
  const [errors, setErrors] = useState<FormErrors>({});

  // Ref-based sync: reset form state when room.id changes (render-time, no effect needed)
  const prevRoomIdRef = useRef(room?.id);
  if (prevRoomIdRef.current !== room?.id) {
    prevRoomIdRef.current = room?.id;
    setName(room?.name ?? '');
    setCapacity(room?.capacity ?? DEFAULT_CAPACITY);
    setDescription(room?.description ?? '');
    setIcon(room?.icon);
    setCount(DEFAULT_COUNT);
    setErrors({});
  }

  // Compute dirty state
  const isDirty = useMemo(
    () =>
      name !== (room?.name ?? '') ||
      capacity !== (room?.capacity ?? DEFAULT_CAPACITY) ||
      description !== (room?.description ?? '') ||
      icon !== room?.icon ||
      count !== DEFAULT_COUNT,
    [name, capacity, description, icon, count, room],
  );

  // Notify parent of dirty state changes
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

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
   * Validates the capacity field.
   */
  const validateCapacity = useCallback(
    (value: number): string | undefined => {
      if (!Number.isInteger(value) || value < MIN_CAPACITY) {
        return t('validation.capacityMin', { min: MIN_CAPACITY, defaultValue: `Minimum ${MIN_CAPACITY} bed` });
      }
      return undefined;
    },
    [t],
  );

  /**
   * Validates how many rooms the save asks for.
   */
  const validateCount = useCallback(
    (value: number): string | undefined => {
      if (
        !Number.isInteger(value) ||
        value < MIN_COUNT ||
        value > MAX_ROOMS_PER_SAVE
      ) {
        return t('validation.roomCountRange', {
          min: MIN_COUNT,
          max: MAX_ROOMS_PER_SAVE,
          defaultValue: `Enter a number from ${MIN_COUNT} to ${MAX_ROOMS_PER_SAVE}`,
        });
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

    // Validate capacity
    const capacityError = validateCapacity(capacity);
    if (capacityError) {
      newErrors.capacity = capacityError;
    }

    // Validate the room count (create mode only)
    if (isCreateMode) {
      const countError = validateCount(count);
      if (countError) {
        newErrors.count = countError;
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [
    name,
    capacity,
    count,
    isCreateMode,
    validateName,
    validateCapacity,
    validateCount,
  ]);

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
   * Takes a new bed count from the stepper.
   *
   * The stepper only reports whole numbers at or above its `min`, so there is
   * nothing to re-parse or clamp here. This used to read the raw input and
   * clamp on every keystroke, which is what made the field fight back: clearing
   * it to type a new number refilled it with the minimum before the next digit
   * arrived, so 1 could only become 2 by typing around the existing digit.
   */
  const handleCapacityChange = useCallback((next: number) => {
    setCapacity(next);
    setErrors((prev) => (prev.capacity ? { ...prev, capacity: undefined } : prev));
  }, []);

  /**
   * Handles capacity input blur for validation.
   * Ensures value is valid and shows error if not.
   */
  const handleCapacityBlur = useCallback(() => {
    const error = validateCapacity(capacity);
    if (error) {
      setErrors((prev) => ({ ...prev, capacity: error }));
    }
  }, [capacity, validateCapacity]);

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
   * Handles icon selection change.
   */
  const handleIconChange = useCallback((newIcon: RoomIcon) => {
    setIcon(newIcon);
  }, []);

  /**
   * Takes a new room count from the stepper.
   */
  const handleCountChange = useCallback((next: number) => {
    setCount(next);
    setErrors((prev) => (prev.count ? { ...prev, count: undefined } : prev));
  }, []);

  /**
   * Handles room count blur for validation.
   */
  const handleCountBlur = useCallback(() => {
    const error = validateCount(count);
    if (error) {
      setErrors((prev) => ({ ...prev, count: error }));
    }
  }, [count, validateCount]);

  /**
   * The names this save would give the rooms, shown while the count is above
   * one so the numbering is not a surprise after the save.
   */
  const namePreview = useMemo((): string | undefined => {
    const trimmed = name.trim();
    if (!isCreateMode || count < 2 || !trimmed) {
      return undefined;
    }

    const names = buildBulkRoomNames(trimmed, count, []);
    return `${names[0] ?? ''} … ${names.at(-1) ?? ''}`;
  }, [isCreateMode, count, name]);

  /**
   * Submission handler via useFormSubmission hook.
   */
  const { isSubmitting, submitError, handleSubmit: doSubmit } = useFormSubmission<RoomFormSubmission>(
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
          capacity,
          description: description.trim() || undefined,
          icon,
          count: isCreateMode ? count : DEFAULT_COUNT,
        });
      } catch {
        // Error handled by useFormSubmission hook (sets submitError)
      }
    },
    [
      validateForm,
      doSubmit,
      name,
      capacity,
      description,
      icon,
      count,
      isCreateMode,
    ],
  );

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {/* Name Field */}
      <div className="space-y-2">
        <Label htmlFor="room-name">
          {t('rooms.name')}
          <span className="text-destructive ml-1" aria-hidden="true">*</span>
        </Label>
        <Input
          id="room-name"
          type="text"
          value={name}
          onChange={handleNameChange}
          onBlur={handleNameBlur}
          placeholder={t('rooms.namePlaceholder')}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? 'room-name-error' : undefined}
          disabled={isSubmitting}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- The first control of a form the user has just chosen to open. Without it focus stays on the trigger — or, in a dialog, on the close button — and the user tabs to reach the field they came for.
          autoFocus
        />
        {errors.name && (
          <p
            id="room-name-error"
            className="text-sm text-destructive"
            role="alert"
          >
            {errors.name}
          </p>
        )}
      </div>

      {/* Icon Field */}
      <RoomIconPicker
        id="room-icon"
        value={icon}
        onChange={handleIconChange}
        disabled={isSubmitting}
      />

      {/* Capacity Field */}
      <div className="space-y-2">
        <Label htmlFor="room-capacity">
          {t('rooms.capacity')}
          <span className="text-destructive ml-1" aria-hidden="true">*</span>
        </Label>
        <NumberStepper
          id="room-capacity"
          value={capacity}
          onValueChange={handleCapacityChange}
          onBlur={handleCapacityBlur}
          min={MIN_CAPACITY}
          decrementLabel={t('rooms.bedsDecrease', 'Remove a bed')}
          incrementLabel={t('rooms.bedsIncrease', 'Add a bed')}
          aria-invalid={Boolean(errors.capacity)}
          aria-describedby={errors.capacity ? 'room-capacity-error' : undefined}
          disabled={isSubmitting}
          className={cn(errors.capacity && 'border-destructive')}
        />
        {errors.capacity && (
          <p
            id="room-capacity-error"
            className="text-sm text-destructive"
            role="alert"
          >
            {errors.capacity}
          </p>
        )}
      </div>

      {/* How Many Rooms — create mode only */}
      {isCreateMode && (
        <div className="space-y-2">
          <Label htmlFor="room-count">{t('rooms.count')}</Label>
          <NumberStepper
            id="room-count"
            value={count}
            onValueChange={handleCountChange}
            onBlur={handleCountBlur}
            min={MIN_COUNT}
            max={MAX_ROOMS_PER_SAVE}
            decrementLabel={t('rooms.countDecrease', 'One room fewer')}
            incrementLabel={t('rooms.countIncrease', 'One room more')}
            aria-invalid={Boolean(errors.count)}
            aria-describedby={
              errors.count
                ? 'room-count-error'
                : namePreview
                  ? 'room-count-preview'
                  : undefined
            }
            disabled={isSubmitting}
            className={cn(errors.count && 'border-destructive')}
          />
          {errors.count ? (
            <p
              id="room-count-error"
              className="text-sm text-destructive"
              role="alert"
            >
              {errors.count}
            </p>
          ) : (
            namePreview && (
              <p id="room-count-preview" className="text-sm text-muted-foreground">
                {t('rooms.countPreview', {
                  names: namePreview,
                  defaultValue: 'Creates {{names}}',
                })}
              </p>
            )
          )}
        </div>
      )}

      {/* Description Field */}
      <div className="space-y-2">
        <Label htmlFor="room-description">{t('rooms.description')}</Label>
        <Textarea
          id="room-description"
          value={description}
          onChange={handleDescriptionChange}
          placeholder={t('rooms.descriptionPlaceholder')}
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

export { RoomForm };
export type { RoomFormProps };
