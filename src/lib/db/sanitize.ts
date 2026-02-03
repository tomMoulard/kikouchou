/**
 * Input Sanitization Utilities
 *
 * Provides functions to sanitize user-provided text input before storing in IndexedDB.
 * These functions help prevent data quality issues and ensure consistent data storage.
 *
 * Note: React already escapes output to prevent XSS. These functions focus on
 * data quality (trimming, length limits) rather than security.
 *
 * @module lib/db/sanitize
 */

// ============================================================================
// Constants - Maximum Lengths
// ============================================================================

/**
 * Maximum length constants for text fields.
 * These limits ensure consistent data storage and prevent excessive memory usage.
 */
export const MAX_LENGTHS = {
  /** Trip name (e.g., "Summer Vacation 2024") */
  tripName: 100,
  /** Trip location (e.g., "Beach House, Brittany") */
  tripLocation: 200,
  /** Room name (e.g., "Master Bedroom") */
  roomName: 100,
  /** Room description (e.g., "King bed with ensuite bathroom") */
  roomDescription: 500,
  /** Person name (e.g., "Marie Dupont") */
  personName: 100,
  /** Transport location (e.g., "Gare Montparnasse") */
  transportLocation: 200,
  /** Transport number (e.g., "TGV 8541") */
  transportNumber: 50,
  /** Transport notes */
  transportNotes: 1000,
} as const;

// ============================================================================
// Core Sanitization Functions
// ============================================================================

/**
 * Sanitizes a required text field by trimming whitespace and limiting length.
 *
 * @param value - The input string to sanitize
 * @param maxLength - Maximum allowed length
 * @returns Sanitized string
 *
 * @example
 * sanitizeText('  Hello World  ', 100) // 'Hello World'
 * sanitizeText('A'.repeat(200), 100)   // 'A'.repeat(100)
 */
export function sanitizeText(value: string, maxLength: number): string {
  return value.trim().substring(0, maxLength);
}

/**
 * Sanitizes an optional text field by trimming whitespace and limiting length.
 * Returns undefined if the input is undefined or empty after trimming.
 *
 * @param value - The optional input string to sanitize
 * @param maxLength - Maximum allowed length
 * @returns Sanitized string or undefined
 *
 * @example
 * sanitizeOptionalText('  Hello  ', 100)  // 'Hello'
 * sanitizeOptionalText('   ', 100)        // undefined
 * sanitizeOptionalText(undefined, 100)    // undefined
 */
export function sanitizeOptionalText(
  value: string | undefined,
  maxLength: number,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed.substring(0, maxLength);
}

// ============================================================================
// Entity-Specific Sanitization Functions
// ============================================================================

/**
 * Sanitizes trip form data.
 *
 * @param data - Trip form data to sanitize
 * @returns Sanitized trip form data
 */
export function sanitizeTripData<T extends { name: string; location?: string }>(
  data: T,
): T {
  return {
    ...data,
    name: sanitizeText(data.name, MAX_LENGTHS.tripName),
    location: sanitizeOptionalText(data.location, MAX_LENGTHS.tripLocation),
  };
}

/**
 * Sanitizes room form data.
 *
 * @param data - Room form data to sanitize
 * @returns Sanitized room form data
 */
export function sanitizeRoomData<T extends { name: string; description?: string }>(
  data: T,
): T {
  return {
    ...data,
    name: sanitizeText(data.name, MAX_LENGTHS.roomName),
    description: sanitizeOptionalText(data.description, MAX_LENGTHS.roomDescription),
  };
}

/**
 * Sanitizes person form data.
 *
 * @param data - Person form data to sanitize
 * @returns Sanitized person form data
 */
export function sanitizePersonData<T extends { name: string }>(data: T): T {
  return {
    ...data,
    name: sanitizeText(data.name, MAX_LENGTHS.personName),
  };
}

/**
 * Sanitizes transport form data.
 *
 * @param data - Transport form data to sanitize
 * @returns Sanitized transport form data
 */
export function sanitizeTransportData<
  T extends {
    location: string;
    transportNumber?: string;
    notes?: string;
  },
>(data: T): T {
  return {
    ...data,
    location: sanitizeText(data.location, MAX_LENGTHS.transportLocation),
    transportNumber: sanitizeOptionalText(data.transportNumber, MAX_LENGTHS.transportNumber),
    notes: sanitizeOptionalText(data.notes, MAX_LENGTHS.transportNotes),
  };
}
