/**
 * @fileoverview Resolves a decoded changeset against local trips for import from /trips
 * (QR or paste): match by share id, else by trip name, else create a new trip.
 *
 * @module lib/sharing/import-from-changeset
 */

import { createTrip, getAllTrips, getRoomsByTripId, getTripByShareId } from '@/lib/db';
import type { AppChangeset, EntityCollection, TripSnapshotMeta } from '@/lib/sharing/types';
import type { Room, RoomId, Trip, TripId } from '@/types';

// ============================================================================
// Errors
// ============================================================================

/** Error code when the payload cannot create a new trip (missing snapshot metadata). */
export const IMPORT_SNAPSHOT_REQUIRED = 'import_snapshot_required' as const;

export class ImportChangesetError extends Error {
  readonly code: typeof IMPORT_SNAPSHOT_REQUIRED;

  constructor(code: typeof IMPORT_SNAPSHOT_REQUIRED, message: string) {
    super(message);
    this.name = 'ImportChangesetError';
    this.code = code;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Prepares a changeset for applying on this device: rewrites trip and room ids so
 * {@link computeMerge} runs against the correct local trip (existing or newly created).
 */
export async function prepareChangesetForLocalImport(
  changeset: AppChangeset,
): Promise<{ readonly prepared: AppChangeset; readonly targetTripId: TripId }> {
  const byShare = await getTripByShareId(changeset.shareId);
  if (byShare) {
    const roomMap = buildRoomIdMapByName(
      collectRoomsFromChangeset(changeset),
      await getRoomsByTripId(byShare.id),
    );
    return {
      prepared: rewriteChangesetForTargetTrip(changeset, byShare.id, roomMap),
      targetTripId: byShare.id,
    };
  }

  const snapshot = changeset.tripSnapshot;
  if (snapshot) {
    const byName = await findTripByNormalizedName(snapshot.name);
    if (byName) {
      const roomMap = buildRoomIdMapByName(
        collectRoomsFromChangeset(changeset),
        await getRoomsByTripId(byName.id),
      );
      return {
        prepared: rewriteChangesetForTargetTrip(changeset, byName.id, roomMap),
        targetTripId: byName.id,
      };
    }

    const trip = await createTripFromSnapshot(snapshot);
    return {
      prepared: rewriteChangesetTripId(changeset, trip.id),
      targetTripId: trip.id,
    };
  }

  throw new ImportChangesetError(
    IMPORT_SNAPSHOT_REQUIRED,
    'Trip snapshot metadata is required to import this changeset on a new device',
  );
}

// ============================================================================
// Trip + room resolution
// ============================================================================

function normalizeTripName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function findTripByNormalizedName(name: string): Promise<Trip | undefined> {
  const target = normalizeTripName(name);
  const trips = await getAllTrips();
  return trips.find(t => normalizeTripName(t.name) === target);
}

async function createTripFromSnapshot(snapshot: TripSnapshotMeta) {
  return createTrip({
    name: snapshot.name,
    startDate: snapshot.startDate,
    endDate: snapshot.endDate,
    location: snapshot.location,
    description: snapshot.description,
    coordinates: snapshot.coordinates,
  });
}

function collectRoomsFromChangeset(changeset: AppChangeset): Room[] {
  const byId = new Map<RoomId, Room>();
  for (const r of changeset.added.rooms) {
    byId.set(r.id, r);
  }
  for (const r of changeset.modified.rooms) {
    byId.set(r.id, r);
  }
  return [...byId.values()];
}

/**
 * Maps export room ids to local room ids when room names match (same normalized name).
 * Export rooms without a name match keep their ids and are inserted as new rows.
 */
export function buildRoomIdMapByName(
  exportRooms: readonly Room[],
  localRooms: readonly Room[],
): Map<RoomId, RoomId> {
  const map = new Map<RoomId, RoomId>();
  const usedLocal = new Set<RoomId>();
  const sortedExport = [...exportRooms].sort((a, b) => a.order - b.order);
  const sortedLocal = [...localRooms].sort((a, b) => a.order - b.order);

  for (const er of sortedExport) {
    const en = normalizeTripName(er.name);
    const match = sortedLocal.find(
      lr => !usedLocal.has(lr.id) && normalizeTripName(lr.name) === en,
    );
    if (match) {
      map.set(er.id, match.id);
      usedLocal.add(match.id);
    }
  }
  return map;
}

function mapRoomId(roomId: RoomId, roomIdMap: Map<RoomId, RoomId>): RoomId {
  return roomIdMap.get(roomId) ?? roomId;
}

/**
 * Rewrites all scoped ids for merging into an existing local trip, including
 * assignment room ids when export rooms align with local rooms by name.
 */
export function rewriteChangesetForTargetTrip(
  changeset: AppChangeset,
  targetTripId: TripId,
  roomIdMap: Map<RoomId, RoomId>,
): AppChangeset {
  const mapCollection = (c: EntityCollection): EntityCollection => ({
    persons: c.persons.map(p => ({ ...p, tripId: targetTripId })),
    assignments: c.assignments.map(a => ({
      ...a,
      tripId: targetTripId,
      roomId: mapRoomId(a.roomId, roomIdMap),
    })),
    transports: c.transports.map(t => ({ ...t, tripId: targetTripId })),
    rooms: c.rooms.map(r => {
      const newId = mapRoomId(r.id, roomIdMap);
      return { ...r, id: newId, tripId: targetTripId };
    }),
  });

  return {
    ...changeset,
    tripId: targetTripId,
    added: mapCollection(changeset.added),
    modified: mapCollection(changeset.modified),
  };
}

/** Rewrites every `tripId` to {@link newTripId} (cold import of a full host export). */
export function rewriteChangesetTripId(changeset: AppChangeset, newTripId: TripId): AppChangeset {
  const mapCollection = (c: EntityCollection): EntityCollection => ({
    persons: c.persons.map(p => ({ ...p, tripId: newTripId })),
    assignments: c.assignments.map(a => ({ ...a, tripId: newTripId })),
    transports: c.transports.map(t => ({ ...t, tripId: newTripId })),
    rooms: c.rooms.map(r => ({ ...r, tripId: newTripId })),
  });

  return {
    ...changeset,
    tripId: newTripId,
    added: mapCollection(changeset.added),
    modified: mapCollection(changeset.modified),
  };
}
