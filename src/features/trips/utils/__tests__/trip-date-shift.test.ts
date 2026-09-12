/**
 * Tests for planTripDateShiftAssignmentUpdates.
 *
 * @module features/trips/utils/__tests__/trip-date-shift.test
 */
import { describe, it, expect } from 'vitest';

import { planTripDateShiftAssignmentUpdates } from '../trip-date-shift';
import type {
  ISODateString,
  PersonId,
  RoomAssignment,
  RoomAssignmentId,
  RoomId,
  TripId,
} from '@/types';

function assignment(
  id: string,
  startDate: string,
  endDate: string,
  personId = 'p1',
): RoomAssignment {
  return {
    id: id as RoomAssignmentId,
    tripId: 'trip-1' as TripId,
    personId: personId as PersonId,
    roomId: 'r1' as RoomId,
    startDate: startDate as ISODateString,
    endDate: endDate as ISODateString,
  };
}

const window = (startDate: string, endDate: string) => ({
  startDate: startDate as ISODateString,
  endDate: endDate as ISODateString,
});

describe('planTripDateShiftAssignmentUpdates', () => {
  it('moves a booking that spanned exactly the old trip', () => {
    const shifts = planTripDateShiftAssignmentUpdates({
      previous: window('2026-09-17', '2026-10-03'),
      next: window('2026-09-02', '2026-10-03'),
      assignments: [assignment('a1', '2026-09-17', '2026-10-03')],
    });

    expect(shifts).toEqual([
      { id: 'a1', startDate: '2026-09-02', endDate: '2026-10-03' },
    ]);
  });

  // Marc's case: two consecutive bookings inside a longer trip are somebody's
  // decision about particular nights, not a stale whole-trip span.
  it('leaves a deliberate partial booking alone', () => {
    const shifts = planTripDateShiftAssignmentUpdates({
      previous: window('2026-04-20', '2026-04-28'),
      next: window('2026-04-18', '2026-04-28'),
      assignments: [
        assignment('a1', '2026-04-22', '2026-04-24'),
        assignment('a2', '2026-04-24', '2026-04-25'),
      ],
    });

    expect(shifts).toEqual([]);
  });

  it('leaves a booking that merely overlapped the old window', () => {
    const shifts = planTripDateShiftAssignmentUpdates({
      previous: window('2026-04-01', '2026-04-10'),
      next: window('2026-04-01', '2026-04-20'),
      assignments: [
        assignment('a1', '2026-04-01', '2026-04-09'),
        assignment('a2', '2026-04-02', '2026-04-10'),
      ],
    });

    expect(shifts).toEqual([]);
  });

  it('does nothing when the dates did not move', () => {
    const shifts = planTripDateShiftAssignmentUpdates({
      previous: window('2026-04-01', '2026-04-10'),
      next: window('2026-04-01', '2026-04-10'),
      assignments: [assignment('a1', '2026-04-01', '2026-04-10')],
    });

    expect(shifts).toEqual([]);
  });

  it('moves every whole-trip booking, one per guest', () => {
    const shifts = planTripDateShiftAssignmentUpdates({
      previous: window('2026-04-01', '2026-04-10'),
      next: window('2026-04-01', '2026-04-12'),
      assignments: [
        assignment('a1', '2026-04-01', '2026-04-10', 'p1'),
        assignment('a2', '2026-04-01', '2026-04-10', 'p2'),
        assignment('a3', '2026-04-03', '2026-04-05', 'p3'),
      ],
    });

    expect(shifts.map((s) => s.id)).toEqual(['a1', 'a2']);
  });

  it('follows a trip that shortens as well as one that grows', () => {
    const shifts = planTripDateShiftAssignmentUpdates({
      previous: window('2026-04-01', '2026-04-10'),
      next: window('2026-04-03', '2026-04-08'),
      assignments: [assignment('a1', '2026-04-01', '2026-04-10')],
    });

    expect(shifts).toEqual([
      { id: 'a1', startDate: '2026-04-03', endDate: '2026-04-08' },
    ]);
  });
});
