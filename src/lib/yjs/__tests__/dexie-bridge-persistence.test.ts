/**
 * The bridge's other half: what it persists, when it compacts, which updates
 * it projects back, and what it pushes from Dexie into the document.
 *
 * `dexie-bridge.test.ts` is about the trust boundary on the way in. These pin
 * the bookkeeping around it, where a wrong comparison does not corrupt one row
 * but quietly stops the log from shrinking, projects the device's own echo
 * back over itself, or writes the trip's identity keys into the shared meta.
 *
 * @module lib/yjs/__tests__/dexie-bridge-persistence.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { db } from '@/lib/db/database';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import {
  ORIGIN_DEXIE_SYNC,
  loadPersistedUpdates,
  populateDocFromDexie,
  subscribeToUpdates,
  syncDexieToDoc,
  syncDocToDexie,
  syncTripMetaToDoc,
} from '@/lib/yjs/dexie-bridge';
import { DOC_SCHEMA_VERSION, readDocCollection, upsertDocEntity } from '@/lib/yjs/doc-model';
import { isoDate } from '@/test/utils';
import type { PhotoId, TripId } from '@/types';

// ============================================================================
// Mocks
// ============================================================================

const { mockReportError, mockNotifyError } = vi.hoisted(() => ({
  mockReportError: vi.fn(),
  mockNotifyError: vi.fn(),
}));

vi.mock('@/lib/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/posthog')>()),
  reportError: (...args: unknown[]) => mockReportError(...args),
}));

vi.mock('@/lib/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/notifications')>();
  return {
    ...actual,
    notify: { ...actual.notify, error: (...args: unknown[]) => mockNotifyError(...args) },
  };
});

// ============================================================================
// Helpers
// ============================================================================

const COMPACTION_THRESHOLD = 100;

async function makeTrip(): Promise<TripId> {
  const trip = await createTrip({
    name: 'Brittany',
    startDate: isoDate('2026-08-01'),
    endDate: isoDate('2026-08-05'),
  });
  return trip.id;
}

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  const meta = doc.getMap('meta');
  meta.set('schema', DOC_SCHEMA_VERSION);
  meta.set('name', 'Brittany');
  meta.set('startDate', '2026-08-01');
  meta.set('endDate', '2026-08-05');
  return doc;
}

/** One small edit per call, so each one emits exactly one update. */
function edit(doc: Y.Doc, index: number, origin?: unknown): void {
  doc.transact(() => {
    doc.getMap('scratch').set(`k${index}`, index);
  }, origin);
}

async function persistedCount(tripId: TripId): Promise<number> {
  return db.yjsUpdates.where('tripId').equals(tripId).count();
}

let unsubscribe: (() => void) | undefined;

beforeEach(() => {
  unsubscribe = undefined;
});

afterEach(() => {
  unsubscribe?.();
});

// ============================================================================
// subscribeToUpdates
// ============================================================================

describe('subscribeToUpdates', () => {
  it('persists every update under the trip it was given', async () => {
    const tripId = await makeTrip();
    const doc = makeDoc();
    unsubscribe = subscribeToUpdates(doc, tripId);

    edit(doc, 1, ORIGIN_DEXIE_SYNC);
    edit(doc, 2, ORIGIN_DEXIE_SYNC);

    await vi.waitFor(async () => {
      expect(await persistedCount(tripId)).toBe(2);
    });
  });

  it('stops persisting once unsubscribed', async () => {
    const tripId = await makeTrip();
    const doc = makeDoc();
    subscribeToUpdates(doc, tripId)();

    edit(doc, 1, ORIGIN_DEXIE_SYNC);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(await persistedCount(tripId)).toBe(0);
  });

  it('logs an update it could not persist', async () => {
    const tripId = await makeTrip();
    const doc = makeDoc();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(db.yjsUpdates, 'add').mockRejectedValueOnce(new Error('disk full'));
    unsubscribe = subscribeToUpdates(doc, tripId);

    edit(doc, 1, ORIGIN_DEXIE_SYNC);

    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith(
        '[yjs-bridge] Failed to persist update:',
        expect.any(Error),
      );
    });
  });

  it('compacts the log on the hundredth update and not before', async () => {
    const tripId = await makeTrip();
    const doc = makeDoc();
    unsubscribe = subscribeToUpdates(doc, tripId);

    for (let index = 1; index < COMPACTION_THRESHOLD; index += 1) {
      edit(doc, index, ORIGIN_DEXIE_SYNC);
    }
    await vi.waitFor(async () => {
      expect(await persistedCount(tripId)).toBe(COMPACTION_THRESHOLD - 1);
    });

    edit(doc, COMPACTION_THRESHOLD, ORIGIN_DEXIE_SYNC);

    await vi.waitFor(async () => {
      expect(await persistedCount(tripId)).toBe(1);
    });
    const rebuilt = new Y.Doc();
    await loadPersistedUpdates(rebuilt, tripId);
    expect(rebuilt.getMap('scratch').size).toBe(COMPACTION_THRESHOLD);
  });

  it('logs a compaction it could not finish', async () => {
    const tripId = await makeTrip();
    const doc = makeDoc();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    unsubscribe = subscribeToUpdates(doc, tripId);
    vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('disk full') as never);

    for (let index = 1; index <= COMPACTION_THRESHOLD; index += 1) {
      edit(doc, index, ORIGIN_DEXIE_SYNC);
    }

    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith(
        '[yjs-bridge] Failed to compact updates:',
        expect.any(Error),
      );
    });
  });

  it('projects a remote update into Dexie', async () => {
    const tripId = await makeTrip();
    const doc = makeDoc();
    unsubscribe = subscribeToUpdates(doc, tripId);

    doc.transact(() => {
      upsertDocEntity(doc, 'rooms', { id: 'r1', name: 'Attic', capacity: 2, order: 0 });
    }, 'remote');

    await vi.waitFor(async () => {
      expect(await db.rooms.get('r1')).toBeDefined();
    });
  });

  it('does not project back the device\'s own Dexie writes', async () => {
    const tripId = await makeTrip();
    const doc = makeDoc();
    unsubscribe = subscribeToUpdates(doc, tripId);

    doc.transact(() => {
      upsertDocEntity(doc, 'rooms', { id: 'r1', name: 'Attic', capacity: 2, order: 0 });
    }, ORIGIN_DEXIE_SYNC);

    await vi.waitFor(async () => {
      expect(await persistedCount(tripId)).toBe(1);
    });
    expect(await db.rooms.get('r1')).toBeUndefined();
  });

  it('reports a projection that failed outside its own handling', async () => {
    const tripId = await makeTrip();
    const doc = makeDoc();
    const failure = new Error('disk gone');
    vi.spyOn(db.trips, 'get').mockRejectedValueOnce(failure);
    unsubscribe = subscribeToUpdates(doc, tripId);

    edit(doc, 1, 'remote');

    await vi.waitFor(() => {
      expect(mockReportError).toHaveBeenCalledWith(failure, {
        source: 'dexie-bridge.subscribeToUpdates',
      });
    });
  });
});

// ============================================================================
// loadPersistedUpdates and the projection's failure report
// ============================================================================

describe('loadPersistedUpdates', () => {
  it('compacts a log that reached the threshold while it was closed', async () => {
    const tripId = await makeTrip();
    const source = new Y.Doc();
    const rows: { tripId: TripId; update: Uint8Array }[] = [];
    source.on('update', (update: Uint8Array) => rows.push({ tripId, update }));
    for (let index = 1; index <= COMPACTION_THRESHOLD; index += 1) {
      edit(source, index);
    }
    await db.yjsUpdates.bulkAdd(rows);

    const doc = new Y.Doc();
    await loadPersistedUpdates(doc, tripId);

    expect(doc.getMap('scratch').size).toBe(COMPACTION_THRESHOLD);
    expect(await persistedCount(tripId)).toBe(1);
  });
});

describe('syncDocToDexie: a projection that fails', () => {
  it('tells the user the trip could not be saved, naming the trip', async () => {
    const tripId = await makeTrip();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('disk full') as never);

    await syncDocToDexie(makeDoc(), tripId);

    expect(mockNotifyError).toHaveBeenCalledWith(
      'errors.syncFailed',
      expect.anything(),
    );
    expect(mockReportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ source: 'dexie-bridge.syncDocToDexie', trip_id: tripId }),
    );
  });
});

// ============================================================================
// populateDocFromDexie
// ============================================================================

describe('populateDocFromDexie', () => {
  it('seeds the trip\'s optional metadata into the document', async () => {
    const tripId = await makeTrip();
    await db.trips.update(tripId, {
      currency: 'EUR',
      description: 'By the sea',
      archived: true,
      photoId: 'coverPhoto0001' as PhotoId,
    });
    const doc = new Y.Doc();

    await populateDocFromDexie(doc, tripId);

    const meta = doc.getMap('meta');
    expect(meta.get('currency')).toBe('EUR');
    expect(meta.get('description')).toBe('By the sea');
    expect(meta.get('archived')).toBe(true);
    expect(meta.get('photoId')).toBe('coverPhoto0001');
  });

  it('claims nothing about a trip that is not archived', async () => {
    const tripId = await makeTrip();
    const doc = new Y.Doc();

    await populateDocFromDexie(doc, tripId);

    expect(doc.getMap('meta').has('archived')).toBe(false);
  });
});

// ============================================================================
// syncDexieToDoc
// ============================================================================

describe('syncDexieToDoc', () => {
  it('writes the rows it is given', () => {
    const doc = makeDoc();

    syncDexieToDoc(doc, 'rooms', [{ id: 'r1', name: 'Attic', capacity: 2, order: 0 }], {
      allowDeletions: false,
    });

    expect(readDocCollection(doc, 'rooms').map((room) => room.id)).toEqual(['r1']);
  });

  it('writes nothing for an empty set it may not prune with', () => {
    const doc = makeDoc();
    upsertDocEntity(doc, 'rooms', { id: 'r1', name: 'Attic', capacity: 2, order: 0 });
    const updates = vi.fn();
    doc.on('update', updates);

    syncDexieToDoc(doc, 'rooms', [], { allowDeletions: false });

    expect(updates).not.toHaveBeenCalled();
    expect(readDocCollection(doc, 'rooms')).toHaveLength(1);
  });

  it('prunes with an empty set when the mirror is trusted', () => {
    const doc = makeDoc();
    upsertDocEntity(doc, 'rooms', { id: 'r1', name: 'Attic', capacity: 2, order: 0 });

    syncDexieToDoc(doc, 'rooms', [], { allowDeletions: true });

    expect(readDocCollection(doc, 'rooms')).toEqual([]);
  });
});

// ============================================================================
// syncTripMetaToDoc
// ============================================================================

describe('syncTripMetaToDoc', () => {
  it('writes the trip fields and never the identity keys', () => {
    const doc = new Y.Doc();

    syncTripMetaToDoc(doc, {
      id: 'local-id',
      shareId: 'share-1',
      createdAt: 1,
      name: 'Brittany',
    });

    const meta = doc.getMap('meta');
    expect(meta.get('name')).toBe('Brittany');
    expect(meta.has('id')).toBe(false);
    expect(meta.has('shareId')).toBe(false);
    expect(meta.has('createdAt')).toBe(false);
  });

  it('writes nothing when nothing changed', () => {
    const doc = new Y.Doc();
    syncTripMetaToDoc(doc, { name: 'Brittany', location: 'Vannes' });
    const updates = vi.fn();
    doc.on('update', updates);

    syncTripMetaToDoc(doc, { name: 'Brittany', location: 'Vannes', id: 'local-id' });

    expect(updates).not.toHaveBeenCalled();
  });

  it('writes when one field of several changed', () => {
    const doc = new Y.Doc();
    syncTripMetaToDoc(doc, { name: 'Brittany', location: 'Vannes' });

    syncTripMetaToDoc(doc, { name: 'Brittany', location: 'Quimper' });

    expect(doc.getMap('meta').get('location')).toBe('Quimper');
  });

  it('removes a field cleared to undefined, and only when it is there', () => {
    const doc = new Y.Doc();
    syncTripMetaToDoc(doc, { name: 'Brittany', location: 'Vannes' });

    syncTripMetaToDoc(doc, { location: undefined });
    expect(doc.getMap('meta').has('location')).toBe(false);

    const updates = vi.fn();
    doc.on('update', updates);
    syncTripMetaToDoc(doc, { location: undefined });
    expect(updates).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Older documents, and what populating reads
// ============================================================================

describe('documents an older build wrote', () => {
  it('converts a persisted array-based document while loading it', async () => {
    const tripId = await makeTrip();
    const legacy = new Y.Doc();
    legacy.getArray('rooms').push([{ id: 'r1', name: 'Attic', capacity: 2, order: 0 }]);
    await db.yjsUpdates.add({ tripId, update: Y.encodeStateAsUpdate(legacy) });

    const doc = new Y.Doc();
    await loadPersistedUpdates(doc, tripId);

    expect(readDocCollection(doc, 'rooms').map((room) => room.id)).toEqual(['r1']);
  });

  it('says why it refuses a remote document on the old schema', async () => {
    const tripId = await makeTrip();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await syncDocToDexie(new Y.Doc(), tripId);

    expect(warn).toHaveBeenCalledWith(
      '[yjs] refusing remote update: doc schema v%d predates v%d',
      1,
      DOC_SCHEMA_VERSION,
    );
  });
});

describe('populateDocFromDexie, row by row', () => {
  /** A trip whose id sorts before any generated one, so a lost lower bound shows. */
  const OTHER = '!other-trip' as TripId;

  async function seedTrip(tripId: TripId, prefix: string, key: (field: string) => string): Promise<void> {
    await db.rooms.put({ id: `${prefix}room`, tripId, name: 'Attic', capacity: 2, order: 0 } as never);
    await db.roomAssignments.put({ id: `${prefix}stay`, tripId, roomId: 'r', personId: 'p', startDate: key('day'), endDate: key('day') } as never);
    await db.transports.put({ id: `${prefix}leg`, tripId, personId: 'p', type: 'arrival', datetime: key('instant'), location: 'Vannes', needsPickup: false } as never);
    await db.rides.put({ id: `${prefix}ride`, tripId, direction: 'pickup', meetDatetime: key('instant'), location: 'Vannes' } as never);
    await db.vehicles.put({ id: `${prefix}car`, tripId, name: 'Espace' } as never);
    await db.activities.put({ id: `${prefix}outing`, tripId, title: 'Market', category: 'market', startDatetime: key('instant'), allDay: false, participantIds: [] } as never);
    await db.expenses.put({ id: `${prefix}line`, tripId, kind: 'expense', category: 'meal', title: 'Lunch', date: key('day'), amount: 1, payerId: 'p', splitMode: 'equal', splits: [] } as never);
  }

  const COLLECTIONS = [
    ['rooms', 'room'],
    ['roomAssignments', 'stay'],
    ['transport', 'leg'],
    ['rides', 'ride'],
    ['vehicles', 'car'],
    ['activities', 'outing'],
    ['expenses', 'line'],
  ] as const;

  it('seeds the rows of its own trip that carry real dates', async () => {
    const tripId = await makeTrip();
    await seedTrip(tripId, 'ours-', (kind) =>
      kind === 'day' ? '2026-08-02' : '2026-08-02T09:00:00.000Z',
    );
    const doc = new Y.Doc();

    await populateDocFromDexie(doc, tripId);

    for (const [name, suffix] of COLLECTIONS) {
      expect(readDocCollection(doc, name).map((row) => row.id), name).toEqual([`ours-${suffix}`]);
    }
  });

  it('seeds every row of its own trip, whatever its sort key, and none of another', async () => {
    const tripId = await makeTrip();
    await seedTrip(OTHER, 'theirs-', () => '2026-08-02');
    // A lower-case sort key sorts after every date and after any other text.
    await seedTrip(tripId, 'ours-', () => 'tbd');
    const doc = new Y.Doc();

    await populateDocFromDexie(doc, tripId);

    for (const [name, suffix] of COLLECTIONS) {
      expect(readDocCollection(doc, name).map((row) => row.id), name).toEqual([`ours-${suffix}`]);
    }
  });

  it('writes the trip window and clock, and no key the trip does not have', async () => {
    const tripId = await makeTrip();
    const trip = await db.trips.get(tripId);
    const doc = new Y.Doc();

    await populateDocFromDexie(doc, tripId);

    const meta = doc.getMap('meta');
    expect(meta.get('startDate')).toBe('2026-08-01');
    expect(meta.get('endDate')).toBe('2026-08-05');
    expect(meta.get('updatedAt')).toBe(trip?.updatedAt);
    expect(meta.has('currency')).toBe(false);
    expect(meta.has('location')).toBe(false);
    expect(meta.has('description')).toBe(false);
  });

  it('seeds without pruning what the document already holds', async () => {
    const tripId = await makeTrip();
    const doc = new Y.Doc();
    upsertDocEntity(doc, 'rooms', { id: 'from-the-owner', name: 'Barn', capacity: 4, order: 1 });

    await populateDocFromDexie(doc, tripId);

    expect(readDocCollection(doc, 'rooms').map((room) => room.id)).toEqual(['from-the-owner']);
  });
});

describe('syncDexieToDoc: rows with no usable id', () => {
  it('writes only the rows that carry a non-empty string id', () => {
    const doc = makeDoc();

    syncDexieToDoc(
      doc,
      'rooms',
      [
        { id: '', name: 'Blank' },
        { id: 7, name: 'Numbered' },
        { id: 'r1', name: 'Attic', capacity: 2, order: 0 },
      ] as never,
      { allowDeletions: false },
    );

    expect(readDocCollection(doc, 'rooms').map((room) => room.id)).toEqual(['r1']);
  });
});
