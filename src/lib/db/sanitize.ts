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

import {
  MAX_ACTIVITY_PARTICIPANTS,
  MAX_GUEST_GROUP_MEMBERS,
  normalizePersonHeadcount,
} from '@/types';

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
  /**
   * Trip description (instructions, tricount link, notes).
   *
   * Matches the `maxLength` the form's textarea has always carried, so bounding
   * the field on save rejects nothing a user could have typed *or pasted* into
   * it — the attribute clips both.
   *
   * That attribute was nonetheless the only limit until now, and it binds one
   * textarea rather than the field. Everything that writes a description without
   * going through the form went straight past it: the assistant's trip actions,
   * a QR/changeset import, and the CRDT bridge projecting a peer's document.
   */
  tripDescription: 1000,
  /** Room name (e.g., "Master Bedroom") */
  roomName: 100,
  /** Room description (e.g., "King bed with ensuite bathroom") */
  roomDescription: 500,
  /** Person name (e.g., "Marie Dupont") */
  personName: 100,
  /** Person notes (allergies, diet, etc.) */
  personNotes: 2000,
  /**
   * Person phone number (e.g., "+33 6 12 34 56 78").
   *
   * Generous next to E.164's 15 digits, because the value is stored as typed:
   * spaces, dashes, parentheses and a leading country code all have to fit, and
   * an address book will happily hand over "+33 (0)6 12-34-56-78 (mobile)".
   */
  personPhone: 32,
  /** Transport location (e.g., "Gare Montparnasse") */
  transportLocation: 200,
  /** Transport number (e.g., "TGV 8541") */
  transportNumber: 50,
  /** Transport notes */
  transportNotes: 1000,
  /** Activity title (e.g., "Fête des plantes") */
  activityTitle: 100,
  /** Activity location (e.g., "Château de Saint-Jean") */
  activityLocation: 200,
  /** Activity notes (booking links, price, what to bring) */
  activityNotes: 1000,
  /** Guest group name (e.g., "Family") */
  guestGroupName: 100,
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
 * `description` is bounded here for the same reason `name` and `location` are:
 * a field this function does not name falls through the spread untouched, and
 * the only thing standing behind it was a DOM attribute binding one textarea —
 * not the field, and so not the writers that never touch the form. The sibling
 * {@link sanitizeRoomData} has always bounded its description; a trip's was
 * simply missing from the constraint.
 *
 * @param data - Trip form data to sanitize
 * @returns Sanitized trip form data
 */
export function sanitizeTripData<
  T extends { name: string; location?: string; description?: string },
>(data: T): T {
  return {
    ...data,
    name: sanitizeText(data.name, MAX_LENGTHS.tripName),
    location: sanitizeOptionalText(data.location, MAX_LENGTHS.tripLocation),
    description: sanitizeOptionalText(data.description, MAX_LENGTHS.tripDescription),
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
export function sanitizePersonData<
  T extends { name: string; notes?: string; phone?: string; headcount?: number },
>(data: T): T {
  return {
    ...data,
    name: sanitizeText(data.name, MAX_LENGTHS.personName),
    notes: sanitizeOptionalText(data.notes, MAX_LENGTHS.personNotes),
    phone: sanitizeOptionalText(data.phone, MAX_LENGTHS.personPhone),
    headcount:
      data.headcount === undefined ? undefined : normalizePersonHeadcount(data.headcount),
  };
}

/**
 * Sanitizes guest group form data: the group's own name, and every member
 * through the same rules a guest's own fields go through.
 *
 * A member's name and notes reuse `personName` / `personNotes` deliberately —
 * a member becomes a {@link Person} on import, so anything this function lets
 * through has to be something `sanitizePersonData` would also have accepted, or
 * the import would silently clip a field the group page showed in full.
 *
 * The member list itself is bounded to {@link MAX_GUEST_GROUP_MEMBERS}: the
 * whole group travels as one record, and a remote write is not obliged to be
 * reasonable about its length.
 *
 * @param data - Guest group form data to sanitize
 * @returns Sanitized guest group form data
 */
export function sanitizeGuestGroupData<
  T extends {
    name: string;
    members: {
      name: string;
      notes?: string;
      phone?: string;
      headcount?: number;
    }[];
  },
>(data: T): T {
  return {
    ...data,
    name: sanitizeText(data.name, MAX_LENGTHS.guestGroupName),
    members: data.members
      .slice(0, MAX_GUEST_GROUP_MEMBERS)
      .map((member) => sanitizePersonData(member)),
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
    startLocation?: string;
    transportNumber?: string;
    notes?: string;
  },
>(data: T): T {
  return {
    ...data,
    location: sanitizeText(data.location, MAX_LENGTHS.transportLocation),
    startLocation: sanitizeOptionalText(data.startLocation, MAX_LENGTHS.transportLocation),
    transportNumber: sanitizeOptionalText(data.transportNumber, MAX_LENGTHS.transportNumber),
    notes: sanitizeOptionalText(data.notes, MAX_LENGTHS.transportNotes),
  };
}

/**
 * Sanitizes activity form data.
 *
 * Trims text fields, drops empty optional text, de-duplicates participants
 * and clamps the optional participant cap to a sane whole number.
 *
 * @param data - Activity form data to sanitize
 * @returns Sanitized activity form data
 */
export function sanitizeActivityData<
  T extends {
    title: string;
    location?: string;
    notes?: string;
    participantIds?: readonly string[];
    maxParticipants?: number;
  },
>(data: T): T {
  return {
    ...data,
    title: sanitizeText(data.title, MAX_LENGTHS.activityTitle),
    location: sanitizeOptionalText(data.location, MAX_LENGTHS.activityLocation),
    notes: sanitizeOptionalText(data.notes, MAX_LENGTHS.activityNotes),
    participantIds: data.participantIds
      ? Array.from(new Set(data.participantIds))
      : data.participantIds,
    maxParticipants: normalizeMaxParticipants(data.maxParticipants),
  };
}

/**
 * Clamps a raw participant cap to a whole number within the allowed range.
 * Returns undefined (unlimited) for undefined, non-finite or non-positive values.
 *
 * @param value - Raw cap (form input, imported changeset, legacy record)
 * @returns A whole number between 1 and {@link MAX_ACTIVITY_PARTICIPANTS}, or undefined
 */
export function normalizeMaxParticipants(
  value: number | undefined,
): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }

  const rounded = Math.round(value);
  if (rounded < 1) {
    return undefined;
  }

  return rounded > MAX_ACTIVITY_PARTICIPANTS ? MAX_ACTIVITY_PARTICIPANTS : rounded;
}
