/**
 * @fileoverview Tests for room capacity utility functions.
 *
 * @module features/rooms/utils/__tests__/capacity-utils.test
 */

import { describe, it, expect } from 'vitest';

import type { ISODateString, PersonId, RoomAssignment, RoomAssignmentId, RoomId, TripId } from '@/types';
import { isDateInStayRange, calculatePeakOccupancy } from '../capacity-utils';

// ============================================================================
// Test Helpers
// ============================================================================

function makeAssignment(
  startDate: string,
  endDate: string,
  id = 'a1',
): RoomAssignment {
  return {
    id: id as RoomAssignmentId,
    tripId: 'trip-1' as TripId,
    roomId: 'room-1' as RoomId,
    personId: 'person-1' as PersonId,
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
    expect(calculatePeakOccupancy([], '2024-07-15', '2024-07-20')).toBe(0);
  });

  it('returns 0 for empty startDate', () => {
    expect(calculatePeakOccupancy([makeAssignment('2024-07-15', '2024-07-20')], '', '2024-07-20')).toBe(0);
  });

  it('returns 0 for empty endDate', () => {
    expect(calculatePeakOccupancy([makeAssignment('2024-07-15', '2024-07-20')], '2024-07-15', '')).toBe(0);
  });

  it('returns 0 when startDate >= endDate', () => {
    expect(calculatePeakOccupancy([makeAssignment('2024-07-15', '2024-07-20')], '2024-07-20', '2024-07-20')).toBe(0);
    expect(calculatePeakOccupancy([makeAssignment('2024-07-15', '2024-07-20')], '2024-07-21', '2024-07-20')).toBe(0);
  });

  it('returns 1 for a single assignment spanning the range', () => {
    const assignments = [makeAssignment('2024-07-15', '2024-07-20')];
    expect(calculatePeakOccupancy(assignments, '2024-07-15', '2024-07-20')).toBe(1);
  });

  it('returns peak when multiple assignments overlap', () => {
    const assignments = [
      makeAssignment('2024-07-15', '2024-07-20', 'a1'),
      makeAssignment('2024-07-17', '2024-07-22', 'a2'),
      makeAssignment('2024-07-18', '2024-07-19', 'a3'),
    ];
    // On 2024-07-18: a1, a2, a3 overlap → peak = 3
    expect(calculatePeakOccupancy(assignments, '2024-07-15', '2024-07-23')).toBe(3);
  });

  it('returns 2 for two fully overlapping assignments', () => {
    const assignments = [
      makeAssignment('2024-07-15', '2024-07-20', 'a1'),
      makeAssignment('2024-07-15', '2024-07-20', 'a2'),
    ];
    expect(calculatePeakOccupancy(assignments, '2024-07-15', '2024-07-20')).toBe(2);
  });

  it('returns 1 for non-overlapping assignments', () => {
    const assignments = [
      makeAssignment('2024-07-15', '2024-07-17', 'a1'),
      makeAssignment('2024-07-18', '2024-07-20', 'a2'),
    ];
    expect(calculatePeakOccupancy(assignments, '2024-07-15', '2024-07-20')).toBe(1);
  });

  it('handles single-day range', () => {
    const assignments = [makeAssignment('2024-07-15', '2024-07-17')];
    // Range 15 to 16: only day 15 → 1 assignment present
    expect(calculatePeakOccupancy(assignments, '2024-07-15', '2024-07-16')).toBe(1);
  });
});
