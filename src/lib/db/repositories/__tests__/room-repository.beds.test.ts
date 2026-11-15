/**
 * Tests for a room's beds: the normalizers that bound them and the repository
 * that keeps the stored capacity equal to what they sleep.
 *
 * @module lib/db/repositories/__tests__/room-repository.beds.test
 */
import { describe, it, expect } from 'vitest';

import { db } from '@/lib/db/database';
import {
  normalizeBedLayouts,
  normalizeExtraSpots,
  normalizeRoomBeds,
} from '@/lib/db/sanitize';
import {
  cloneRoomsToTrip,
  createRoom,
  duplicateRoomWithOwnershipCheck,
  updateRoom,
  updateRoomWithOwnershipCheck,
} from '@/lib/db/repositories/room-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { isoDate } from '@/test/utils';
import {
  MAX_BEDS_PER_LAYOUT,
  MAX_ROOM_BED_LAYOUTS,
  MAX_ROOM_CAPACITY,
  computeRoomCapacityFromBeds,
  getBedLayoutSleeps,
} from '@/types';
import type { RoomBedLayout, TripId } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

/** The room of the request: two 80 × 200 singles, or one queen. */
const TWIN_OR_TOGETHER: RoomBedLayout[] = [
  { name: 'Twin', beds: [{ kind: 'single', count: 2, widthCm: 80, lengthCm: 200 }] },
  { name: 'Together', beds: [{ kind: 'queen', count: 1 }] },
];

async function createTestTrip(): Promise<TripId> {
  const trip = await createTrip({
    name: 'Beds',
    startDate: isoDate('2026-07-01'),
    endDate: isoDate('2026-07-08'),
  });
  return trip.id;
}

// ============================================================================
// Capacity from beds
// ============================================================================

describe('computeRoomCapacityFromBeds', () => {
  it('counts what each kind sleeps', () => {
    expect(getBedLayoutSleeps({ beds: [{ kind: 'single', count: 2 }] })).toBe(2);
    expect(getBedLayoutSleeps({ beds: [{ kind: 'queen', count: 1 }, { kind: 'cot', count: 1 }] })).toBe(3);
    expect(getBedLayoutSleeps({ beds: [{ kind: 'bunk', count: 2 }] })).toBe(4);
  });

  it('takes the largest layout, plus the extra spots', () => {
    const layouts: RoomBedLayout[] = [
      { beds: [{ kind: 'single', count: 1 }] },
      { beds: [{ kind: 'sofa-bed', count: 1 }, { kind: 'single', count: 1 }] },
    ];

    expect(computeRoomCapacityFromBeds(layouts, undefined)).toBe(3);
    expect(computeRoomCapacityFromBeds(layouts, 2)).toBe(5);
  });

  it('answers null for a room that describes no beds', () => {
    expect(computeRoomCapacityFromBeds(undefined, 3)).toBeNull();
    expect(computeRoomCapacityFromBeds([], 3)).toBeNull();
  });
});

// ============================================================================
// Normalizers (remote input)
// ============================================================================

describe('normalizeBedLayouts', () => {
  it('keeps a valid layout as it is', () => {
    expect(normalizeBedLayouts(TWIN_OR_TOGETHER)).toEqual(TWIN_OR_TOGETHER);
  });

  it('drops a line of an unknown kind on its own', () => {
    expect(
      normalizeBedLayouts([
        { beds: [{ kind: 'waterbed', count: 1 }, { kind: 'single', count: 1 }] },
      ]),
    ).toEqual([{ beds: [{ kind: 'single', count: 1 }] }]);
  });

  it('drops a layout left with no line, and answers undefined when none is left', () => {
    expect(normalizeBedLayouts([{ beds: [{ kind: 'waterbed', count: 1 }] }])).toBeUndefined();
    expect(normalizeBedLayouts([{ name: 'Empty', beds: [] }, { beds: 'nope' }])).toBeUndefined();
    expect(normalizeBedLayouts('nope')).toBeUndefined();
    expect(normalizeBedLayouts(undefined)).toBeUndefined();
  });

  it('clamps the count and drops a size out of bounds rather than clamping it', () => {
    expect(
      normalizeBedLayouts([
        { beds: [{ kind: 'single', count: 1e9, widthCm: 2500, lengthCm: 190.4 }] },
      ]),
    ).toEqual([{ beds: [{ kind: 'single', count: 20, lengthCm: 190 }] }]);
  });

  it('bounds the number of layouts and of lines', () => {
    const line = { kind: 'single', count: 1 };
    const layouts = Array.from({ length: 10 }, () => ({
      beds: Array.from({ length: 30 }, () => line),
    }));

    const normalized = normalizeBedLayouts(layouts);

    expect(normalized).toHaveLength(MAX_ROOM_BED_LAYOUTS);
    expect(normalized?.[0]?.beds).toHaveLength(MAX_BEDS_PER_LAYOUT);
  });

  it('trims a layout name and drops a blank one', () => {
    expect(
      normalizeBedLayouts([{ name: '  Twin  ', beds: [{ kind: 'single', count: 2 }] }, { name: '   ', beds: [{ kind: 'king', count: 1 }] }]),
    ).toEqual([
      { name: 'Twin', beds: [{ kind: 'single', count: 2 }] },
      { beds: [{ kind: 'king', count: 1 }] },
    ]);
  });
});

describe('normalizeExtraSpots', () => {
  it('clamps to the bounds and reads zero as absent', () => {
    expect(normalizeExtraSpots(2)).toBe(2);
    expect(normalizeExtraSpots(1e9)).toBe(20);
    expect(normalizeExtraSpots(0)).toBeUndefined();
    expect(normalizeExtraSpots(-3)).toBeUndefined();
    expect(normalizeExtraSpots('2')).toBeUndefined();
  });
});

describe('normalizeRoomBeds', () => {
  it('computes the capacity from the beds, whatever number came with them', () => {
    expect(normalizeRoomBeds({ capacity: 9, bedLayouts: TWIN_OR_TOGETHER, extraSpots: 1 })).toEqual({
      capacity: 3,
      bedLayouts: TWIN_OR_TOGETHER,
      extraSpots: 1,
    });
  });

  it('keeps the given number and drops the extra spots without beds', () => {
    expect(normalizeRoomBeds({ capacity: 4, extraSpots: 2 })).toEqual({ capacity: 4 });
  });

  it('never stores more than the room bound, however many beds', () => {
    const many: RoomBedLayout[] = [{ beds: [{ kind: 'bunk', count: 20 }, { kind: 'king', count: 20 }] }];

    expect(normalizeRoomBeds({ capacity: 1, bedLayouts: many }).capacity).toBe(MAX_ROOM_CAPACITY);
  });
});

// ============================================================================
// Repository
// ============================================================================

describe('room repository with beds', () => {
  it('stores the beds and the capacity they sleep on create', async () => {
    const tripId = await createTestTrip();

    const room = await createRoom(tripId, {
      name: 'Attic',
      capacity: 2,
      bedLayouts: TWIN_OR_TOGETHER,
      extraSpots: 1,
    });

    const stored = await db.rooms.get(room.id);
    expect(stored?.capacity).toBe(3);
    expect(stored?.bedLayouts).toEqual(TWIN_OR_TOGETHER);
    expect(stored?.extraSpots).toBe(1);
  });

  it('stores no bed key at all for a room without beds', async () => {
    const tripId = await createTestTrip();

    const room = await createRoom(tripId, {
      name: 'Tent',
      capacity: 2,
      bedLayouts: undefined,
      extraSpots: 3,
    });

    const stored = await db.rooms.get(room.id);
    expect(stored).not.toHaveProperty('bedLayouts');
    expect(stored).not.toHaveProperty('extraSpots');
    expect(stored?.capacity).toBe(2);
  });

  it('clears the beds when an edit sends them empty, keeping the capacity it sends', async () => {
    const tripId = await createTestTrip();
    const room = await createRoom(tripId, { name: 'Attic', capacity: 2, bedLayouts: TWIN_OR_TOGETHER });

    await updateRoomWithOwnershipCheck(room.id, tripId, {
      capacity: 2,
      bedLayouts: undefined,
      extraSpots: undefined,
    });

    const stored = await db.rooms.get(room.id);
    expect(stored).not.toHaveProperty('bedLayouts');
    expect(stored?.capacity).toBe(2);
  });

  it('overrules a capacity-only edit of a room with beds', async () => {
    const tripId = await createTestTrip();
    const room = await createRoom(tripId, { name: 'Attic', capacity: 2, bedLayouts: TWIN_OR_TOGETHER });

    await updateRoomWithOwnershipCheck(room.id, tripId, { capacity: 7 });

    expect((await db.rooms.get(room.id))?.capacity).toBe(2);
  });

  it('computes the capacity again when only the extra spots change', async () => {
    const tripId = await createTestTrip();
    const room = await createRoom(tripId, { name: 'Attic', capacity: 2, bedLayouts: TWIN_OR_TOGETHER });

    await updateRoom(room.id, { extraSpots: 2 });

    const stored = await db.rooms.get(room.id);
    expect(stored?.capacity).toBe(4);
    expect(stored?.bedLayouts).toEqual(TWIN_OR_TOGETHER);
  });

  it('leaves the beds alone on an edit that does not name them', async () => {
    const tripId = await createTestTrip();
    const room = await createRoom(tripId, { name: 'Attic', capacity: 2, bedLayouts: TWIN_OR_TOGETHER });

    await updateRoomWithOwnershipCheck(room.id, tripId, { name: 'Loft' });

    const stored = await db.rooms.get(room.id);
    expect(stored?.name).toBe('Loft');
    expect(stored?.bedLayouts).toEqual(TWIN_OR_TOGETHER);
  });

  it('gives a duplicate its own copy of the beds', async () => {
    const tripId = await createTestTrip();
    const room = await createRoom(tripId, {
      name: 'Attic',
      capacity: 2,
      bedLayouts: TWIN_OR_TOGETHER,
      extraSpots: 1,
    });

    const copy = await duplicateRoomWithOwnershipCheck(room.id, tripId);

    expect(copy.bedLayouts).toEqual(TWIN_OR_TOGETHER);
    expect(copy.extraSpots).toBe(1);
    expect(copy.capacity).toBe(3);
  });

  it('clones the beds into another trip', async () => {
    const source = await createTestTrip();
    const target = await createTestTrip();
    await createRoom(source, { name: 'Attic', capacity: 2, bedLayouts: TWIN_OR_TOGETHER });

    const [clone] = await cloneRoomsToTrip(source, target);

    expect(clone?.bedLayouts).toEqual(TWIN_OR_TOGETHER);
    expect(clone?.tripId).toBe(target);
  });
});
