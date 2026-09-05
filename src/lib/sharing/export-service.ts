/**
 * @fileoverview Export service — builds a changeset from a guest's local modifications.
 * Compares the current DB state against the import baseline to determine
 * what was added and what was modified.
 *
 * @module lib/sharing/export-service
 */

import {
  getAssignmentsByPersonId,
  getAssignmentsByTripId,
  getPersonById,
  getPersonsByTripId,
  getRoomsByTripId,
  getTransportsByPersonId,
  getTransportsByTripId,
} from '@/lib/db';
import type {
  PersonId,
  RoomAssignment,
  Transport,
  Trip,
  TripId,
} from '@/types';
import { isGuestPhoneSharingEnabled } from '@/lib/flags';
import { toSharedGuest } from '@/lib/sharing/guest-privacy';
import type { AppChangeset, EntityCollection, ImportBaseline } from '@/lib/sharing/types';
import { getBaselineStorageKey } from '@/lib/sharing/types';

// ============================================================================
// Baseline Management
// ============================================================================

/**
 * Saves an import baseline to localStorage.
 * Called when a guest completes the sharing wizard.
 */
export function saveBaseline(baseline: ImportBaseline): void {
  try {
    const key = getBaselineStorageKey(baseline.shareId);
    localStorage.setItem(key, JSON.stringify(baseline));
  } catch (error) {
    console.error('Failed to save import baseline:', error);
  }
}

/**
 * Loads an import baseline from localStorage.
 * Returns null if no baseline exists for the given share ID.
 */
export function loadBaseline(shareId: string): ImportBaseline | null {
  try {
    const key = getBaselineStorageKey(shareId);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as ImportBaseline;
  } catch (error) {
    console.error('Failed to load import baseline:', error);
    return null;
  }
}

// ============================================================================
// Export Service
// ============================================================================

/**
 * Builds a changeset from the guest's current local state compared to their baseline.
 *
 * The logic:
 * 1. Load the baseline snapshot (what existed when guest imported)
 * 2. Fetch the guest's current entities from IndexedDB
 * 3. Entities with IDs NOT in the baseline snapshot → "added"
 * 4. Entities with IDs IN the baseline snapshot but with different data → "modified"
 *
 * For simplicity, a guest primarily owns their own person record, their assignments,
 * and their transports. We export everything the guest person has.
 *
 * @param tripId - The trip to export changes for
 * @param shareId - The share ID used to import the trip
 * @param personId - The guest's person ID
 * @returns The changeset, or null if no baseline exists
 */
export async function buildChangeset(
  tripId: TripId,
  shareId: string,
  personId: PersonId,
): Promise<AppChangeset | null> {
  const baseline = loadBaseline(shareId);
  if (!baseline) {
    return null;
  }

  // Fetch current state
  const stored = await getPersonById(personId);
  if (!stored) {
    throw new Error(`Person ${personId} not found`);
  }

  // A changeset is the other way a guest record leaves this device — scanned
  // off this screen onto someone else's phone — so it obeys the same flag the
  // document writers do.
  const person = toSharedGuest(stored, { sharePhone: isGuestPhoneSharingEnabled() });

  // Get all entities related to this guest
  const [assignments, transports] = await Promise.all([
    getGuestAssignments(tripId, personId),
    getGuestTransports(tripId, personId),
  ]);

  // Classify into added vs modified
  const baselinePersonIds = new Set(baseline.snapshot.personIds);
  const baselineAssignmentIds = new Set(baseline.snapshot.assignmentIds);
  const baselineTransportIds = new Set(baseline.snapshot.transportIds);

  const added: EntityCollection = {
    persons: !baselinePersonIds.has(person.id) ? [person] : [],
    assignments: assignments.filter(a => !baselineAssignmentIds.has(a.id)),
    transports: transports.filter(t => !baselineTransportIds.has(t.id)),
    rooms: [],
  };

  const modified: EntityCollection = {
    // The person record is always included in modified if it existed at baseline
    // (guest may have updated their name, dates, etc.)
    persons: baselinePersonIds.has(person.id) ? [person] : [],
    assignments: assignments.filter(a => baselineAssignmentIds.has(a.id)),
    transports: transports.filter(t => baselineTransportIds.has(t.id)),
    rooms: [],
  };

  return {
    version: 1,
    tripId,
    shareId,
    exportedBy: personId,
    exportedAt: Date.now(),
    baseSnapshotAt: baseline.importedAt,
    added,
    modified,
  };
}

/**
 * Builds a changeset with all persons, room assignments, and transports for the trip.
 * Used when there is no guest import baseline (typical organizer device). Recipients
 * merge it like any other changeset; entities already identical on the host are no-ops.
 *
 * @param trip - The trip row (must include id, shareId, createdAt)
 * @returns The changeset, or null if there is nothing to export (no people or related data)
 */
export async function buildHostChangeset(trip: Trip): Promise<AppChangeset | null> {
  const [stored, assignments, transports, rooms] = await Promise.all([
    getPersonsByTripId(trip.id),
    getAssignmentsByTripId(trip.id),
    getTransportsByTripId(trip.id),
    getRoomsByTripId(trip.id),
  ]);

  const sharePhone = isGuestPhoneSharingEnabled();
  const persons = stored.map((person) => toSharedGuest(person, { sharePhone }));

  const exportedBy: PersonId | undefined =
    persons[0]?.id ?? assignments[0]?.personId ?? transports[0]?.personId;

  if (exportedBy === undefined) {
    return null;
  }

  const emptyModified: EntityCollection = {
    persons: [],
    assignments: [],
    transports: [],
    rooms: [],
  };

  return {
    version: 1,
    tripId: trip.id,
    shareId: trip.shareId,
    exportedBy,
    exportedAt: Date.now(),
    baseSnapshotAt: trip.createdAt,
    tripSnapshot: {
      name: trip.name,
      startDate: trip.startDate,
      endDate: trip.endDate,
      location: trip.location,
      description: trip.description,
      coordinates: trip.coordinates,
    },
    added: {
      persons,
      assignments,
      transports,
      rooms,
    },
    modified: emptyModified,
  };
}

/**
 * Creates a baseline snapshot of the current trip state for a guest.
 * Should be called when the guest finishes the onboarding wizard.
 */
export async function createBaselineForGuest(
  tripId: TripId,
  shareId: string,
  personId: PersonId,
): Promise<ImportBaseline> {
  const [assignments, transports] = await Promise.all([
    getGuestAssignments(tripId, personId),
    getGuestTransports(tripId, personId),
  ]);

  const baseline: ImportBaseline = {
    tripId,
    shareId,
    personId,
    importedAt: Date.now(),
    snapshot: {
      personIds: [personId],
      assignmentIds: assignments.map(a => a.id),
      transportIds: transports.map(t => t.id),
    },
  };

  saveBaseline(baseline);
  return baseline;
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Gets all assignments for a person in a trip.
 */
async function getGuestAssignments(
  tripId: TripId,
  personId: PersonId,
): Promise<RoomAssignment[]> {
  // Get assignments by personId, then filter to this trip
  const allAssignments = await getAssignmentsByPersonId(personId);
  return allAssignments.filter(a => a.tripId === tripId);
}

/**
 * Gets all transports for a person in a trip.
 */
async function getGuestTransports(
  _tripId: TripId,
  personId: PersonId,
): Promise<Transport[]> {
  // getTransportsByPersonId doesn't filter by trip, but all transports
  // for a personId should belong to the same trip in practice
  return getTransportsByPersonId(personId);
}
