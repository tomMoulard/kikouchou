/**
 * @fileoverview Yjs ↔ Dexie persistence bridge.
 *
 * Persists raw Yjs binary updates into the yjsUpdates table so the Y.Doc
 * can be reconstructed after a page reload without needing a server.
 * Also syncs the CRDT state back into the existing Dexie tables so the
 * rest of the application continues reading Dexie as before.
 *
 * @module lib/yjs/dexie-bridge
 */

import * as Y from 'yjs';

import { db } from '@/lib/db/database';
import type {
  Activity,
  Person,
  Room,
  RoomAssignment,
  ShareId,
  Transport,
  Trip,
  TripId,
  UnixTimestamp,
} from '@/types';

const COMPACTION_THRESHOLD = 100;

export const ORIGIN_DEXIE_SYNC = 'dexie-sync';

export type SharedCollectionName =
  | 'guests'
  | 'rooms'
  | 'roomAssignments'
  | 'transport'
  | 'activities';
export type DocCollectionName = SharedCollectionName;
type SharedRecord = Record<string, unknown>;

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizeValue(nested)]),
    );
  }

  return value;
}

function areEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeValue(left)) === JSON.stringify(normalizeValue(right));
}

function stripTripId<T extends { tripId: TripId }>(record: T): SharedRecord {
  const nextRecord = { ...record } as Record<string, unknown>;
  delete nextRecord.tripId;
  return nextRecord;
}

function sortCollection(
  collection: SharedCollectionName,
  items: ReadonlyArray<SharedRecord>,
): SharedRecord[] {
  const nextItems = [...items];

  switch (collection) {
    case 'guests':
      return nextItems.sort((left, right) => String(left.id).localeCompare(String(right.id)));
    case 'rooms':
      return nextItems.sort((left, right) => {
        const leftOrder = Number(left.order ?? 0);
        const rightOrder = Number(right.order ?? 0);
        return leftOrder === rightOrder
          ? String(left.id).localeCompare(String(right.id))
          : leftOrder - rightOrder;
      });
    case 'roomAssignments':
      return nextItems.sort((left, right) => {
        const dateCompare = String(left.startDate ?? '').localeCompare(String(right.startDate ?? ''));
        return dateCompare === 0
          ? String(left.id).localeCompare(String(right.id))
          : dateCompare;
      });
    case 'transport':
      return nextItems.sort((left, right) => {
        const datetimeCompare = String(left.datetime ?? '').localeCompare(String(right.datetime ?? ''));
        return datetimeCompare === 0
          ? String(left.id).localeCompare(String(right.id))
          : datetimeCompare;
      });
    case 'activities':
      return nextItems.sort((left, right) => {
        const startCompare = String(left.startDatetime ?? '').localeCompare(
          String(right.startDatetime ?? ''),
        );
        return startCompare === 0
          ? String(left.id).localeCompare(String(right.id))
          : startCompare;
      });
  }

  return nextItems;
}

function getMeta(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('meta');
}

function buildTripRecord(doc: Y.Doc, roomId: string, existingTrip?: Trip): Trip | null {
  const meta = getMeta(doc);
  const id = meta.get('id');
  if (typeof id !== 'string') {
    return null;
  }

  const shareId = meta.get('shareId');
  const createdAt = meta.get('createdAt');
  const updatedAt = meta.get('updatedAt');
  const fragmentKey = typeof window !== 'undefined' ? window.location.hash.slice(1) : undefined;

  const trip: Trip = {
    id: id as TripId,
    name: (meta.get('name') as string) ?? existingTrip?.name ?? 'Shared Trip',
    startDate:
      (meta.get('startDate') as Trip['startDate']) ??
      existingTrip?.startDate ??
      ('' as Trip['startDate']),
    endDate:
      (meta.get('endDate') as Trip['endDate']) ??
      existingTrip?.endDate ??
      ('' as Trip['endDate']),
    shareId:
      ((typeof shareId === 'string' ? shareId : existingTrip?.shareId) as ShareId | undefined) ??
      (id.slice(0, 10) as ShareId),
    createdAt:
      ((typeof createdAt === 'number' ? createdAt : existingTrip?.createdAt) as UnixTimestamp | undefined) ??
      (Date.now() as UnixTimestamp),
    updatedAt:
      ((typeof updatedAt === 'number' ? updatedAt : existingTrip?.updatedAt) as UnixTimestamp | undefined) ??
      (Date.now() as UnixTimestamp),
    p2pRoomId: roomId,
    ...(fragmentKey
      ? { p2pEncryptionKey: fragmentKey }
      : existingTrip?.p2pEncryptionKey
        ? { p2pEncryptionKey: existingTrip.p2pEncryptionKey }
        : {}),
  };

  const location = meta.get('location');
  if (typeof location === 'string' && location.length > 0) {
    trip.location = location;
  }

  const description = meta.get('description');
  if (typeof description === 'string' && description.length > 0) {
    trip.description = description;
  }

  const coordinates = meta.get('coordinates');
  if (
    coordinates &&
    typeof coordinates === 'object' &&
    typeof (coordinates as { lat?: unknown }).lat === 'number' &&
    typeof (coordinates as { lon?: unknown }).lon === 'number'
  ) {
    trip.coordinates = {
      lat: (coordinates as { lat: number }).lat,
      lon: (coordinates as { lon: number }).lon,
    };
  }

  return trip;
}

function readCollection(doc: Y.Doc, name: SharedCollectionName): SharedRecord[] {
  return sortCollection(name, doc.getArray(name).toArray() as SharedRecord[]);
}

async function replaceTripScopedRows<T extends { id: string; tripId: TripId }>(
  currentRows: readonly T[],
  nextRows: readonly T[],
  putMany: (rows: T[]) => Promise<unknown>,
  removeMany: (ids: string[]) => Promise<unknown>,
): Promise<void> {
  if (nextRows.length > 0) {
    await putMany([...nextRows]);
  }

  const nextIds = new Set(nextRows.map((row) => row.id));
  const idsToDelete = currentRows
    .filter((row) => !nextIds.has(row.id))
    .map((row) => row.id);

  if (idsToDelete.length > 0) {
    await removeMany(idsToDelete);
  }
}

export async function loadPersistedUpdates(doc: Y.Doc, roomId: string): Promise<void> {
  const rows = await db.yjsUpdates.where('roomId').equals(roomId).toArray();

  Y.transact(doc, () => {
    for (const row of rows) {
      Y.applyUpdate(doc, row.update);
    }
  });

  if (rows.length >= COMPACTION_THRESHOLD) {
    await compactUpdates(doc, roomId);
  }
}

export function subscribeToUpdates(doc: Y.Doc, roomId: string): () => void {
  let updateCount = 0;

  const handleUpdate = (update: Uint8Array, origin: unknown): void => {
    void db.yjsUpdates.add({ roomId, update }).catch((error) => {
      console.error('[yjs-bridge] Failed to persist update:', error);
    });

    updateCount += 1;
    if (updateCount >= COMPACTION_THRESHOLD) {
      updateCount = 0;
      void compactUpdates(doc, roomId).catch((error) => {
        console.error('[yjs-bridge] Failed to compact updates:', error);
      });
    }

    if (origin !== ORIGIN_DEXIE_SYNC) {
      void syncDocToDexie(doc, roomId);
    }
  };

  doc.on('update', handleUpdate);
  return () => {
    doc.off('update', handleUpdate);
  };
}

export async function compactUpdates(doc: Y.Doc, roomId: string): Promise<void> {
  const snapshot = Y.encodeStateAsUpdate(doc);

  await db.transaction('rw', db.yjsUpdates, async () => {
    await db.yjsUpdates.where('roomId').equals(roomId).delete();
    await db.yjsUpdates.add({ roomId, update: snapshot });
  });
}

export async function syncDocToDexie(doc: Y.Doc, roomId: string): Promise<TripId | null> {
  const nextTrip = buildTripRecord(doc, roomId, await db.trips.get(getMeta(doc).get('id') as TripId));
  if (!nextTrip) {
    return null;
  }

  const tripId = nextTrip.id;

  try {
    await db.transaction(
      'rw',
      [db.trips, db.persons, db.rooms, db.roomAssignments, db.transports, db.activities],
      async () => {
        await db.trips.put(nextTrip);

        const currentGuests = await db.persons.where('tripId').equals(tripId).toArray();
        const currentRooms = await db.rooms
          .where('[tripId+order]')
          .between([tripId, -Infinity], [tripId, Infinity])
          .toArray();
        const currentAssignments = await db.roomAssignments
          .where('[tripId+startDate]')
          .between([tripId, ''], [tripId, '\uffff'])
          .toArray();
        const currentTransport = await db.transports
          .where('[tripId+datetime]')
          .between([tripId, ''], [tripId, '\uffff'])
          .toArray();
        const currentActivities = await db.activities
          .where('[tripId+startDatetime]')
          .between([tripId, ''], [tripId, '\uffff'])
          .toArray();

        const nextGuests = readCollection(doc, 'guests').map(
          (guest) => ({ ...guest, tripId } as Person),
        );
        const nextRooms = readCollection(doc, 'rooms').map(
          (room) => ({ ...room, tripId } as Room),
        );
        const nextAssignments = readCollection(doc, 'roomAssignments').map(
          (assignment) => ({ ...assignment, tripId } as RoomAssignment),
        );
        const nextTransport = readCollection(doc, 'transport').map(
          (transport) => ({ ...transport, tripId } as Transport),
        );
        const nextActivities = readCollection(doc, 'activities').map(
          (activity) => ({ ...activity, tripId } as Activity),
        );

        await replaceTripScopedRows(
          currentGuests,
          nextGuests,
          (rows) => db.persons.bulkPut(rows),
          (ids) => db.persons.bulkDelete([...ids]),
        );
        await replaceTripScopedRows(
          currentRooms,
          nextRooms,
          (rows) => db.rooms.bulkPut(rows),
          (ids) => db.rooms.bulkDelete([...ids]),
        );
        await replaceTripScopedRows(
          currentAssignments,
          nextAssignments,
          (rows) => db.roomAssignments.bulkPut(rows),
          (ids) => db.roomAssignments.bulkDelete([...ids]),
        );
        await replaceTripScopedRows(
          currentTransport,
          nextTransport,
          (rows) => db.transports.bulkPut(rows),
          (ids) => db.transports.bulkDelete([...ids]),
        );
        await replaceTripScopedRows(
          currentActivities,
          nextActivities,
          (rows) => db.activities.bulkPut(rows),
          (ids) => db.activities.bulkDelete([...ids]),
        );
      },
    );
  } catch (error) {
    console.error('[yjs-bridge] Failed to sync Y.Doc → Dexie:', error);
  }

  return tripId;
}

export const applyDocToDexie = syncDocToDexie;

export async function populateDocFromDexie(doc: Y.Doc, tripId: TripId): Promise<void> {
  const [trip, guests, rooms, assignments, transport, activities] = await Promise.all([
    db.trips.get(tripId),
    db.persons.where('tripId').equals(tripId).toArray(),
    db.rooms
      .where('[tripId+order]')
      .between([tripId, -Infinity], [tripId, Infinity])
      .toArray(),
    db.roomAssignments
      .where('[tripId+startDate]')
      .between([tripId, ''], [tripId, '\uffff'])
      .toArray(),
    db.transports
      .where('[tripId+datetime]')
      .between([tripId, ''], [tripId, '\uffff'])
      .toArray(),
    db.activities
      .where('[tripId+startDatetime]')
      .between([tripId, ''], [tripId, '\uffff'])
      .toArray(),
  ]);

  if (!trip) {
    return;
  }

  Y.transact(doc, () => {
    const meta = getMeta(doc);
    meta.set('id', trip.id);
    meta.set('name', trip.name);
    meta.set('startDate', trip.startDate);
    meta.set('endDate', trip.endDate);
    meta.set('shareId', trip.shareId);
    meta.set('createdAt', trip.createdAt);
    meta.set('updatedAt', trip.updatedAt);
    if (trip.location !== undefined) meta.set('location', trip.location);
    if (trip.description !== undefined) meta.set('description', trip.description);
    if (trip.coordinates !== undefined) meta.set('coordinates', trip.coordinates);

    const guestsArray = doc.getArray('guests');
    sortCollection('guests', guests.map((guest) => stripTripId(guest))).forEach((guest) => {
      guestsArray.push([guest]);
    });

    const roomsArray = doc.getArray('rooms');
    sortCollection('rooms', rooms.map((room) => stripTripId(room))).forEach((room) => {
      roomsArray.push([room]);
    });

    const assignmentsArray = doc.getArray('roomAssignments');
    sortCollection('roomAssignments', assignments.map((assignment) => stripTripId(assignment))).forEach((assignment) => {
      assignmentsArray.push([assignment]);
    });

    const transportArray = doc.getArray('transport');
    sortCollection('transport', transport.map((item) => stripTripId(item))).forEach((item) => {
      transportArray.push([item]);
    });

    const activitiesArray = doc.getArray('activities');
    sortCollection('activities', activities.map((item) => stripTripId(item))).forEach((item) => {
      activitiesArray.push([item]);
    });
  });
}

export function syncDexieToDoc(
  doc: Y.Doc,
  table: SharedCollectionName,
  items: SharedRecord[],
): void {
  const array = doc.getArray(table);
  const nextItems = sortCollection(table, items);
  const currentItems = sortCollection(table, array.toArray() as SharedRecord[]);

  if (areEqual(currentItems, nextItems)) {
    return;
  }

  Y.transact(
    doc,
    () => {
      array.delete(0, array.length);
      for (const item of nextItems) {
        array.push([item]);
      }
    },
    ORIGIN_DEXIE_SYNC,
  );
}

export function syncTripMetaToDoc(doc: Y.Doc, updates: Record<string, unknown>): void {
  const meta = getMeta(doc);
  const entries = Object.entries(updates).filter(
    ([key]) => key !== 'id' && key !== 'shareId' && key !== 'createdAt',
  );

  const hasChanges = entries.some(([key, value]) => {
    if (value === undefined) {
      return meta.has(key);
    }
    return !areEqual(meta.get(key), value);
  });

  if (!hasChanges) {
    return;
  }

  Y.transact(
    doc,
    () => {
      for (const [key, value] of entries) {
        if (value === undefined) {
          meta.delete(key);
        } else {
          meta.set(key, value);
        }
      }
    },
    ORIGIN_DEXIE_SYNC,
  );
}
