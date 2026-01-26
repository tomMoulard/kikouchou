/**
 * @fileoverview Room Form Component for creating and editing rooms.
 * Provides form validation, controlled inputs, and handles submission with loading states.
 *
 * @module features/rooms/components/RoomForm
 * @see TripForm.tsx for reference implementation pattern
 */

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { Room, RoomFormData } from '@/types';

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
  readonly onSubmit: (data: RoomFormData) => Promise<void>;
  /** Callback when cancel button is clicked. */
  readonly onCancel: () => void;
}

/**
 * Form validation errors.
 */
interface FormErrors {
  name?: string;
  capacity?: string;
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

// ============================================================================
// Component
// ============================================================================

/**
 * Room form component for creating and editing rooms.
 *
 * Features:
 * - Controlled form inputs for name, capacity, and description
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
}: RoomFormProps) {
  const { t } = useTranslation();

  // ============================================================================
  // Form State
  // ============================================================================

  // Form field values
  const [name, setName] = useState(room?.name ?? '');
  const [capacity, setCapacity] = useState<number>(room?.capacity ?? DEFAULT_CAPACITY);
  const [description, setDescription] = useState(room?.description ?? '');

  // Validation errors
  const [errors, setErrors] = useState<FormErrors>({});

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Refs for preventing race conditions and memory leaks
  const isSubmittingRef = useRef(false);
  const isMountedRef = useRef(true);

  // ============================================================================
  // Lifecycle Effects
  // ============================================================================

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Sync form state when room prop changes (for edit mode navigation)
  useEffect(() => {
    setName(room?.name ?? '');
    setCapacity(room?.capacity ?? DEFAULT_CAPACITY);
    setDescription(room?.description ?? '');
    setErrors({});
    setSubmitError(null);
  }, [room?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- Only sync on room.id change

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

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, capacity, validateName, validateCapacity]);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles name input change.
   * Uses functional update to avoid dependency on error state.
   */
  const handleNameChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
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
   * Handles capacity input change.
   * Allows user to type freely, validation happens on blur and submit.
   */
  const handleCapacityChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const rawValue = e.target.value;
      
      // Allow empty input temporarily (user is clearing to type new value)
      if (rawValue === '') {
        setCapacity(MIN_CAPACITY);
        return;
      }
      
      // Parse to integer and enforce minimum
      const parsed = parseInt(rawValue, 10);
      if (!isNaN(parsed)) {
        setCapacity(Math.max(MIN_CAPACITY, parsed));
      }
      
      // Clear error when user changes value (functional update)
      setErrors((prev) => (prev.capacity ? { ...prev, capacity: undefined } : prev));
    },
    [],
  );

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
   * Handles form submission.
   * Uses refs for synchronous guard (prevents race condition) and unmount safety.
   */
  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();

      // Prevent double submission using ref for synchronous check
      if (isSubmittingRef.current) return;

      // Validate form
      if (!validateForm()) return;

      isSubmittingRef.current = true;
      setIsSubmitting(true);
      setSubmitError(null);

      try {
        await onSubmit({
          name: name.trim(),
          capacity,
          description: description.trim() || undefined,
        });
        // Success - parent component handles navigation
      } catch (error) {
        console.error('Failed to save room:', error);
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
    [validateForm, onSubmit, name, capacity, description, t],
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
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? 'room-name-error' : undefined}
          disabled={isSubmitting}
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

      {/* Capacity Field */}
      <div className="space-y-2">
        <Label htmlFor="room-capacity">
          {t('rooms.capacity')}
          <span className="text-destructive ml-1" aria-hidden="true">*</span>
        </Label>
        <Input
          id="room-capacity"
          type="number"
          min={MIN_CAPACITY}
          value={capacity}
          onChange={handleCapacityChange}
          onBlur={handleCapacityBlur}
          aria-invalid={!!errors.capacity}
          aria-describedby={errors.capacity ? 'room-capacity-error' : undefined}
          disabled={isSubmitting}
          className={cn(
            'w-full sm:w-32',
            errors.capacity && 'border-destructive',
          )}
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

RoomForm.displayName = 'RoomForm';

// ============================================================================
// Exports
// ============================================================================

export { RoomForm };
export type { RoomFormProps };
