/**
 * @fileoverview Tests for export-service — baseline management and changeset building.
 *
 * @module lib/sharing/__tests__/export-service-extended.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { db } from '@/lib/db/database';
import { saveBaseline, loadBaseline, buildChangeset, createBaselineForGuest } from '../export-service';
import { getBaselineStorageKey } from '../types';
import type { ImportBaseline } from '../types';
import type { PersonId, TripId, ISODateString, HexColor, RoomId, RoomAssignmentId, TransportId } from '@/types';

const { mockReportError } = vi.hoisted(() => ({ mockReportError: vi.fn() }));
vi.mock('@/lib/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/posthog')>()),
  reportError: (...args: unknown[]) => mockReportError(...args),
}));

// ============================================================================
// localStorage mock (happy-dom may not provide a full implementation)
// ============================================================================

const localStorageMock: Record<string, string> = {};

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => localStorageMock[key] ?? null,
    setItem: (key: string, value: string) => { localStorageMock[key] = value; },
    removeItem: (key: string) => { delete localStorageMock[key]; },
    clear: () => { Object.keys(localStorageMock).forEach(k => { delete localStorageMock[k]; }); },
    get length() { return Object.keys(localStorageMock).length; },
    key: (i: number) => Object.keys(localStorageMock)[i] ?? null,
  },
  writable: true,
  configurable: true,
});

// ============================================================================
// Test Data
// ============================================================================

const TRIP_ID = 'trip-export-1' as TripId;
const SHARE_ID = 'share-export-1';
const PERSON_ID = 'person-export-1' as PersonId;

function seedPerson(id: string = PERSON_ID as string) {
  return db.persons.put({
    id: id as PersonId,
    tripId: TRIP_ID,
    name: 'Test Person',
    color: '#ef4444' as HexColor,
  });
}

function seedAssignment(id: string, personId: string = PERSON_ID as string) {
  return db.roomAssignments.put({
    id: id as RoomAssignmentId,
    tripId: TRIP_ID,
    roomId: 'room-1' as RoomId,
    personId: personId as PersonId,
    startDate: '2024-07-15' as ISODateString,
    endDate: '2024-07-20' as ISODateString,
  });
}

function seedTransport(id: string, personId: string = PERSON_ID as string) {
  return db.transports.put({
    id: id as TransportId,
    tripId: TRIP_ID,
    personId: personId as PersonId,
    type: 'arrival',
    datetime: '2024-07-15T14:00:00.000Z',
    location: 'Station',
    needsPickup: false,
  });
}

// ============================================================================
// Baseline Tests
// ============================================================================

describe('saveBaseline / loadBaseline', () => {
  const baseline: ImportBaseline = {
    tripId: TRIP_ID,
    shareId: SHARE_ID,
    personId: PERSON_ID,
    importedAt: Date.now(),
    snapshot: {
      personIds: [PERSON_ID],
      assignmentIds: ['a1'],
      transportIds: ['t1'],
    },
  };

  beforeEach(() => {
    localStorage.clear();
  });

  it('saves and loads a baseline', () => {
    saveBaseline(baseline);
    const loaded = loadBaseline(SHARE_ID);
    expect(loaded).toEqual(baseline);
  });

  it('returns null when no baseline exists', () => {
    expect(loadBaseline('nonexistent')).toBeNull();
  });

  it('handles localStorage errors in saveBaseline gracefully', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const originalSetItem = localStorage.setItem;
    localStorage.setItem = () => {
      throw new Error('QuotaExceeded');
    };

    // Should not throw
    saveBaseline(baseline);

    localStorage.setItem = originalSetItem;
    spy.mockRestore();
  });

  it('handles corrupt JSON in loadBaseline', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const key = getBaselineStorageKey(SHARE_ID);
    localStorage.setItem(key, '{corrupt');

    const result = loadBaseline(SHARE_ID);
    expect(result).toBeNull();

    spy.mockRestore();
  });
});

// ============================================================================
// buildChangeset Tests
// ============================================================================

describe('buildChangeset', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when no baseline exists', async () => {
    const result = await buildChangeset(TRIP_ID, SHARE_ID, PERSON_ID);
    expect(result).toBeNull();
  });

  it('throws when person not found', async () => {
    const baseline: ImportBaseline = {
      tripId: TRIP_ID,
      shareId: SHARE_ID,
      personId: PERSON_ID,
      importedAt: Date.now(),
      snapshot: { personIds: [], assignmentIds: [], transportIds: [] },
    };
    saveBaseline(baseline);

    await expect(buildChangeset(TRIP_ID, SHARE_ID, PERSON_ID)).rejects.toThrow(
      'not found',
    );
  });

  it('classifies new entities as added', async () => {
    await seedPerson();
    await seedAssignment('new-a1');
    await seedTransport('new-t1');

    // Baseline has no known IDs
    const baseline: ImportBaseline = {
      tripId: TRIP_ID,
      shareId: SHARE_ID,
      personId: PERSON_ID,
      importedAt: Date.now(),
      snapshot: { personIds: [], assignmentIds: [], transportIds: [] },
    };
    saveBaseline(baseline);

    const changeset = await buildChangeset(TRIP_ID, SHARE_ID, PERSON_ID);
    expect(changeset).not.toBeNull();
    expect(changeset!.added.persons).toHaveLength(1);
    expect(changeset!.added.assignments).toHaveLength(1);
    expect(changeset!.added.transports).toHaveLength(1);
    expect(changeset!.modified.persons).toHaveLength(0);
  });

  it('classifies existing entities as modified', async () => {
    await seedPerson();
    await seedAssignment('known-a1');

    // Baseline knows about the person and assignment
    const baseline: ImportBaseline = {
      tripId: TRIP_ID,
      shareId: SHARE_ID,
      personId: PERSON_ID,
      importedAt: Date.now(),
      snapshot: {
        personIds: [PERSON_ID],
        assignmentIds: ['known-a1'],
        transportIds: [],
      },
    };
    saveBaseline(baseline);

    const changeset = await buildChangeset(TRIP_ID, SHARE_ID, PERSON_ID);
    expect(changeset).not.toBeNull();
    expect(changeset!.modified.persons).toHaveLength(1);
    expect(changeset!.modified.assignments).toHaveLength(1);
    expect(changeset!.added.persons).toHaveLength(0);
    expect(changeset!.added.assignments).toHaveLength(0);
  });
});

// ============================================================================
// createBaselineForGuest Tests
// ============================================================================

describe('createBaselineForGuest', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('creates and persists a baseline with current entity IDs', async () => {
    await seedPerson();
    await seedAssignment('baseline-a1');
    await seedTransport('baseline-t1');

    const baseline = await createBaselineForGuest(TRIP_ID, SHARE_ID, PERSON_ID);

    expect(baseline.tripId).toBe(TRIP_ID);
    expect(baseline.shareId).toBe(SHARE_ID);
    expect(baseline.personId).toBe(PERSON_ID);
    expect(baseline.snapshot.personIds).toContain(PERSON_ID);
    expect(baseline.snapshot.assignmentIds).toContain('baseline-a1');
    expect(baseline.snapshot.transportIds).toContain('baseline-t1');

    // Verify persisted to localStorage
    const loaded = loadBaseline(SHARE_ID);
    expect(loaded).toEqual(baseline);
  });

  it('creates baseline with empty arrays when guest has no entities', async () => {
    await seedPerson();

    const baseline = await createBaselineForGuest(TRIP_ID, SHARE_ID, PERSON_ID);

    expect(baseline.snapshot.assignmentIds).toEqual([]);
    expect(baseline.snapshot.transportIds).toEqual([]);
  });
});

// ============================================================================
// Reporting and classification, in full
// ============================================================================

describe('baseline failures are reported', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reports a baseline it could not save, naming where', () => {
    const failure = new Error('QuotaExceeded');
    const originalSetItem = localStorage.setItem;
    localStorage.setItem = () => {
      throw failure;
    };

    try {
      saveBaseline({
        tripId: TRIP_ID,
        shareId: SHARE_ID,
        personId: PERSON_ID,
        importedAt: 0,
        snapshot: { personIds: [], assignmentIds: [], transportIds: [] },
      });
    } finally {
      localStorage.setItem = originalSetItem;
    }

    expect(mockReportError).toHaveBeenCalledWith(failure, {
      source: 'export-service.saveBaseline',
    });
  });

  it('logs a baseline it could not read', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem(getBaselineStorageKey(SHARE_ID), '{corrupt');

    loadBaseline(SHARE_ID);

    expect(spy).toHaveBeenCalledWith('Failed to load import baseline:', expect.any(Error));
  });
});

describe('buildChangeset: each row lands in exactly one half', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('splits rows the baseline knew from rows it did not', async () => {
    await seedPerson();
    await seedAssignment('known-a1');
    await seedAssignment('new-a1');
    await seedTransport('known-t1');
    await seedTransport('new-t1');
    saveBaseline({
      tripId: TRIP_ID,
      shareId: SHARE_ID,
      personId: PERSON_ID,
      importedAt: 1,
      snapshot: {
        personIds: [PERSON_ID],
        assignmentIds: ['known-a1'],
        transportIds: ['known-t1'],
      },
    });

    const changeset = await buildChangeset(TRIP_ID, SHARE_ID, PERSON_ID);

    expect(changeset?.added.persons).toEqual([]);
    expect(changeset?.added.assignments.map((a) => a.id)).toEqual(['new-a1']);
    expect(changeset?.added.transports.map((t) => t.id)).toEqual(['new-t1']);
    expect(changeset?.added.rooms).toEqual([]);
    expect(changeset?.modified.persons.map((p) => p.id)).toEqual([PERSON_ID]);
    expect(changeset?.modified.assignments.map((a) => a.id)).toEqual(['known-a1']);
    expect(changeset?.modified.transports.map((t) => t.id)).toEqual(['known-t1']);
    expect(changeset?.modified.rooms).toEqual([]);
  });

  it('leaves out the guest assignments of another trip', async () => {
    await seedPerson();
    await seedAssignment('here-a1');
    await db.roomAssignments.put({
      id: 'elsewhere-a1' as RoomAssignmentId,
      tripId: 'trip-other' as TripId,
      roomId: 'room-1' as RoomId,
      personId: PERSON_ID,
      startDate: '2024-07-15' as ISODateString,
      endDate: '2024-07-20' as ISODateString,
    });

    const baseline = await createBaselineForGuest(TRIP_ID, SHARE_ID, PERSON_ID);

    expect(baseline.snapshot.assignmentIds).toEqual(['here-a1']);
  });
});

describe('getBaselineStorageKey', () => {
  it('files a baseline under the import prefix and its share id', () => {
    expect(getBaselineStorageKey('share-1')).toBe('kikouchou_import_baseline_share-1');
  });
});
