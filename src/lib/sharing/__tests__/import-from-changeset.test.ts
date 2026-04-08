/**
 * @fileoverview Tests for import-from-changeset — room name mapping and rewrites.
 *
 * @module lib/sharing/__tests__/import-from-changeset.test
 */

import { describe, expect, it } from 'vitest';

import {
  buildRoomIdMapByName,
  rewriteChangesetForTargetTrip,
  rewriteChangesetTripId,
} from '@/lib/sharing/import-from-changeset';
import type { AppChangeset } from '@/lib/sharing/types';
import type { HexColor, ISODateString, PersonId, Room, RoomAssignmentId, RoomId, TripId } from '@/types';

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
});
