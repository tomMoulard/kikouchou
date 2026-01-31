/**
 * @fileoverview Shared utility functions for context providers.
 * These utilities are used across multiple context files to ensure
 * consistent error handling and state management patterns.
 *
 * @module contexts/utils
 */

import type { Dispatch, SetStateAction } from 'react';

// ============================================================================
// Error Handling Utilities
// ============================================================================

/**
 * Wraps an unknown error in an Error object and sets it in state.
 * Used for consistent error handling across all context CRUD operations.
 *
 * @param err - The caught error (could be any type)
 * @param fallbackMessage - Message to use if err is not an Error instance
 * @param setError - React state setter for the error
 * @returns The wrapped Error object for re-throwing
 *
 * @example
 * ```typescript
 * try {
 *   await someDatabaseOperation();
 * } catch (err) {
 *   throw wrapAndSetError(err, 'Failed to perform operation', setError);
 * }
 * ```
 */
export function wrapAndSetError(
  err: unknown,
  fallbackMessage: string,
  setError: Dispatch<SetStateAction<Error | null>>,
): Error {
  const wrappedError =
    err instanceof Error ? err : new Error(fallbackMessage);
  setError(wrappedError);
  return wrappedError;
}

/**
 * Clears the error state only if it's not already null.
 * Uses functional update to avoid unnecessary renders and dependency issues.
 *
 * @param setError - React state setter for the error
 *
 * @example
 * ```typescript
 * // At the start of a CRUD operation
 * clearErrorIfNeeded(setError);
 * ```
 */
export function clearErrorIfNeeded(
  setError: Dispatch<SetStateAction<Error | null>>,
): void {
  setError((prev) => (prev === null ? prev : null));
}

// ============================================================================
// Array Comparison Utilities
// ============================================================================

/**
 * Generic array equality check using a custom comparison function.
 * Performs fast-path check for reference equality before element comparison.
 *
 * @param a - First array
 * @param b - Second array
 * @param compareFn - Function to compare individual elements
 * @returns True if arrays are equal according to the comparison function
 *
 * @example
 * ```typescript
 * const areEqual = areArraysEqual(rooms1, rooms2, (a, b) =>
 *   a.id === b.id && a.name === b.name
 * );
 * ```
 */
export function areArraysEqual<T>(
  a: T[],
  b: T[],
  compareFn: (itemA: T, itemB: T) => boolean,
): boolean {
  // Fast path: same reference means no change
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  return a.every((item, index) => {
    const other = b[index];
    return other !== undefined && compareFn(item, other);
  });
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a value is defined (not null or undefined).
 * Useful for filtering arrays while maintaining type safety.
 *
 * @param value - Value to check
 * @returns True if value is defined
 *
 * @example
 * ```typescript
 * const items = [1, null, 2, undefined, 3].filter(isDefined);
 * // items: number[] = [1, 2, 3]
 * ```
 */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
