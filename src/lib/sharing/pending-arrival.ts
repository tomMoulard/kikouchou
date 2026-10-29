/**
 * @fileoverview The arrival day a guest gave before they could save it.
 *
 * An invite link asks "When do you arrive?" right after the guest picks their
 * name. A guest with no account is on a viewer trip, which nothing on the
 * device may write, so the answer waits here, on this device, until the trip
 * becomes a member trip with a sign-in. `usePendingArrival` then writes it as
 * the guest's `stayStartDate` and forgets it.
 *
 * Keyed on the local trip id, which `upgradeViewerTrip` keeps: the viewer row
 * and the member row are the same row.
 *
 * @module lib/sharing/pending-arrival
 */

import { isValidISODateString } from '@/lib/db/utils';
import type { ISODateString, PersonId, TripId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** One guest's answer, waiting for a trip it can be written to. */
export interface PendingArrival {
  /** The guest who answered */
  readonly personId: PersonId;
  /** The day they said they arrive */
  readonly date: ISODateString;
}

// ============================================================================
// Constants
// ============================================================================

/** Prefix of the localStorage key holding a pending arrival. */
export const PENDING_ARRIVAL_STORAGE_PREFIX = 'kikouchou-pending-arrival:';

// ============================================================================
// Public API
// ============================================================================

/**
 * Returns the localStorage key a trip's pending arrival lives under.
 *
 * @param tripId - The local trip id
 * @returns The localStorage key string
 */
export function getPendingArrivalStorageKey(tripId: TripId | string): string {
  return `${PENDING_ARRIVAL_STORAGE_PREFIX}${tripId}`;
}

/**
 * Reads the pending arrival stored for a trip.
 *
 * The value is read back from storage another tab or an older build may have
 * written, so it is checked field by field: a malformed entry reads as none.
 *
 * @param tripId - The local trip id
 * @returns The pending arrival, or undefined when there is none or storage is
 *   unavailable
 */
export function readPendingArrival(tripId: TripId | string): PendingArrival | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    const raw = window.localStorage.getItem(getPendingArrivalStorageKey(tripId));
    if (!raw) {
      return undefined;
    }

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return undefined;
    }
    const { personId, date } = parsed as { personId?: unknown; date?: unknown };
    if (
      typeof personId !== 'string' ||
      personId.length === 0 ||
      typeof date !== 'string' ||
      !isValidISODateString(date)
    ) {
      return undefined;
    }

    return { personId: personId as PersonId, date };
  } catch {
    return undefined;
  }
}

/**
 * Stores a guest's answer until the trip can take it.
 *
 * @param tripId - The local trip id
 * @param arrival - The guest and the day they arrive
 * @returns True when the answer was written, false when storage refused it
 */
export function writePendingArrival(tripId: TripId | string, arrival: PendingArrival): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    window.localStorage.setItem(getPendingArrivalStorageKey(tripId), JSON.stringify(arrival));
    return true;
  } catch {
    return false;
  }
}

/**
 * Forgets a trip's pending arrival, once it is written or cannot be.
 *
 * @param tripId - The local trip id
 */
export function clearPendingArrival(tripId: TripId | string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(getPendingArrivalStorageKey(tripId));
  } catch {
    // Storage refused: the next read finds the same answer and tries again.
  }
}
