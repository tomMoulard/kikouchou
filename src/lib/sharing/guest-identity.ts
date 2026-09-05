/**
 * @fileoverview Reader for the guest identity a shared link stores locally.
 *
 * When someone opens a trip through a share link and picks who they are, the
 * onboarding wizard persists `{ personId, tripId }` under a per-share key.
 * Features that need to know "who is using this browser" — joining an activity,
 * P2P presence — read it back through here.
 *
 * @module lib/sharing/guest-identity
 */

import type { PersonId, ShareId, TripId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * The guest identity persisted by the share onboarding wizard.
 */
export interface StoredGuestIdentity {
  /** The participant this browser identified as */
  readonly personId: PersonId;
  /** The trip the identity belongs to */
  readonly tripId: TripId;
}

// ============================================================================
// Constants
// ============================================================================

/** Prefix of the localStorage key holding a guest identity. */
export const GUEST_IDENTITY_STORAGE_PREFIX = 'kikouchou_guest_';

// ============================================================================
// Public API
// ============================================================================

/**
 * Returns the localStorage key used to persist a guest identity.
 *
 * @param shareId - The trip's share ID
 * @returns The localStorage key string
 */
export function getGuestIdentityStorageKey(shareId: ShareId | string): string {
  return `${GUEST_IDENTITY_STORAGE_PREFIX}${shareId}`;
}

/**
 * Reads the guest identity stored for a share link.
 *
 * Returns undefined when nothing is stored, when the payload is malformed, or
 * when storage is unavailable (private browsing, disabled cookies).
 *
 * @param shareId - The trip's share ID
 * @returns The stored identity, or undefined
 *
 * @example
 * ```typescript
 * const identity = readGuestIdentity(trip.shareId);
 * if (identity?.tripId === trip.id) {
 *   // this browser belongs to identity.personId
 * }
 * ```
 */
export function readGuestIdentity(
  shareId: ShareId | string,
): StoredGuestIdentity | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    const raw = window.localStorage.getItem(getGuestIdentityStorageKey(shareId));
    if (!raw) {
      return undefined;
    }

    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { personId?: unknown }).personId !== 'string' ||
      typeof (parsed as { tripId?: unknown }).tripId !== 'string'
    ) {
      return undefined;
    }

    return parsed as StoredGuestIdentity;
  } catch {
    return undefined;
  }
}

/**
 * Finds the share id whose stored entry claims a given trip.
 *
 * The reverse of {@link getGuestIdentityStorageKey}, and the one case that
 * cannot be answered by building a key: the caller holds a trip id and the keys
 * are filed by share id. It walks `localStorage` because there is no index —
 * over a handful of keys, on an action the user just clicked, that is cheaper
 * than maintaining one.
 *
 * Deliberately **more permissive than {@link readGuestIdentity}**: it matches on
 * the stored `tripId` alone, so an entry missing its `personId` is still found.
 * That distinction is load-bearing. "This device has no guest identity for the
 * trip" and "it has one and the identity is broken" lead to different places —
 * the first to a host export of the whole trip, the second to an error — and
 * collapsing them would silently export a guest's entire trip on a corrupt key.
 *
 * A malformed entry is skipped rather than aborting the scan: one bad key must
 * not hide a good one written by a different share link.
 *
 * @param tripId - The local trip id to look for
 * @returns The share id, or undefined when no entry claims that trip
 */
export function findGuestIdentityShareId(tripId: TripId | string): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key === null || !key.startsWith(GUEST_IDENTITY_STORAGE_PREFIX)) {
        continue;
      }

      const raw = window.localStorage.getItem(key);
      if (raw === null) {
        continue;
      }

      try {
        const parsed: unknown = JSON.parse(raw);
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          (parsed as { tripId?: unknown }).tripId === tripId
        ) {
          return key.slice(GUEST_IDENTITY_STORAGE_PREFIX.length);
        }
      } catch {
        continue;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

/**
 * Returns the participant this browser identifies as for a given trip.
 *
 * @param trip - The trip (needs `id` and `shareId`)
 * @returns The participant's ID, or undefined when this browser has no identity
 *   for that trip (e.g. the trip owner, who is not a guest of their own link)
 */
export function getTripGuestPersonId(
  trip: { readonly id: TripId; readonly shareId: ShareId } | null | undefined,
): PersonId | undefined {
  if (!trip) {
    return undefined;
  }

  const identity = readGuestIdentity(trip.shareId);
  return identity && identity.tripId === trip.id ? identity.personId : undefined;
}
