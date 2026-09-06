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

/**
 * Persists the guest identity for a share link.
 *
 * Storage can refuse the write — private browsing, disabled cookies, a full
 * quota — and the caller has something to say about it, so this reports the
 * failure rather than swallowing it the way a read's is. The onboarding wizard
 * warns the guest they will have to pick again next visit; the settings card
 * says the same.
 *
 * @param shareId - The trip's share ID
 * @param identity - The participant this browser is, and the trip it belongs to
 * @returns True when the identity was written, false when storage refused it
 *
 * @example
 * ```typescript
 * if (!writeGuestIdentity(trip.shareId, { personId, tripId: trip.id })) {
 *   toast.error(t('sharing.identityStorageFailed'));
 * }
 * ```
 */
export function writeGuestIdentity(
  shareId: ShareId | string,
  identity: StoredGuestIdentity,
): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    window.localStorage.setItem(
      getGuestIdentityStorageKey(shareId),
      JSON.stringify(identity),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Forgets the guest identity stored for a share link.
 *
 * Removing the key is the only way to say "nobody in particular". Writing an
 * identity with an empty `personId` would not do it: the payload still parses,
 * so every consumer goes on believing this browser is somebody and resolves it
 * to a guest that does not exist.
 *
 * @param shareId - The trip's share ID
 * @returns True when the key was removed or was already absent, false when
 *   storage refused
 */
export function clearGuestIdentity(shareId: ShareId | string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    window.localStorage.removeItem(getGuestIdentityStorageKey(shareId));
    return true;
  } catch {
    return false;
  }
}
