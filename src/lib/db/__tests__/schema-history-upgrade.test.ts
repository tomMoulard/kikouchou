/**
 * Every schema version a device can still be on upgrades to the current one,
 * with its rows intact.
 *
 * A fresh install never runs the old `version(n).stores()` declarations: Dexie
 * creates the final schema in one step. They run only on a device that last
 * opened the app at an older version, and there each one is a step of the
 * upgrade. A wrong declaration there does not show on any developer machine,
 * because no developer machine is old. It shows as an upgrade that throws, or
 * as a table dropped and recreated empty halfway through, on the phones of the
 * people who used the app first.
 *
 * Each case below writes a database at one historical version, with one row in
 * every table that version had, and opens it with the current class. The
 * schemas are copied verbatim, as `schema-8-upgrade.test.ts` does for v7: the
 * fixture has to be a genuine old database, not the current code's idea of one.
 *
 * @module lib/db/__tests__/schema-history-upgrade.test
 */

import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KikouchouDatabase } from '@/lib/db/database';

// ============================================================================
// Historical schemas, verbatim
// ============================================================================

const V1 = {
  trips: 'id, &shareId, startDate, createdAt',
  rooms: 'id, [tripId+order]',
  persons: 'id, tripId, [tripId+name]',
  roomAssignments: 'id, roomId, [tripId+startDate], [tripId+personId], [tripId+roomId]',
  transports: 'id, [tripId+datetime], [tripId+personId], [tripId+type]',
  settings: 'id',
};

const V2 = {
  ...V1,
  roomAssignments:
    'id, roomId, personId, [tripId+startDate], [tripId+personId], [tripId+roomId]',
  transports: 'id, personId, driverId, [tripId+datetime], [tripId+personId], [tripId+type]',
};

const V3 = V2;

const V4 = { ...V3, yjsUpdates: '++id, roomId' };

const V5 = { ...V4, trips: 'id, &shareId, p2pRoomId, startDate, createdAt' };

const V6 = {
  ...V5,
  activities:
    'id, tripId, organizerId, *participantIds, [tripId+startDatetime], [tripId+category]',
};

const V7 = {
  ...V6,
  trips: 'id, &shareId, p2pRoomId, remoteTripId, startDate, createdAt',
  yjsOutbox: '++id, tripId',
  syncCursors: 'tripId',
  tripMembers: '[tripId+userId], tripId, userId',
};

const V8 = {
  ...V7,
  trips: 'id, &shareId, remoteTripId, startDate, createdAt',
  yjsUpdates: '++id, tripId',
};

const V9 = { ...V8, guestGroups: 'id, name, remoteGroupId' };

const V10 = {
  ...V9,
  transports:
    'id, personId, driverId, rideId, [tripId+datetime], [tripId+personId], [tripId+type]',
  rides: 'id, tripId, driverId, vehicleId, [tripId+meetDatetime]',
  vehicles: 'id, tripId, ownerId',
  rideNotices: 'key, tripId',
};

const V11 = { ...V10, expenses: 'id, tripId, payerId, [tripId+date]' };

const V12 = {
  ...V11,
  rooms: 'id, tripId, [tripId+order]',
  roomAssignments:
    'id, tripId, roomId, personId, [tripId+startDate], [tripId+personId], [tripId+roomId]',
  transports:
    'id, tripId, personId, driverId, rideId, [tripId+datetime], [tripId+personId], [tripId+type]',
};

const V13 = { ...V12, photos: '[tripId+id], tripId, pending' };

const V14 = {
  ...V13,
  meals: 'id, tripId, *organizerIds, [tripId+date]',
  shoppingItems: 'id, tripId, buyerId',
};

const HISTORY: readonly (readonly [number, Record<string, string>])[] = [
  [1, V1],
  [2, V2],
  [3, V3],
  [4, V4],
  [5, V5],
  [6, V6],
  [7, V7],
  [8, V8],
  [9, V9],
  [10, V10],
  [11, V11],
  [12, V12],
];

// ============================================================================
// Fixtures
// ============================================================================

const DB_NAME = 'kikouchou-schema-history-probe';
const TRIP_ID = 'trip-1';
const ROOM_ID = 'p2p-room-1';

/** One row per table, keyed so the upgraded database can be asked for it back. */
const ROWS: Record<string, Record<string, unknown>> = {
  trips: {
    id: TRIP_ID,
    name: 'Brittany',
    shareId: 'share-1',
    startDate: '2026-07-15',
    endDate: '2026-07-22',
    createdAt: 1,
    updatedAt: 1,
    p2pRoomId: ROOM_ID,
  },
  rooms: { id: 'room-1', tripId: TRIP_ID, name: 'Attic', capacity: 2, order: 0 },
  persons: { id: 'person-1', tripId: TRIP_ID, name: 'Mary', color: '#3b82f6' },
  roomAssignments: {
    id: 'assignment-1',
    tripId: TRIP_ID,
    roomId: 'room-1',
    personId: 'person-1',
    startDate: '2026-07-15',
    endDate: '2026-07-18',
  },
  transports: {
    id: 'transport-1',
    tripId: TRIP_ID,
    personId: 'person-1',
    type: 'arrival',
    datetime: '2026-07-15T14:00:00.000Z',
    location: 'Vannes',
    needsPickup: false,
  },
  settings: { id: 'settings', language: 'en' },
  activities: {
    id: 'activity-1',
    tripId: TRIP_ID,
    title: 'Market',
    category: 'market',
    startDatetime: '2026-07-16T09:00:00.000Z',
    allDay: false,
    participantIds: ['person-1'],
  },
  yjsOutbox: { tripId: TRIP_ID, update: new Uint8Array([7]) },
  syncCursors: { tripId: TRIP_ID, cursor: 3 },
  tripMembers: { tripId: TRIP_ID, userId: 'user-1', role: 'owner' },
  guestGroups: { id: 'group-1', name: 'Family', members: [] },
  rides: {
    id: 'ride-1',
    tripId: TRIP_ID,
    direction: 'pickup',
    meetDatetime: '2026-07-15T13:30:00.000Z',
    location: 'Vannes',
  },
  vehicles: { id: 'vehicle-1', tripId: TRIP_ID, name: 'Espace' },
  rideNotices: { key: 'notice-1', tripId: TRIP_ID },
  expenses: {
    id: 'expense-1',
    tripId: TRIP_ID,
    payerId: 'person-1',
    date: '2026-07-16',
    amount: 30,
  },
  meals: {
    id: 'meal-1',
    tripId: TRIP_ID,
    date: '2026-07-16',
    slot: 'dinner',
    kind: 'home',
    organizerIds: ['person-1'],
  },
  shoppingItems: {
    id: 'item-1',
    tripId: TRIP_ID,
    name: 'Bread',
    checked: false,
    createdAt: 1,
  },
};

/** The CRDT log, which v8 re-keyed from the WebRTC room to the trip. */
function yjsUpdateRow(version: number): Record<string, unknown> {
  return version < 8
    ? { roomId: ROOM_ID, update: new Uint8Array([1, 2, 3]) }
    : { tripId: TRIP_ID, update: new Uint8Array([1, 2, 3]) };
}

async function writeLegacyDatabase(
  version: number,
  schema: Record<string, string>,
): Promise<void> {
  const legacy = new Dexie(DB_NAME);
  legacy.version(version).stores(schema);
  await legacy.open();
  for (const table of Object.keys(schema)) {
    await legacy
      .table(table)
      .add(table === 'yjsUpdates' ? yjsUpdateRow(version) : ROWS[table]);
  }
  legacy.close();
}

beforeEach(async () => {
  await Dexie.delete(DB_NAME);
});

afterEach(async () => {
  await Dexie.delete(DB_NAME);
});

// ============================================================================
// Tests
// ============================================================================

describe('upgrading from every historical schema', () => {
  it.each(HISTORY)('opens a v%i database with every row still in it', async (version, schema) => {
    await writeLegacyDatabase(version, schema);

    const upgraded = new KikouchouDatabase(DB_NAME);
    try {
      await upgraded.open();

      expect(upgraded.verno).toBe(14);
      for (const table of Object.keys(schema)) {
        if (table === 'yjsUpdates') {
          const rows = await upgraded.yjsUpdates.where('tripId').equals(TRIP_ID).toArray();
          expect(rows.map((row) => Array.from(row.update))).toEqual([[1, 2, 3]]);
          continue;
        }
        expect(await upgraded.table(table).count(), table).toBe(1);
      }
    } finally {
      upgraded.close();
    }
  });
});

describe('schema 8 report on the log it could not re-key', () => {
  it('says how many updates it dropped', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await writeLegacyDatabase(7, V7);
    const legacy = new Dexie(DB_NAME);
    legacy.version(7).stores(V7);
    await legacy.open();
    await legacy.table('yjsUpdates').add({ roomId: 'room-vanished', update: new Uint8Array([9]) });
    legacy.close();

    const upgraded = new KikouchouDatabase(DB_NAME);
    await upgraded.open();
    upgraded.close();

    expect(info).toHaveBeenCalledWith(
      '[db] schema 8 dropped %d Yjs updates whose trip no longer exists',
      1,
    );
  });

  it('says nothing when every update found its trip', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await writeLegacyDatabase(7, V7);

    const upgraded = new KikouchouDatabase(DB_NAME);
    await upgraded.open();
    upgraded.close();

    expect(info).not.toHaveBeenCalled();
  });

  it('does not file updates under a trip whose room id is blank', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const legacy = new Dexie(DB_NAME);
    legacy.version(7).stores(V7);
    await legacy.open();
    await legacy.table('trips').add({ ...ROWS.trips, p2pRoomId: '' });
    await legacy.table('yjsUpdates').add({ roomId: '', update: new Uint8Array([9]) });
    legacy.close();

    const upgraded = new KikouchouDatabase(DB_NAME);
    await upgraded.open();
    try {
      expect(await upgraded.yjsUpdates.count()).toBe(0);
    } finally {
      upgraded.close();
    }
  });

  it('upgrades a trip that never had a room id', async () => {
    const legacy = new Dexie(DB_NAME);
    legacy.version(7).stores(V7);
    await legacy.open();
    const trip: Record<string, unknown> = { ...ROWS.trips };
    delete trip.p2pRoomId;
    await legacy.table('trips').add(trip);
    legacy.close();

    const upgraded = new KikouchouDatabase(DB_NAME);
    await upgraded.open();
    try {
      expect(await upgraded.trips.count()).toBe(1);
    } finally {
      upgraded.close();
    }
  });
});

describe('the current schema', () => {
  it('finds rows by their trip even when the second half of a compound key is missing', async () => {
    const current = new KikouchouDatabase(DB_NAME);
    await current.open();
    try {
      await current.rooms.put({ id: 'no-order', tripId: TRIP_ID, name: 'Loft', capacity: 1 } as never);
      await current.roomAssignments.put({ id: 'no-start', tripId: TRIP_ID, roomId: 'r', personId: 'p' } as never);
      await current.transports.put({ id: 'no-time', tripId: TRIP_ID, personId: 'p', type: 'arrival', location: 'x', needsPickup: false } as never);

      expect(await current.rooms.where('tripId').equals(TRIP_ID).count()).toBe(1);
      expect(await current.roomAssignments.where('tripId').equals(TRIP_ID).count()).toBe(1);
      expect(await current.transports.where('tripId').equals(TRIP_ID).count()).toBe(1);
    } finally {
      current.close();
    }
  });
});

describe('two tabs on different schema versions', () => {
  it('lets go of the database when another tab upgrades it, without Dexie\'s warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const current = new KikouchouDatabase(DB_NAME);
    await current.open();

    const newer = new Dexie(DB_NAME);
    newer.version(15).stores(V14);
    await newer.open();

    expect(current.isOpen()).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    newer.close();
  });

  it('warns when an older tab blocks the upgrade', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const older = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const current = new KikouchouDatabase(DB_NAME);
    const opening = current.open();
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        '[db] upgrade blocked by another open tab: close other Kikouchou tabs',
      );
    });

    older.close();
    await opening;
    current.close();
  });
});
