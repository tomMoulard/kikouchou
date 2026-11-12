/**
 * @fileoverview One train, flight or coach that several guests take together.
 *
 * A transport row still belongs to one guest. Several rows are one shared leg
 * when they carry the same key, `sharedLegId ?? id`: the first leg of a group
 * carries nothing, and every leg that joins it carries the first leg's id.
 * This module is the one definition of that key, of the fields the group keeps
 * equal, and of the bound a remote `sharedLegId` must meet.
 *
 * @module lib/db/shared-legs
 */

import { toSharedLegId } from './utils';

import type { SharedLegId, Transport, TransportFormData } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * The fields that describe the vehicle rather than the guest in it. An edit of
 * one leg of a group writes them to every leg of the group.
 *
 * `personId`, `rideId`, `driverId` and `needsPickup` are left out on purpose:
 * guests off the same train can go home in different cars.
 */
export const SHARED_LEG_FIELDS = [
  'type',
  'datetime',
  'location',
  'coordinates',
  'startLocation',
  'startCoordinates',
  'transportMode',
  'transportNumber',
  'notes',
] as const satisfies readonly (keyof Transport & keyof TransportFormData)[];

/** One of {@link SHARED_LEG_FIELDS}. */
export type SharedLegField = (typeof SHARED_LEG_FIELDS)[number];

/** The values a group of legs keeps equal. */
export type SharedLegFields = Partial<Pick<TransportFormData, SharedLegField>>;

/**
 * The shape of a key: a nanoid or a transport id, which is a nanoid too.
 * Anything else that arrives from a peer is dropped rather than stored.
 */
const SHARED_LEG_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// ============================================================================
// Public API
// ============================================================================

/**
 * Names the shared leg a transport belongs to.
 *
 * A leg nobody joined is a group of one, keyed by its own id.
 *
 * @param transport - The leg
 * @returns The group key
 */
export function getSharedLegKey(
  transport: Pick<Transport, 'id' | 'sharedLegId'>,
): SharedLegId {
  return transport.sharedLegId ?? toSharedLegId(transport.id);
}

/**
 * Checks a `sharedLegId` that came from another device.
 *
 * @param value - Whatever the peer stored under the key
 * @returns The key, or undefined when it is absent, empty or not id-shaped
 */
export function toSharedLegIdOrUndefined(value: unknown): SharedLegId | undefined {
  if (typeof value !== 'string' || !SHARED_LEG_ID_PATTERN.test(value)) {
    return undefined;
  }
  return value as SharedLegId;
}

/**
 * Groups legs by the train or flight they share, keeping the input order
 * inside each group and ordering the groups by their first leg.
 *
 * @param transports - The legs to group (not mutated)
 * @param splitBy - Keeps apart the legs of one train that differ in what it
 *   returns, for a row that must speak for every guest on it (the pickup)
 * @returns One array per shared leg, each with at least one leg
 */
export function groupSharedLegs<T extends Pick<Transport, 'id' | 'sharedLegId'>>(
  transports: readonly T[],
  splitBy?: (transport: T) => string,
): T[][] {
  const groups = new Map<string, T[]>();
  for (const transport of transports) {
    const key = splitBy
      ? `${getSharedLegKey(transport)}|${splitBy(transport)}`
      : getSharedLegKey(transport);
    const group = groups.get(key);
    if (group) {
      group.push(transport);
    } else {
      groups.set(key, [transport]);
    }
  }
  return [...groups.values()];
}

/**
 * Lists the other legs of the group a leg belongs to.
 *
 * @param transport - The leg
 * @param transports - Every leg of the trip
 * @returns The legs that share its key, itself excluded
 */
export function listSharedLegMates<T extends Pick<Transport, 'id' | 'sharedLegId'>>(
  transport: Pick<Transport, 'id' | 'sharedLegId'>,
  transports: readonly T[],
): T[] {
  const key = getSharedLegKey(transport);
  return transports.filter(
    (other) => other.id !== transport.id && getSharedLegKey(other) === key,
  );
}

/**
 * Takes the vehicle's fields out of a patch, leaving the guest's own fields.
 *
 * A key present with `undefined` is kept, because that is how a patch clears a
 * field (Dexie deletes a property written as undefined).
 *
 * @param patch - A transport patch
 * @returns Only the keys in {@link SHARED_LEG_FIELDS}
 */
export function pickSharedLegFields(
  patch: Partial<TransportFormData>,
): SharedLegFields {
  const shared: Record<string, unknown> = {};
  for (const field of SHARED_LEG_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      shared[field] = patch[field];
    }
  }
  return shared as SharedLegFields;
}

/**
 * Copies the vehicle's fields of a leg, for a guest who joins it.
 *
 * @param transport - The leg being joined
 * @returns Its shared fields, absent ones left out
 */
export function copySharedLegFields(transport: Transport): SharedLegFields {
  const shared: Record<string, unknown> = {};
  for (const field of SHARED_LEG_FIELDS) {
    if (transport[field] !== undefined) {
      shared[field] = transport[field];
    }
  }
  return shared as SharedLegFields;
}
