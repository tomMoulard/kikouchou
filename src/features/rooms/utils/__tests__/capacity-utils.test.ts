/**
 * @fileoverview Tests for room capacity utility functions.
 *
 * @module features/rooms/utils/__tests__/capacity-utils.test
 */

import { describe, it, expect } from 'vitest';

import type { ISODateString, PersonId, RoomAssignment, RoomAssignmentId, RoomId, TripId } from '@/types';
import {
  calculatePeakOccupancy,
  createHeadcountResolver,
  isDateInStayRange,
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
