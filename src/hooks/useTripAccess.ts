/**
 * @fileoverview What this device may do with the current trip.
 *
 * Two answers. A **member** trip is one this device created or joined with an
 * account: every write goes to the document and, once shared, to the server.
 * A **viewer** trip arrived through an invite link with no account behind it:
 * the document is read from the server and never written, because every write
 * policy on the server needs an account.
 *
 * The distinction is one field on the trip row, `viewerToken`, and this hook
 * exists so that no page reads that field directly. "Read-only" is decided in
 * one place, and when the viewer signs in and the token is redeemed the field
 * clears, every control that asked comes back, and nothing has to be told.
 *
 * @module hooks/useTripAccess
 */

import { useMemo } from 'react';

import { useTripContext } from '@/contexts/TripContext';
import type { Trip } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** How this device holds a trip. */
export type TripAccess = 'viewer' | 'member';

/** What a view gets back when it asks whether it may edit. */
export interface UseTripAccessResult {
  readonly access: TripAccess;
  /** `true` for a member trip and for no trip at all — nothing to protect. */
  readonly canEdit: boolean;
  /** The invite token a viewer trip is read through. */
  readonly viewerToken: string | undefined;
}

// ============================================================================
// Pure helpers
// ============================================================================

/**
 * How a device holds a given trip, for callers outside React — the assistant
 * resolves the trip an action targets by id and asks here.
 *
 * @param trip - The trip row, or nothing
 * @returns `viewer` while the trip is read through an invite token
 */
export function tripAccessOf(
  trip: Pick<Trip, 'viewerToken'> | null | undefined,
): TripAccess {
  return trip?.viewerToken === undefined ? 'member' : 'viewer';
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Whether the current trip may be edited on this device.
 *
 * Must be used within `TripProvider`.
 *
 * @returns The access level and its consequences
 *
 * @example
 * ```tsx
 * const { canEdit } = useTripAccess();
 * {canEdit ? <Button onClick={handleAddRoom}>{t('rooms.new')}</Button> : null}
 * ```
 */
export function useTripAccess(): UseTripAccessResult {
  const { currentTrip } = useTripContext();
  const viewerToken = currentTrip?.viewerToken;

  return useMemo(
    () => ({
      access: viewerToken === undefined ? 'member' : 'viewer',
      canEdit: viewerToken === undefined,
      viewerToken,
    }),
    [viewerToken],
  );
}
