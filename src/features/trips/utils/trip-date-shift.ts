/**
 * @fileoverview Keeps whole-trip room bookings whole when the trip's dates move.
 *
 * @module features/trips/utils/trip-date-shift
 */

import type { ISODateString, RoomAssignment, RoomAssignmentId } from '@/types';

// ============================================================================
// Types
// ============================================================================

/** A trip's check-in / check-out dates. */
export interface TripDateWindow {
  readonly startDate: ISODateString;
  readonly endDate: ISODateString;
}

/** One assignment's new span. */
export interface AssignmentDateShift {
  readonly id: RoomAssignmentId;
  readonly startDate: ISODateString;
  readonly endDate: ISODateString;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Works out which room bookings should follow the trip when its dates change.
 *
 * A booking made for a guest who never gave their own dates is created across
 * the whole trip, because the whole trip is what the app assumes their stay to
 * be. Stored as two concrete dates, that booking goes stale the moment the trip
 * moves: the guest still reads as present for the new, longer trip while their
 * room covers only the old span, so the timeline drew them in their room *and*
 * in the "needs room" row, and their bar started partway along.
 *
 * The fix has to happen here rather than when drawing, and that is the whole
 * point of doing it on the edit. Once the trip has moved, a booking that used
 * to span it is indistinguishable from one the host deliberately made for part
 * of it — same two dates, no record of intent. At *this* moment the old window
 * is still known, so "this booking was exactly the trip" is a fact rather than
 * a guess, and a deliberate partial booking is left untouched.
 *
 * Only an exact match moves. A booking that merely overlapped the old window,
 * or covered most of it, was somebody's decision about particular nights.
 *
 * @param args - The old and new trip windows, and the trip's assignments
 * @returns The assignments to rewrite, empty when the dates did not move
 */
export function planTripDateShiftAssignmentUpdates(args: {
  readonly previous: TripDateWindow;
  readonly next: TripDateWindow;
  readonly assignments: readonly RoomAssignment[];
}): readonly AssignmentDateShift[] {
  const { previous, next, assignments } = args;

  if (previous.startDate === next.startDate && previous.endDate === next.endDate) {
    return [];
  }

  return assignments
    .filter(
      (assignment) =>
        assignment.startDate === previous.startDate &&
        assignment.endDate === previous.endDate,
    )
    .map((assignment) => ({
      id: assignment.id,
      startDate: next.startDate,
      endDate: next.endDate,
    }));
}
