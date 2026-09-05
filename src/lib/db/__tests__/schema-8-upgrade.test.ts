/**
 * The schema 8 upgrade.
 *
 * A data migration with no test is the one kind of change that can destroy
 * something irreplaceable and say nothing. This one re-keys every persisted Yjs
 * update from the WebRTC room id to the trip id, so getting it wrong loses the
 * local CRDT history of every trip on the device — which for an unshared trip is
 * the only copy that exists.
 *
 * The version under test is opened directly rather than through `db`, because
 * the point is the *transition* from a v7 database with real rows in it.
 *
 * @module lib/db/__tests__/schema-8-upgrade.test
 */

import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { KikouchouDatabase } from '@/lib/db/database';

// ============================================================================
// Helpers
// ============================================================================

const DB_NAME = 'kikouchou-schema-8-probe';

/** The v7 schema, verbatim, so the fixture is a genuine old database. */
function openV7(): Dexie {
  const legacy = new Dexie(DB_NAME);
  legacy.version(7).stores({
    trips: 'id, &shareId, p2pRoomId, remoteTripId, startDate, createdAt',
    rooms: 'id, [tripId+order]',
    persons: 'id, tripId, [tripId+name]',
    roomAssignments:
      'id, roomId, personId, [tripId+startDate], [tripId+personId], [tripId+roomId]',
    transports: 'id, personId, driverId, [tripId+datetime], [tripId+personId], [tripId+type]',
    activities:
      'id, tripId, organizerId, *participantIds, [tripId+startDatetime], [tripId+category]',
    settings: 'id',
    yjsUpdates: '++id, roomId',
    yjsOutbox: '++id, tripId',
    syncCursors: 'tripId',
    tripMembers: '[tripId+userId], tripId, userId',
  });
  return legacy;
}

/** Reopens the same database at the current schema, running the upgrade. */
async function upgradeToCurrent(): Promise<KikouchouDatabase> {
  const upgraded = new KikouchouDatabase(DB_NAME);
  await upgraded.open();
  return upgraded;
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

describe('schema 8 upgrade', () => {
  it('re-keys a trip\'s persisted updates from its room id to its trip id', async () => {
    const legacy = openV7();
    await legacy.open();
    await legacy.table('trips').add({
      id: 'trip-alpha',
      name: 'Alpha',
      shareId: 'share-alpha',
      startDate: '2026-07-15',
      endDate: '2026-07-22',
      createdAt: 1,
      updatedAt: 1,
      p2pRoomId: 'room-alpha',
      p2pEncryptionKey: 'key-alpha',
    });
    await legacy.table('yjsUpdates').bulkAdd([
      { roomId: 'room-alpha', update: new Uint8Array([1, 2, 3]) },
      { roomId: 'room-alpha', update: new Uint8Array([4, 5, 6]) },
    ]);
    legacy.close();

    const db = await upgradeToCurrent();

    const rows = await db.yjsUpdates.where('tripId').equals('trip-alpha').toArray();
    expect(rows).toHaveLength(2);
    // The bytes are the CRDT history; losing or corrupting them loses the trip.
    expect(rows.map((row) => Array.from(row.update)).sort()).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    db.close();
  });

  it('leaves no row still keyed on a room id', async () => {
    const legacy = openV7();
    await legacy.open();
    await legacy.table('trips').add({
      id: 'trip-alpha',
      name: 'Alpha',
      shareId: 'share-alpha',
      startDate: '2026-07-15',
      endDate: '2026-07-22',
      createdAt: 1,
      updatedAt: 1,
      p2pRoomId: 'room-alpha',
    });
    await legacy.table('yjsUpdates').add({
      roomId: 'room-alpha',
      update: new Uint8Array([1]),
    });
    legacy.close();

    const db = await upgradeToCurrent();

    const all = await db.yjsUpdates.toArray();
    expect(all).toHaveLength(1);
    // A leftover `roomId` would be dead weight that nothing reads and that the
    // type no longer describes.
    expect(all[0]).not.toHaveProperty('roomId');
    expect(all[0]?.tripId).toBe('trip-alpha');
    db.close();
  });

  it('keeps each trip\'s updates separate', async () => {
    const legacy = openV7();
    await legacy.open();
    await legacy.table('trips').bulkAdd([
      {
        id: 'trip-alpha',
        name: 'Alpha',
        shareId: 'share-alpha',
        startDate: '2026-07-15',
        endDate: '2026-07-22',
        createdAt: 1,
        updatedAt: 1,
        p2pRoomId: 'room-alpha',
      },
      {
        id: 'trip-beta',
        name: 'Beta',
        shareId: 'share-beta',
        startDate: '2026-08-15',
        endDate: '2026-08-22',
        createdAt: 2,
        updatedAt: 2,
        p2pRoomId: 'room-beta',
      },
    ]);
    await legacy.table('yjsUpdates').bulkAdd([
      { roomId: 'room-alpha', update: new Uint8Array([1]) },
      { roomId: 'room-beta', update: new Uint8Array([2]) },
      { roomId: 'room-beta', update: new Uint8Array([3]) },
    ]);
    legacy.close();

    const db = await upgradeToCurrent();

    // Cross-contaminating two trips' histories would merge unrelated documents.
    expect(await db.yjsUpdates.where('tripId').equals('trip-alpha').count()).toBe(1);
    expect(await db.yjsUpdates.where('tripId').equals('trip-beta').count()).toBe(2);
    db.close();
  });

  it('drops updates whose room belongs to no trip', async () => {
    const legacy = openV7();
    await legacy.open();
    await legacy.table('trips').add({
      id: 'trip-alpha',
      name: 'Alpha',
      shareId: 'share-alpha',
      startDate: '2026-07-15',
      endDate: '2026-07-22',
      createdAt: 1,
      updatedAt: 1,
      p2pRoomId: 'room-alpha',
    });
    await legacy.table('yjsUpdates').bulkAdd([
      { roomId: 'room-alpha', update: new Uint8Array([1]) },
      // Left behind by a trip that was deleted before the cascade purged its log.
      { roomId: 'room-vanished', update: new Uint8Array([9]) },
    ]);
    legacy.close();

    const db = await upgradeToCurrent();

    const all = await db.yjsUpdates.toArray();
    // Keeping it would mean a row no query can reach and no trip can project.
    expect(all).toHaveLength(1);
    expect(all[0]?.tripId).toBe('trip-alpha');
    db.close();
  });

  it('upgrades a database that has no updates at all', async () => {
    const legacy = openV7();
    await legacy.open();
    await legacy.table('trips').add({
      id: 'trip-alpha',
      name: 'Alpha',
      shareId: 'share-alpha',
      startDate: '2026-07-15',
      endDate: '2026-07-22',
      createdAt: 1,
      updatedAt: 1,
    });
    legacy.close();

    const db = await upgradeToCurrent();

    // The common case for anyone who never shared a trip: no rows, no room ids,
    // and the upgrade must still complete rather than throw.
    expect(await db.yjsUpdates.count()).toBe(0);
    expect(await db.trips.count()).toBe(1);
    db.close();
  });

  it('preserves everything else on the trip', async () => {
    const legacy = openV7();
    await legacy.open();
    await legacy.table('trips').add({
      id: 'trip-alpha',
      name: 'Alpha',
      shareId: 'share-alpha',
      startDate: '2026-07-15',
      endDate: '2026-07-22',
      createdAt: 1,
      updatedAt: 1,
      p2pRoomId: 'room-alpha',
      remoteTripId: 'server-row-1',
    });
    legacy.close();

    const db = await upgradeToCurrent();

    const trip = await db.trips.get('trip-alpha');
    expect(trip).toMatchObject({
      name: 'Alpha',
      shareId: 'share-alpha',
      // The link to the server row is the one field that must survive: losing it
      // would orphan the trip from its sync.
      remoteTripId: 'server-row-1',
    });
    db.close();
  });
});
