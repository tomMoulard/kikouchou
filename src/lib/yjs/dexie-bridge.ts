/**
 * @fileoverview Yjs ↔ Dexie persistence bridge.
 *
 * Persists raw Yjs binary updates into the yjsUpdates table so the Y.Doc
 * can be reconstructed after a page reload without needing a server.
 * Also syncs the CRDT state back into the existing Dexie tables so the
 * rest of the application continues reading Dexie as before.
 *
 * The document's shape lives in `./doc-model` — this module only moves data
 * between it and Dexie, and owns the trust boundary in `syncDocToDexie`.
 *
 * @module lib/yjs/dexie-bridge
 */

import * as Y from 'yjs';

import { db } from '@/lib/db/database';
import {
  DOC_SCHEMA_VERSION,
  type DocCollectionName,
  isDeepEqual,
  migrateLegacyArrayCollections,
  readDocCollection,
  readDocSchemaVersion,
  replaceDocCollection,
  stampDocSchemaVersion,
} from './doc-model';
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

export type SharedCollectionName = DocCollectionName;
export type { DocCollectionName };
type SharedRecord = Record<string, unknown>;

function stripTripId<T extends { tripId: TripId }>(record: T): SharedRecord {
  const nextRecord = { ...record } as Record<string, unknown>;
  delete nextRecord.tripId;
  return nextRecord;
}

function getMeta(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('meta');
}

function buildTripRecord(
  doc: Y.Doc,
  roomId: string,
  existingTrip?: Trip,
  encryptionKey?: string,
): Trip | null {
  const meta = getMeta(doc);
  const id = meta.get('id');
  if (typeof id !== 'string') {
    return null;
  }

  const createdAt = meta.get('createdAt');
  const updatedAt = meta.get('updatedAt');

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
    // NEVER take shareId from a peer: it is a UNIQUE Dexie index, so a value
    // colliding with another local trip aborts the whole write transaction and
    // permanently kills sync for this trip.
    shareId: existingTrip?.shareId ?? (id.slice(0, 10) as ShareId),
    createdAt:
      ((typeof createdAt === 'number' ? createdAt : existingTrip?.createdAt) as UnixTimestamp | undefined) ??
      (Date.now() as UnixTimestamp),
    updatedAt:
      ((typeof updatedAt === 'number' ? updatedAt : existingTrip?.updatedAt) as UnixTimestamp | undefined) ??
      (Date.now() as UnixTimestamp),
    p2pRoomId: roomId,
    // The encryption key is NEVER derived from window.location here. Reading
    // the URL fragment meant any in-page anchor — the a11y skip link
    // `#main-content` among them — overwrote the trip's real key on the next
    // remote update, permanently breaking sync with its existing peers.
    // The join flow passes the key in explicitly instead.
    ...(encryptionKey
      ? { p2pEncryptionKey: encryptionKey }
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
  return readDocCollection(doc, name);
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

  // A document persisted by an older build stores its collections as arrays.
  // Convert before anything reads it, so the first projection to Dexie sees the
  // trip's real contents rather than five empty maps. Idempotent, and safe to
  // run on every device: the conversion is keyed on each record's own id.
  if (readDocSchemaVersion(doc) < DOC_SCHEMA_VERSION) {
    migrateLegacyArrayCollections(doc);
  }

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

export async function syncDocToDexie(
  doc: Y.Doc,
  roomId: string,
  /**
   * The room's encryption key, supplied by the join flow that read it from the
   * share link. Only pass this where the key is genuinely known; it must never
   * be inferred from `window.location` inside this module.
   */
  encryptionKey?: string,
): Promise<TripId | null> {
  const claimedId = getMeta(doc).get('id');
  if (typeof claimedId !== 'string' || claimedId.length === 0) {
    // Validate before the lookup: an object here would make Dexie reject an
    // invalid key and reject this promise, and the caller invokes us as a bare
    // `void`, producing an unhandled rejection on every remote update.
    return null;
  }

  // The trip this room is actually bound to locally. `meta.id` is remote
  // controlled, so using it as the write key let any peer in this room
  // overwrite — and wipe the contents of — a DIFFERENT local trip.
  const ownerTrip = await db.trips
    .where('p2pRoomId')
    .equals(roomId)
    .first();

  if (ownerTrip && ownerTrip.id !== claimedId) {
    console.warn(
      '[yjs] refusing remote update: doc claims trip',
      claimedId,
      'but room',
      roomId,
      'belongs to',
      ownerTrip.id,
    );
    return null;
  }

  // A document written by an older build keeps its collections in `Y.Array`s,
  // so every `…ById` map reads as legitimately empty. Projecting that would
  // delete every guest, room, assignment, transport and activity of a trip
  // whose data is intact — the emptiness is a schema mismatch, not a deletion.
  // `loadPersistedUpdates` converts local documents on open; this guards the
  // remaining case, a peer that has not upgraded yet.
  const schemaVersion = readDocSchemaVersion(doc);
  if (schemaVersion < DOC_SCHEMA_VERSION) {
    console.warn(
      '[yjs] refusing remote update: doc schema v%d predates v%d',
      schemaVersion,
      DOC_SCHEMA_VERSION,
    );
    return null;
  }

  const nextTrip = buildTripRecord(
    doc,
    roomId,
    ownerTrip ?? (await db.trips.get(claimedId as TripId)),
    encryptionKey,
  );
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

    stampDocSchemaVersion(doc);

    const sources: readonly [
      DocCollectionName,
      readonly { id: string; tripId: TripId }[],
    ][] = [
      ['guests', guests],
      ['rooms', rooms],
      ['roomAssignments', assignments],
      ['transport', transport],
      ['activities', activities],
    ];

    for (const [name, rows] of sources) {
      replaceDocCollection(
        doc,
        name,
        rows.map((row) => stripTripId(row) as SharedRecord & { id: string }),
      );
    }
  });
}

/**
 * Pushes a Dexie collection into the document, upserting each row and removing
 * the ids that are gone.
 *
 * This used to clear the whole `Y.Array` and rebuild it, which made every local
 * change collide with every concurrent remote one: the merge kept both peers'
 * deletions and both peers' inserts, and `bulkPut` then silently dropped an
 * edit or restored a deleted row. Per-entity writes keep unrelated edits out of
 * each other's way — see `./doc-model`.
 */
export function syncDexieToDoc(
  doc: Y.Doc,
  table: SharedCollectionName,
  items: SharedRecord[],
): void {
  const entities = items.filter(
    (item): item is SharedRecord & { id: string } =>
      typeof item.id === 'string' && item.id.length > 0,
  );

  Y.transact(
    doc,
    () => {
      replaceDocCollection(doc, table, entities);
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
    return !isDeepEqual(meta.get(key), value);
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
