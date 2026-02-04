/**
 * Validation utilities for Kikoushou form data.
 *
 * Provides type-safe validation functions that return either validated data
 * or structured error information. Uses Zod schemas for runtime validation.
 *
 * @module lib/validation
 *
 * @example
 * ```typescript
 * import { validateTripForm, isValidationError } from '@/lib/validation';
 *
 * const result = validateTripForm(formData);
 * if (isValidationError(result)) {
 *   // Handle validation errors
 *   console.log(result.errors);
 * } else {
 *   // Use validated data
 *   await createTrip(result);
 * }
 * ```
 */

import type { ZodError, ZodType } from 'zod';
import type {
  PersonFormData,
  RoomAssignmentFormData,
  RoomFormData,
  TransportFormData,
  TripFormData,
} from '@/types';

import {
  PersonFormDataSchema,
  RoomAssignmentFormDataSchema,
  RoomFormDataSchema,
  TransportFormDataSchema,
  TripFormDataSchema,
} from './schemas';

// Re-export schemas for direct usage
export {
  TripFormDataSchema,
  RoomFormDataSchema,
  PersonFormDataSchema,
  RoomAssignmentFormDataSchema,
  TransportFormDataSchema,
  // Primitive schemas
  isoDateStringSchema,
  isoDateTimeStringSchema,
  hexColorSchema,
  roomIconSchema,
  transportTypeSchema,
  transportModeSchema,
  coordinatesSchema,
  personIdSchema,
  roomIdSchema,
} from './schemas';

// Re-export input types
export type {
  TripFormDataInput,
  RoomFormDataInput,
  PersonFormDataInput,
  RoomAssignmentFormDataInput,
  TransportFormDataInput,
} from './schemas';

// ============================================================================
// Validation Result Types
// ============================================================================

/**
 * Represents a field-level validation error.
 */
export interface FieldError {
  /** The field path (e.g., 'name', 'startDate', 'coordinates.lat') */
  readonly path: string;
  /** Human-readable error message */
  readonly message: string;
}

/**
 * Represents a validation error result.
 */
export interface ValidationError {
  /** Discriminator for type narrowing */
  readonly success: false;
  /** Array of field-level errors */
  readonly errors: readonly FieldError[];
  /** Original Zod error for advanced usage */
  readonly zodError: ZodError;
}

/**
 * Represents a successful validation result.
 */
export interface ValidationSuccess<T> {
  /** Discriminator for type narrowing */
  readonly success: true;
  /** Validated and typed data */
  readonly data: T;
}

/**
 * Union type for validation results.
 */
export type ValidationResult<T> = ValidationSuccess<T> | ValidationError;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a validation result is an error.
 *
 * @param result - The validation result to check
 * @returns True if the result is a validation error
 *
 * @example
 * ```typescript
 * const result = validateTripForm(data);
 * if (isValidationError(result)) {
 *   result.errors.forEach(e => console.log(`${e.path}: ${e.message}`));
 * }
 * ```
 */
export function isValidationError<T>(
  result: ValidationResult<T>,
): result is ValidationError {
  return !result.success;
}

/**
 * Type guard to check if a validation result is successful.
 *
 * @param result - The validation result to check
 * @returns True if the result is a successful validation
 *
 * @example
 * ```typescript
 * const result = validateTripForm(data);
 * if (isValidationSuccess(result)) {
 *   await createTrip(result.data);
 * }
 * ```
 */
export function isValidationSuccess<T>(
  result: ValidationResult<T>,
): result is ValidationSuccess<T> {
  return result.success;
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Converts a Zod error to an array of field errors.
 */
function zodErrorToFieldErrors(error: ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || 'root',
    message: issue.message,
  }));
}

/**
 * Generic validation function using a Zod schema.
 */
function validate<T>(schema: ZodType<T>, data: unknown): ValidationResult<T> {
  const result = schema.safeParse(data);

  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }

  return {
    success: false,
    errors: zodErrorToFieldErrors(result.error),
    zodError: result.error,
  };
}

// ============================================================================
// Form Validation Functions
// ============================================================================

/**
 * Validates trip form data.
 *
 * @param data - Unknown data to validate
 * @returns Validation result with typed TripFormData or errors
 *
 * @example
 * ```typescript
 * const result = validateTripForm({
 *   name: 'Summer vacation',
 *   location: 'Beach house',
 *   startDate: '2024-07-15',
 *   endDate: '2024-07-22',
 * });
 *
 * if (result.success) {
 *   // result.data is typed as TripFormData
 *   await tripRepository.create(result.data);
 * }
 * ```
 */
export function validateTripForm(data: unknown): ValidationResult<TripFormData> {
  return validate(TripFormDataSchema, data);
}

/**
 * Validates room form data.
 *
 * @param data - Unknown data to validate
 * @returns Validation result with typed RoomFormData or errors
 *
 * @example
 * ```typescript
 * const result = validateRoomForm({
 *   name: 'Master bedroom',
 *   capacity: 2,
 *   icon: 'bed-double',
 * });
 * ```
 */
export function validateRoomForm(data: unknown): ValidationResult<RoomFormData> {
  return validate(RoomFormDataSchema, data);
}

/**
 * Validates person form data.
 *
 * @param data - Unknown data to validate
 * @returns Validation result with typed PersonFormData or errors
 *
 * @example
 * ```typescript
 * const result = validatePersonForm({
 *   name: 'Marie',
 *   color: '#ef4444',
 * });
 * ```
 */
export function validatePersonForm(
  data: unknown,
): ValidationResult<PersonFormData> {
  return validate(PersonFormDataSchema, data);
}

/**
 * Validates room assignment form data.
 *
 * @param data - Unknown data to validate
 * @returns Validation result with typed RoomAssignmentFormData or errors
 *
 * @example
 * ```typescript
 * const result = validateRoomAssignmentForm({
 *   roomId: 'room123',
 *   personId: 'person456',
 *   startDate: '2024-07-15',
 *   endDate: '2024-07-19',
 * });
 * ```
 */
export function validateRoomAssignmentForm(
  data: unknown,
): ValidationResult<RoomAssignmentFormData> {
  return validate(RoomAssignmentFormDataSchema, data);
}

/**
 * Validates transport form data.
 *
 * @param data - Unknown data to validate
 * @returns Validation result with typed TransportFormData or errors
 *
 * @example
 * ```typescript
 * const result = validateTransportForm({
 *   personId: 'person123',
 *   type: 'arrival',
 *   datetime: '2024-07-15T14:30:00.000Z',
 *   location: 'Gare Montparnasse',
 *   needsPickup: true,
 * });
 * ```
 */
export function validateTransportForm(
  data: unknown,
): ValidationResult<TransportFormData> {
  return validate(TransportFormDataSchema, data);
}

// ============================================================================
// Throwing Validation Functions
// ============================================================================

/**
 * Validation error class for throwing validation failures.
 */
export class FormValidationError extends Error {
  readonly errors: readonly FieldError[];
  readonly zodError: ZodError;

  constructor(validationError: ValidationError) {
    const firstError = validationError.errors[0];
    const message = firstError
      ? `Validation failed: ${firstError.path} - ${firstError.message}`
      : 'Validation failed';

    super(message);
    this.name = 'FormValidationError';
    this.errors = validationError.errors;
    this.zodError = validationError.zodError;
  }
}

/**
 * Validates trip form data and throws on failure.
 *
 * @param data - Unknown data to validate
 * @returns Validated TripFormData
 * @throws FormValidationError if validation fails
 *
 * @example
 * ```typescript
 * try {
 *   const tripData = validateTripFormOrThrow(untrustedData);
 *   await createTrip(tripData);
 * } catch (error) {
 *   if (error instanceof FormValidationError) {
 *     console.log('Validation errors:', error.errors);
 *   }
 * }
 * ```
 */
export function validateTripFormOrThrow(data: unknown): TripFormData {
  const result = validateTripForm(data);
  if (!result.success) {
    throw new FormValidationError(result);
  }
  return result.data;
}

/**
 * Validates room form data and throws on failure.
 *
 * @param data - Unknown data to validate
 * @returns Validated RoomFormData
 * @throws FormValidationError if validation fails
 */
export function validateRoomFormOrThrow(data: unknown): RoomFormData {
  const result = validateRoomForm(data);
  if (!result.success) {
    throw new FormValidationError(result);
  }
  return result.data;
}

/**
 * Validates person form data and throws on failure.
 *
 * @param data - Unknown data to validate
 * @returns Validated PersonFormData
 * @throws FormValidationError if validation fails
 */
export function validatePersonFormOrThrow(data: unknown): PersonFormData {
  const result = validatePersonForm(data);
  if (!result.success) {
    throw new FormValidationError(result);
  }
  return result.data;
}

/**
 * Validates room assignment form data and throws on failure.
 *
 * @param data - Unknown data to validate
 * @returns Validated RoomAssignmentFormData
 * @throws FormValidationError if validation fails
 */
export function validateRoomAssignmentFormOrThrow(
  data: unknown,
): RoomAssignmentFormData {
  const result = validateRoomAssignmentForm(data);
  if (!result.success) {
    throw new FormValidationError(result);
  }
  return result.data;
}

/**
 * Validates transport form data and throws on failure.
 *
 * @param data - Unknown data to validate
 * @returns Validated TransportFormData
 * @throws FormValidationError if validation fails
 */
export function validateTransportFormOrThrow(data: unknown): TransportFormData {
  const result = validateTransportForm(data);
  if (!result.success) {
    throw new FormValidationError(result);
  }
  return result.data;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Extracts error message for a specific field from validation errors.
 *
 * @param errors - Array of field errors
 * @param fieldPath - The field path to look for
 * @returns Error message if found, undefined otherwise
 *
 * @example
 * ```typescript
 * const result = validateTripForm(data);
 * if (!result.success) {
 *   const nameError = getFieldError(result.errors, 'name');
 *   const endDateError = getFieldError(result.errors, 'endDate');
 * }
 * ```
 */
export function getFieldError(
  errors: readonly FieldError[],
  fieldPath: string,
): string | undefined {
  const error = errors.find((e) => e.path === fieldPath);
  return error?.message;
}

/**
 * Converts validation errors to a map of field path to error message.
 *
 * @param errors - Array of field errors
 * @returns Record mapping field paths to error messages
 *
 * @example
 * ```typescript
 * const result = validateTripForm(data);
 * if (!result.success) {
 *   const errorMap = errorsToMap(result.errors);
 *   // { name: 'Name is required', endDate: 'End date must be after start date' }
 * }
 * ```
 */
export function errorsToMap(
  errors: readonly FieldError[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const error of errors) {
    // Only keep the first error per field
    if (!(error.path in map)) {
      map[error.path] = error.message;
    }
  }
  return map;
}
