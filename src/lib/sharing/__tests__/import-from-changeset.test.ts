/**
 * @fileoverview Tests for import-from-changeset — room name mapping, rewrites,
 * and the main prepareChangesetForLocalImport entry point.
 *
 * @module lib/sharing/__tests__/import-from-changeset.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  buildRoomIdMapByName,
  ImportChangesetError,
  IMPORT_SNAPSHOT_REQUIRED,
  prepareChangesetForLocalImport,
  rewriteChangesetForTargetTrip,
  rewriteChangesetTripId,
} from '@/lib/sharing/import-from-changeset';
import type { AppChangeset, TripSnapshotMeta } from '@/lib/sharing/types';
import type { HexColor, ISODateString, PersonId, Room, RoomAssignmentId, RoomId, Trip, TripId } from '@/types';

// ============================================================================
// Mocks
// ============================================================================

const mockGetTripByShareId = vi.fn();
const mockGetAllTrips = vi.fn();
const mockGetRoomsByTripId = vi.fn();
const mockCreateTrip = vi.fn();

vi.mock('@/lib/db', () => ({
  getTripByShareId: (...args: unknown[]) => mockGetTripByShareId(...args),
  getAllTrips: (...args: unknown[]) => mockGetAllTrips(...args),
  getRoomsByTripId: (...args: unknown[]) => mockGetRoomsByTripId(...args),
  createTrip: (...args: unknown[]) => mockCreateTrip(...args),
}));

const TRIP_A = 'trip-a' as TripId;
const TRIP_B = 'trip-b' as TripId;

describe('buildRoomIdMapByName', () => {
  it('maps export room ids to local ids when normalized names match', () => {
    const exportRooms: Room[] = [
      { id: 'exp1' as RoomId, tripId: TRIP_A, name: '  Master  ', capacity: 2, order: 0 },
    ];
    const localRooms: Room[] = [
      { id: 'loc1' as RoomId, tripId: TRIP_B, name: 'master', capacity: 4, order: 1 },
    ];
    const map = buildRoomIdMapByName(exportRooms, localRooms);
    expect(map.get('exp1' as RoomId)).toBe('loc1');
  });

  it('does not map when names differ', () => {
    const exportRooms: Room[] = [
      { id: 'exp1' as RoomId, tripId: TRIP_A, name: 'A', capacity: 2, order: 0 },
    ];
    const localRooms: Room[] = [
      { id: 'loc1' as RoomId, tripId: TRIP_B, name: 'B', capacity: 2, order: 0 },
    ];
    expect(buildRoomIdMapByName(exportRooms, localRooms).size).toBe(0);
  });
});

describe('rewriteChangesetTripId / rewriteChangesetForTargetTrip', () => {
  const base: AppChangeset = {
    version: 1,
    tripId: TRIP_A,
    shareId: 'share1',
    exportedBy: 'p1' as PersonId,
    exportedAt: 1,
    baseSnapshotAt: 1,
    added: {
      persons: [
        {
          id: 'p1' as PersonId,
          tripId: TRIP_A,
          name: 'Alice',
          color: '#000000' as HexColor,
        },
      ],
      assignments: [
        {
          id: 'a1' as RoomAssignmentId,
          tripId: TRIP_A,
          roomId: 'expR' as RoomId,
          personId: 'p1' as PersonId,
          startDate: '2024-07-01' as ISODateString,
          endDate: '2024-07-05' as ISODateString,
        },
      ],
      transports: [],
      rooms: [
        {
          id: 'expR' as RoomId,
          tripId: TRIP_A,
          name: 'Room',
          capacity: 2,
          order: 0,
        },
      ],
    },
    modified: { persons: [], assignments: [], transports: [], rooms: [] },
  };

  it('rewrites all trip ids for a cold import', () => {
    const out = rewriteChangesetTripId(base, TRIP_B);
    expect(out.tripId).toBe(TRIP_B);
    expect(out.added.persons[0]?.tripId).toBe(TRIP_B);
    expect(out.added.assignments[0]?.tripId).toBe(TRIP_B);
    expect(out.added.rooms[0]?.tripId).toBe(TRIP_B);
  });

  it('rewrites assignment room ids when rooms map by name', () => {
    const roomMap = new Map<RoomId, RoomId>([['expR' as RoomId, 'locR' as RoomId]]);
    const out = rewriteChangesetForTargetTrip(base, TRIP_B, roomMap);
    expect(out.added.assignments[0]?.roomId).toBe('locR');
    expect(out.added.rooms[0]?.id).toBe('locR');
  });

  it('rewrites modified collection as well', () => {
    const changeset: AppChangeset = {
      ...base,
      added: { persons: [], assignments: [], transports: [], rooms: [] },
      modified: base.added,
    };
    const out = rewriteChangesetTripId(changeset, TRIP_B);
    expect(out.modified.persons[0]?.tripId).toBe(TRIP_B);
    expect(out.modified.rooms[0]?.tripId).toBe(TRIP_B);
  });

  it('keeps room id when no mapping exists', () => {
    const emptyMap = new Map<RoomId, RoomId>();
    const out = rewriteChangesetForTargetTrip(base, TRIP_B, emptyMap);
    expect(out.added.rooms[0]?.id).toBe('expR');
    expect(out.added.assignments[0]?.roomId).toBe('expR');
  });
});

// ============================================================================
// prepareChangesetForLocalImport
// ============================================================================

describe('prepareChangesetForLocalImport', () => {
  const snapshot: TripSnapshotMeta = {
    name: 'Beach Trip',
    startDate: '2026-07-01' as ISODateString,
    endDate: '2026-07-10' as ISODateString,
    location: 'Nice',
  };

  const baseChangeset: AppChangeset = {
    version: 1,
    tripId: TRIP_A,
    shareId: 'share-xyz',
    exportedBy: 'p1' as PersonId,
    exportedAt: 1,
    baseSnapshotAt: 1,
    added: {
      persons: [],
      assignments: [],
      transports: [],
      rooms: [{ id: 'r1' as RoomId, tripId: TRIP_A, name: 'Suite', capacity: 3, order: 0 }],
    },
    modified: { persons: [], assignments: [], transports: [], rooms: [] },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTripByShareId.mockResolvedValue(null);
    mockGetAllTrips.mockResolvedValue([]);
    mockGetRoomsByTripId.mockResolvedValue([]);
  });

  it('matches by shareId and rewrites to the found trip', async () => {
    const localTrip = { id: TRIP_B, name: 'Beach Trip', shareId: 'share-xyz' } as Trip;
    mockGetTripByShareId.mockResolvedValue(localTrip);
    mockGetRoomsByTripId.mockResolvedValue([]);

    const result = await prepareChangesetForLocalImport(baseChangeset);

    expect(result.targetTripId).toBe(TRIP_B);
    expect(result.prepared.tripId).toBe(TRIP_B);
    expect(mockGetTripByShareId).toHaveBeenCalledWith('share-xyz');
  });

  it('matches by shareId and maps rooms by name', async () => {
    const localTrip = { id: TRIP_B, name: 'Beach Trip' } as Trip;
    const localRoom: Room = { id: 'localR' as RoomId, tripId: TRIP_B, name: 'suite', capacity: 2, order: 0 };
    mockGetTripByShareId.mockResolvedValue(localTrip);
    mockGetRoomsByTripId.mockResolvedValue([localRoom]);

    const result = await prepareChangesetForLocalImport(baseChangeset);

    expect(result.prepared.added.rooms[0]?.id).toBe('localR');
  });

  it('falls back to matching by trip name when shareId not found', async () => {
    const localTrip = { id: TRIP_B, name: 'Beach Trip' } as Trip;
    mockGetTripByShareId.mockResolvedValue(null);
    mockGetAllTrips.mockResolvedValue([localTrip]);
    mockGetRoomsByTripId.mockResolvedValue([]);

    const changesetWithSnapshot = { ...baseChangeset, tripSnapshot: snapshot };
    const result = await prepareChangesetForLocalImport(changesetWithSnapshot);

    expect(result.targetTripId).toBe(TRIP_B);
    expect(mockGetAllTrips).toHaveBeenCalled();
  });

  it('normalizes trip names for matching (whitespace, case)', async () => {
    const localTrip = { id: TRIP_B, name: '  beach   trip  ' } as Trip;
    mockGetTripByShareId.mockResolvedValue(null);
    mockGetAllTrips.mockResolvedValue([localTrip]);
    mockGetRoomsByTripId.mockResolvedValue([]);

    const changesetWithSnapshot = { ...baseChangeset, tripSnapshot: snapshot };
    const result = await prepareChangesetForLocalImport(changesetWithSnapshot);

    expect(result.targetTripId).toBe(TRIP_B);
  });

  it('creates a new trip from snapshot when no match found', async () => {
    const newTrip = { id: 'new-trip' as TripId, name: 'Beach Trip' } as Trip;
    mockGetTripByShareId.mockResolvedValue(null);
    mockGetAllTrips.mockResolvedValue([]);
    mockCreateTrip.mockResolvedValue(newTrip);

    const changesetWithSnapshot = { ...baseChangeset, tripSnapshot: snapshot };
    const result = await prepareChangesetForLocalImport(changesetWithSnapshot);

    expect(result.targetTripId).toBe('new-trip');
    expect(mockCreateTrip).toHaveBeenCalledWith({
      name: 'Beach Trip',
      startDate: '2026-07-01',
      endDate: '2026-07-10',
      location: 'Nice',
      description: undefined,
      coordinates: undefined,
    });
  });

  it('throws ImportChangesetError when no snapshot and no shareId match', async () => {
    mockGetTripByShareId.mockResolvedValue(null);

    // Changeset without tripSnapshot
    await expect(
      prepareChangesetForLocalImport(baseChangeset),
    ).rejects.toThrow(ImportChangesetError);

    try {
      await prepareChangesetForLocalImport(baseChangeset);
    } catch (error) {
      expect(error).toBeInstanceOf(ImportChangesetError);
      expect((error as ImportChangesetError).code).toBe(IMPORT_SNAPSHOT_REQUIRED);
    }
  });

  it('collects rooms from both added and modified collections', async () => {
    const localTrip = { id: TRIP_B, name: 'Trip' } as Trip;
    mockGetTripByShareId.mockResolvedValue(localTrip);
    // Local room matches 'Suite' from added, and 'Loft' from modified
    mockGetRoomsByTripId.mockResolvedValue([
      { id: 'locSuite' as RoomId, tripId: TRIP_B, name: 'Suite', capacity: 2, order: 0 },
      { id: 'locLoft' as RoomId, tripId: TRIP_B, name: 'Loft', capacity: 2, order: 1 },
    ]);

    const changeset: AppChangeset = {
      ...baseChangeset,
      modified: {
        persons: [],
        assignments: [],
        transports: [],
        rooms: [{ id: 'r2' as RoomId, tripId: TRIP_A, name: 'Loft', capacity: 4, order: 1 }],
      },
    };

    const result = await prepareChangesetForLocalImport(changeset);

    expect(result.prepared.added.rooms[0]?.id).toBe('locSuite');
    expect(result.prepared.modified.rooms[0]?.id).toBe('locLoft');
  });
});

// ============================================================================
// ImportChangesetError
// ============================================================================

describe('ImportChangesetError', () => {
  it('has correct name and code', () => {
    const error = new ImportChangesetError(IMPORT_SNAPSHOT_REQUIRED, 'test message');
    expect(error.name).toBe('ImportChangesetError');
    expect(error.code).toBe('import_snapshot_required');
    expect(error.message).toBe('test message');
    expect(error).toBeInstanceOf(Error);
  });
});
