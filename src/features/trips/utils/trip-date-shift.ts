/**
 * @fileoverview Keeps whole-trip room bookings, and whole-trip stays, whole
 * when the trip's dates move.
 *
 * @module features/trips/utils/trip-date-shift
 */

import type { ISODateString, Person, PersonId, RoomAssignment, RoomAssignmentId } from '@/types';

// ============================================================================
// Types
// ============================================================================

/** A trip's check-in / check-out dates. */
export interface TripDateWindow {
  readonly startDate: ISODateString;
  readonly endDate: ISODateString;
}

/** One guest's new stay. */
export interface GuestStayShift {
  readonly id: PersonId;
  readonly stayStartDate: ISODateString;
  readonly stayEndDate: ISODateString;
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

/**
 * Works out which guests' stays should follow the trip when its dates change.
 *
 * The same reasoning as {@link planTripDateShiftAssignmentUpdates}, for the
 * guest's own dates. A guest with no dates is already read as staying for the
 * whole trip, and follows it on their own. A guest whose dates were *exactly*
 * the trip's meant the same thing, but wrote it down as two dates: when the
 * trip moved they stayed behind on the old ones, shown on the wrong days and
 * missing from the new ones.
 *
 * Only a single stay that matched the old trip exactly moves. A stay that
 * differed by a day, or a guest who comes several times, was somebody's
 * decision about particular days.
 *
 * @param args - The old and new trip windows, and the trip's guests
 * @returns The guests to rewrite, empty when the dates did not move
 */
export function planTripDateShiftGuestUpdates(args: {
  readonly previous: TripDateWindow;
  readonly next: TripDateWindow;
  readonly persons: readonly Pick<Person, 'id' | 'stayStartDate' | 'stayEndDate' | 'extraStays'>[];
}): readonly GuestStayShift[] {
  const { previous, next, persons } = args;

  if (previous.startDate === next.startDate && previous.endDate === next.endDate) {
    return [];
  }

  return persons
    .filter(
      (person) =>
        person.stayStartDate === previous.startDate &&
        person.stayEndDate === previous.endDate &&
        (person.extraStays?.length ?? 0) === 0,
    )
    .map((person) => ({
      id: person.id,
      stayStartDate: next.startDate,
      stayEndDate: next.endDate,
    }));
}
