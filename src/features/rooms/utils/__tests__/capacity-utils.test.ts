/**
 * @fileoverview Tests for room capacity utility functions.
 *
 * @module features/rooms/utils/__tests__/capacity-utils.test
 */

import { describe, it, expect } from 'vitest';

import type { ISODateString, PersonId, RoomAssignment, RoomAssignmentId, RoomId, TripId } from '@/types';
import {
  calculatePeakOccupancy,
  calculatePeakOccupancyByRoom,
  createHeadcountResolver,
  isDateInStayRange,
  listStayNights,
  stayNightsOverlap,
  summarizeRoomOccupancy,
} from '../capacity-utils';

/** Every guest stands for exactly one person. */
const ONE = () => 1;

// ============================================================================
// Test Helpers
// ============================================================================

function makeAssignment(
  startDate: string,
  endDate: string,
  id = 'a1',
  personId = 'person-1',
): RoomAssignment {
  return {
    id: id as RoomAssignmentId,
    tripId: 'trip-1' as TripId,
    roomId: 'room-1' as RoomId,
    personId: personId as PersonId,
    startDate: startDate as ISODateString,
    endDate: endDate as ISODateString,
  };
}

// ============================================================================
// isDateInStayRange
// ============================================================================

describe('isDateInStayRange', () => {
  it('returns true when date is within range (check-in day)', () => {
    expect(isDateInStayRange('2024-07-15', '2024-07-20', '2024-07-15')).toBe(true);
  });

  it('returns true for middle of range', () => {
    expect(isDateInStayRange('2024-07-15', '2024-07-20', '2024-07-17')).toBe(true);
  });

  it('returns false for check-out day (endDate is exclusive)', () => {
    expect(isDateInStayRange('2024-07-15', '2024-07-20', '2024-07-20')).toBe(false);
  });

  it('returns false for date before range', () => {
    expect(isDateInStayRange('2024-07-15', '2024-07-20', '2024-07-14')).toBe(false);
  });

  it('returns false for date after range', () => {
    expect(isDateInStayRange('2024-07-15', '2024-07-20', '2024-07-21')).toBe(false);
  });

  it('returns false for empty startDate', () => {
    expect(isDateInStayRange('', '2024-07-20', '2024-07-17')).toBe(false);
  });

  it('returns false for empty endDate', () => {
    expect(isDateInStayRange('2024-07-15', '', '2024-07-17')).toBe(false);
  });

  it('returns false for empty referenceDate', () => {
    expect(isDateInStayRange('2024-07-15', '2024-07-20', '')).toBe(false);
  });
});

// ============================================================================
// calculatePeakOccupancy
// ============================================================================

describe('calculatePeakOccupancy', () => {
  it('returns 0 for empty assignments', () => {
    expect(calculatePeakOccupancy([], '2024-07-15', '2024-07-20', ONE)).toBe(0);
  });

  it('returns 0 for empty startDate', () => {
    expect(calculatePeakOccupancy([makeAssignment('2024-07-15', '2024-07-20')], '', '2024-07-20', ONE)).toBe(0);
  });

  it('returns 0 for empty endDate', () => {
    expect(calculatePeakOccupancy([makeAssignment('2024-07-15', '2024-07-20')], '2024-07-15', '', ONE)).toBe(0);
  });

  it('returns 0 when startDate >= endDate', () => {
    expect(calculatePeakOccupancy([makeAssignment('2024-07-15', '2024-07-20')], '2024-07-20', '2024-07-20', ONE)).toBe(0);
    expect(calculatePeakOccupancy([makeAssignment('2024-07-15', '2024-07-20')], '2024-07-21', '2024-07-20', ONE)).toBe(0);
  });

  it('returns 1 for a single assignment spanning the range', () => {
    const assignments = [makeAssignment('2024-07-15', '2024-07-20')];
    expect(calculatePeakOccupancy(assignments, '2024-07-15', '2024-07-20', ONE)).toBe(1);
  });

  it('returns peak when multiple assignments overlap', () => {
    const assignments = [
      makeAssignment('2024-07-15', '2024-07-20', 'a1'),
      makeAssignment('2024-07-17', '2024-07-22', 'a2'),
      makeAssignment('2024-07-18', '2024-07-19', 'a3'),
    ];
    // On 2024-07-18: a1, a2, a3 overlap → peak = 3
    expect(calculatePeakOccupancy(assignments, '2024-07-15', '2024-07-23', ONE)).toBe(3);
  });

  it('returns 2 for two fully overlapping assignments', () => {
    const assignments = [
      makeAssignment('2024-07-15', '2024-07-20', 'a1'),
      makeAssignment('2024-07-15', '2024-07-20', 'a2'),
    ];
    expect(calculatePeakOccupancy(assignments, '2024-07-15', '2024-07-20', ONE)).toBe(2);
  });

  it('returns 1 for non-overlapping assignments', () => {
    const assignments = [
      makeAssignment('2024-07-15', '2024-07-17', 'a1'),
      makeAssignment('2024-07-18', '2024-07-20', 'a2'),
    ];
    expect(calculatePeakOccupancy(assignments, '2024-07-15', '2024-07-20', ONE)).toBe(1);
  });

  it('handles single-day range', () => {
    const assignments = [makeAssignment('2024-07-15', '2024-07-17')];
    // Range 15 to 16: only day 15 → 1 assignment present
    expect(calculatePeakOccupancy(assignments, '2024-07-15', '2024-07-16', ONE)).toBe(1);
  });
});

// ============================================================================
// createHeadcountResolver + people-not-rows occupancy
// ============================================================================

describe('occupancy counts people, not assignment rows', () => {
  it('counts a headcount-2 guest as two occupants', () => {
    const headcountOf = createHeadcountResolver([
      { id: 'person-1' as PersonId, headcount: 2 },
    ]);
    const assignments = [makeAssignment('2024-07-15', '2024-07-20')];

    expect(
      calculatePeakOccupancy(assignments, '2024-07-15', '2024-07-20', headcountOf),
    ).toBe(2);
  });

  it('reports a two-bed room as over capacity with two headcount-2 guests', () => {
    // The shipped bug: this returned 2 (one per row), so a 2-bed room looked
    // half empty while holding four real people.
    const headcountOf = createHeadcountResolver([
      { id: 'person-1' as PersonId, headcount: 2 },
      { id: 'person-2' as PersonId, headcount: 2 },
    ]);
    const assignments = [
      makeAssignment('2024-07-15', '2024-07-20', 'a1', 'person-1'),
      makeAssignment('2024-07-15', '2024-07-20', 'a2', 'person-2'),
    ];

    const peak = calculatePeakOccupancy(
      assignments,
      '2024-07-15',
      '2024-07-20',
      headcountOf,
    );

    expect(peak).toBe(4);
    expect(peak).toBeGreaterThan(2); // a 2-bed room is over capacity
  });

  it('treats a missing or legacy guest as one person', () => {
    const headcountOf = createHeadcountResolver([
      { id: 'person-1' as PersonId },
    ]);

    expect(headcountOf('person-1' as PersonId)).toBe(1);
    expect(headcountOf('nobody' as PersonId)).toBe(1);
  });

  it('clamps an out-of-range stored headcount', () => {
    const headcountOf = createHeadcountResolver([
      { id: 'person-1' as PersonId, headcount: 0 },
      { id: 'person-2' as PersonId, headcount: -3 },
    ]);

    expect(headcountOf('person-1' as PersonId)).toBe(1);
    expect(headcountOf('person-2' as PersonId)).toBe(1);
  });
});

// ============================================================================
// listStayNights
// ============================================================================

describe('listStayNights', () => {
  it('lists check-in through the night before check-out', () => {
    expect(listStayNights('2024-07-15', '2024-07-18')).toEqual([
      '2024-07-15',
      '2024-07-16',
      '2024-07-17',
    ]);
  });

  it('returns no nights for a same-day check-in and check-out', () => {
    expect(listStayNights('2024-07-15', '2024-07-15')).toEqual([]);
  });

  it('returns no nights for an inverted or empty window', () => {
    expect(listStayNights('2024-07-16', '2024-07-15')).toEqual([]);
    expect(listStayNights('', '2024-07-15')).toEqual([]);
    expect(listStayNights('2024-07-15', '')).toEqual([]);
  });
});

// ============================================================================
// stayNightsOverlap
// ============================================================================

describe('stayNightsOverlap', () => {
  it('reports an overlap when two stays share a night', () => {
    expect(
      stayNightsOverlap(
        { startDate: '2024-07-15' as ISODateString, endDate: '2024-07-18' as ISODateString },
        { startDate: '2024-07-17' as ISODateString, endDate: '2024-07-20' as ISODateString },
      ),
    ).toBe(true);
  });

  it('does not report a room move as a conflict', () => {
    // Checking out of one room and into another on the same day is one night
    // in each, not a double booking.
    expect(
      stayNightsOverlap(
        { startDate: '2024-07-15' as ISODateString, endDate: '2024-07-18' as ISODateString },
        { startDate: '2024-07-18' as ISODateString, endDate: '2024-07-20' as ISODateString },
      ),
    ).toBe(false);
  });

  it('ignores stays that hold no nights at all', () => {
    expect(
      stayNightsOverlap(
        { startDate: '2024-07-18' as ISODateString, endDate: '2024-07-18' as ISODateString },
        { startDate: '2024-07-15' as ISODateString, endDate: '2024-07-20' as ISODateString },
      ),
    ).toBe(false);
  });
});

// ============================================================================
// calculatePeakOccupancyByRoom
// ============================================================================

describe('calculatePeakOccupancyByRoom', () => {
  function inRoom(
    roomId: string,
    startDate: string,
    endDate: string,
    id: string,
    personId: string,
  ): RoomAssignment {
    return { ...makeAssignment(startDate, endDate, id, personId), roomId: roomId as RoomId };
  }

  it('agrees with calculatePeakOccupancy for every room', () => {
    const headcountOf = createHeadcountResolver([
      { id: 'person-1' as PersonId, headcount: 2 },
      { id: 'person-2' as PersonId, headcount: 1 },
      { id: 'person-3' as PersonId, headcount: 3 },
    ]);
    const assignments = [
      inRoom('room-a', '2024-07-15', '2024-07-18', 'a1', 'person-1'),
      inRoom('room-a', '2024-07-16', '2024-07-20', 'a2', 'person-2'),
      inRoom('room-b', '2024-07-15', '2024-07-20', 'a3', 'person-3'),
    ];

    const byRoom = calculatePeakOccupancyByRoom(
      assignments,
      '2024-07-15',
      '2024-07-20',
      headcountOf,
    );

    for (const roomId of ['room-a', 'room-b'] as RoomId[]) {
      expect(byRoom.get(roomId)).toBe(
        calculatePeakOccupancy(
          assignments.filter((a) => a.roomId === roomId),
          '2024-07-15',
          '2024-07-20',
          headcountOf,
        ),
      );
    }
    // room-a peaks on the 16th and 17th: a couple plus one.
    expect(byRoom.get('room-a' as RoomId)).toBe(3);
    expect(byRoom.get('room-b' as RoomId)).toBe(3);
  });

  it('omits rooms with no assignment in the window', () => {
    const assignments = [inRoom('room-a', '2024-07-01', '2024-07-03', 'a1', 'person-1')];

    const byRoom = calculatePeakOccupancyByRoom(
      assignments,
      '2024-07-15',
      '2024-07-20',
      ONE,
    );

    expect(byRoom.get('room-a' as RoomId)).toBeUndefined();
  });
});

// ============================================================================
// summarizeRoomOccupancy
// ============================================================================

describe('summarizeRoomOccupancy', () => {
  it('reports the spare beds on the busiest night', () => {
    expect(summarizeRoomOccupancy(3, 2)).toEqual({
      peakOccupancy: 2,
      availableSpots: 1,
      isFull: false,
      isOverCapacity: false,
    });
  });

  it('is full but not over capacity at exactly capacity', () => {
    expect(summarizeRoomOccupancy(2, 2)).toEqual({
      peakOccupancy: 2,
      availableSpots: 0,
      isFull: true,
      isOverCapacity: false,
    });
  });

  it('never reports negative spare beds when over capacity', () => {
    const summary = summarizeRoomOccupancy(2, 4);
    expect(summary.availableSpots).toBe(0);
    expect(summary.isFull).toBe(true);
    expect(summary.isOverCapacity).toBe(true);
  });
});
