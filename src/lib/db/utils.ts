/**
 * Database utility functions for the Kikoushou PWA
 *
 * Provides type-safe ID generation, timestamp utilities, and validation helpers.
 * All ID generation functions return properly branded types, encapsulating
 * type assertions internally so consumers never need to cast.
 *
 * @module lib/db/utils
 */

import { nanoid } from 'nanoid';
import type {
  TripId,
  RoomId,
  PersonId,
  RoomAssignmentId,
  TransportId,
  ShareId,
  UnixTimestamp,
  ISODateString,
  ISODateTimeString,
  HexColor,
} from '@/types';

// ============================================================================
// ID Generation Factory Functions
// ============================================================================

/**
 * Creates a new unique Trip ID.
 * @returns A branded TripId string (21 characters)
 * @example
 * const tripId = createTripId();
 * // tripId is typed as TripId, not string
 */
export const createTripId = (): TripId => nanoid() as TripId;

/**
 * Creates a new unique Room ID.
 * @returns A branded RoomId string (21 characters)
 * @example
 * const roomId = createRoomId();
 */
export const createRoomId = (): RoomId => nanoid() as RoomId;

/**
 * Creates a new unique Person ID.
 * @returns A branded PersonId string (21 characters)
 * @example
 * const personId = createPersonId();
 */
export const createPersonId = (): PersonId => nanoid() as PersonId;

/**
 * Creates a new unique Room Assignment ID.
 * @returns A branded RoomAssignmentId string (21 characters)
 * @example
 * const assignmentId = createRoomAssignmentId();
 */
export const createRoomAssignmentId = (): RoomAssignmentId =>
  nanoid() as RoomAssignmentId;

/**
 * Creates a new unique Transport ID.
 * @returns A branded TransportId string (21 characters)
 * @example
 * const transportId = createTransportId();
 */
export const createTransportId = (): TransportId => nanoid() as TransportId;

/**
 * Creates a new unique Share ID for trip sharing URLs.
 * Shorter than regular IDs (10 characters) for convenience in URLs/QR codes.
 * @returns A branded ShareId string (10 characters)
 * @example
 * const shareId = createShareId();
 * // Use in URL: `/share/${shareId}`
 */
export const createShareId = (): ShareId => nanoid(10) as ShareId;

/**
 * Generates a raw unique ID string.
 * Use this only for non-branded ID needs. For entity IDs,
 * prefer the type-safe factory functions above.
 * @returns A unique string (21 characters)
 * @example
 * const id = generateId();
 */
export const generateId = (): string => nanoid();

// ============================================================================
// Timestamp Utilities
// ============================================================================

/**
 * Returns the current Unix timestamp in milliseconds.
 * @returns Current time as UnixTimestamp
 * @example
 * const timestamp = now();
 * // timestamp is typed as UnixTimestamp
 */
export const now = (): UnixTimestamp => Date.now() as UnixTimestamp;

/**
 * Converts a Date object to a Unix timestamp.
 * @param date - The Date to convert (must be a valid Date)
 * @returns Unix timestamp in milliseconds
 * @throws Error if date is invalid
 * @example
 * const timestamp = toUnixTimestamp(new Date('2024-07-15'));
 */
export const toUnixTimestamp = (date: Date): UnixTimestamp => {
  const time = date.getTime();
  if (isNaN(time)) {
    throw new Error('Invalid Date passed to toUnixTimestamp');
  }
  return time as UnixTimestamp;
};

/**
 * Converts a Unix timestamp to a Date object.
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Date object
 * @example
 * const date = fromUnixTimestamp(1720000000000);
 */
export const fromUnixTimestamp = (timestamp: UnixTimestamp): Date =>
  new Date(timestamp);

/**
 * Formats a Date to an ISO date string (YYYY-MM-DD) in UTC.
 * Uses UTC to ensure consistency with parseISODateString.
 * @param date - The Date to format (must be a valid Date)
 * @returns ISO date string in YYYY-MM-DD format (UTC)
 * @throws Error if date is invalid
 * @example
 * const dateStr = toISODateString(new Date('2024-07-15T00:00:00.000Z'));
 * // Returns: '2024-07-15'
 */
export const toISODateString = (date: Date): ISODateString => {
  if (isNaN(date.getTime())) {
    throw new Error('Invalid Date passed to toISODateString');
  }
  // Use UTC methods for consistency with parseISODateString
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}` as ISODateString;
};

/**
 * Formats a Date to a full ISO datetime string with timezone.
 * @param date - The Date to format (must be a valid Date)
 * @returns ISO datetime string in YYYY-MM-DDTHH:mm:ss.sssZ format
 * @throws Error if date is invalid
 * @example
 * const datetimeStr = toISODateTimeString(new Date());
 * // Returns: '2024-07-15T14:30:00.000Z'
 */
export const toISODateTimeString = (date: Date): ISODateTimeString => {
  if (isNaN(date.getTime())) {
    throw new Error('Invalid Date passed to toISODateTimeString');
  }
  return date.toISOString() as ISODateTimeString;
};

// ============================================================================
// Regex Patterns for Validation
// ============================================================================

/**
 * Regex pattern for validating ISO date strings (YYYY-MM-DD).
 * Validates format only - does not verify date validity (e.g., Feb 30).
 */
const ISO_DATE_REGEX = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

/**
 * Regex pattern for validating ISO datetime strings.
 * Accepts full ISO 8601 format with optional milliseconds and timezone.
 */
const ISO_DATETIME_REGEX =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/;

/**
 * Regex pattern for validating 6-digit hex color codes.
 * Accepts format #RRGGBB (case-insensitive).
 */
const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Parses an ISO date string (YYYY-MM-DD) to a Date object.
 * Returns null for invalid input instead of throwing.
 * Optimized to avoid redundant Date allocations.
 * @param str - ISO date string to parse
 * @returns Date object (UTC midnight) or null if invalid
 * @example
 * const date = parseISODateString('2024-07-15');
 * if (date) {
 *   console.log(date.toISOString()); // '2024-07-15T00:00:00.000Z'
 * }
 */
export const parseISODateString = (str: string): Date | null => {
  // Fast format check
  if (!ISO_DATE_REGEX.test(str)) {
    return null;
  }

  // Parse as UTC midnight
  const parsed = new Date(str + 'T00:00:00.000Z');
  if (isNaN(parsed.getTime())) {
    return null;
  }

  // Verify date components match (catches invalid dates like Feb 30)
  // Use direct parsing to avoid array allocation
  const year = parseInt(str.slice(0, 4), 10);
  const month = parseInt(str.slice(5, 7), 10);
  const day = parseInt(str.slice(8, 10), 10);

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed;
};

/**
 * Parses an ISO datetime string to a Date object.
 * Returns null for invalid input instead of throwing.
 * @param str - ISO datetime string to parse
 * @returns Date object or null if invalid
 * @example
 * const date = parseISODateTimeString('2024-07-15T14:30:00.000Z');
 * if (date) {
 *   console.log(date.getTime());
 * }
 */
export const parseISODateTimeString = (str: string): Date | null => {
  // Fast format check
  if (!ISO_DATETIME_REGEX.test(str)) {
    return null;
  }

  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : parsed;
};

// ============================================================================
// Validation Type Guards
// ============================================================================

/**
 * Type guard to validate an ISO date string format (YYYY-MM-DD).
 * Also validates that the date is real (e.g., rejects Feb 30).
 * Note: Provides runtime validation; the type alias is structurally `string`.
 * @param str - String to validate
 * @returns True if valid ISO date string
 * @example
 * if (isValidISODateString(input)) {
 *   // input is narrowed to ISODateString
 *   const date: ISODateString = input;
 * }
 */
export const isValidISODateString = (str: string): str is ISODateString =>
  parseISODateString(str) !== null;

/**
 * Type guard to validate an ISO datetime string format.
 * Accepts full ISO 8601 format with timezone.
 * Note: Provides runtime validation; the type alias is structurally `string`.
 * @param str - String to validate
 * @returns True if valid ISO datetime string
 * @example
 * if (isValidISODateTimeString(input)) {
 *   // input is narrowed to ISODateTimeString
 * }
 */
export const isValidISODateTimeString = (
  str: string,
): str is ISODateTimeString => parseISODateTimeString(str) !== null;

/**
 * Type guard to validate a hex color string.
 * Accepts 6-digit hex format (#RRGGBB).
 * @param str - String to validate
 * @returns True if valid hex color
 * @example
 * if (isValidHexColor(input)) {
 *   // input is narrowed to HexColor
 * }
 */
export const isValidHexColor = (str: string): str is HexColor =>
  HEX_COLOR_REGEX.test(str);

// ============================================================================
// Database Record Helpers
// ============================================================================

/**
 * Creates timestamp fields for a new database record.
 * Both createdAt and updatedAt are set to the current time.
 * @returns Object with createdAt and updatedAt timestamps
 * @example
 * const trip: Trip = {
 *   id: createTripId(),
 *   ...tripFormData,
 *   shareId: createShareId(),
 *   ...createTimestamps(),
 * };
 */
export const createTimestamps = (): {
  createdAt: UnixTimestamp;
  updatedAt: UnixTimestamp;
} => {
  const timestamp = now();
  return {
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

/**
 * Creates an updated timestamp field for record updates.
 * @returns Object with updatedAt timestamp
 * @example
 * await db.trips.update(tripId, {
 *   ...changes,
 *   ...updateTimestamp(),
 * });
 */
export const updateTimestamp = (): { updatedAt: UnixTimestamp } => ({
  updatedAt: now(),
});
