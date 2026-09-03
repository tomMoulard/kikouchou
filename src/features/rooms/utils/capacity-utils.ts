/**
 * @fileoverview Shared utility functions for room capacity calculations.
 *
 * This module is the **single source of truth** for the question "how full is
 * this room?". Every surface that answers it — the room cards, the occupancy
 * timeline, the guest onboarding wizard, the quick-assign dialog and the
 * auto-assign planner — must go through the helpers below rather than counting
 * assignment rows or timeline lanes for itself. Three independent
 * implementations of that question used to render through the *same* i18n keys,
 * so the same room read "2 spots taken" on its card and "1 spot taken" on the
 * timeline.
 *
 * @module features/rooms/utils/capacity-utils
 */

import { eachDayOfInterval, format, parseISO, subDays } from 'date-fns';

import {
  getPersonHeadcount,
  type Person,
  type PersonId,
  type RoomAssignment,
  type RoomId,
} from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Resolves how many real people an assignment's guest stands for.
 *
 * A guest row can represent a couple or a family under one name, so room
 * occupancy must count people, not assignment rows. This is a **required**
 * parameter on the functions below rather than an optional one: an optional
 * resolver defaulting to 1 is exactly how a new call site silently
 * reintroduces the "four people in a two-bed room" bug.
 *
 * @see getPersonHeadcount in `@/types`
 */
export type HeadcountResolver = (personId: PersonId) => number;

/**
 * The derived facts every room-occupancy surface renders.
 *
 * Deriving `availableSpots` / `isFull` here rather than at each call site is
 * what keeps a card, a timeline row and a wizard card from disagreeing about
 * whether the same room still has room in it.
 */
export interface RoomOccupancySummary {
  /** Most people sleeping in the room on any single night of the window. */
  readonly peakOccupancy: number;
  /** Beds left on the busiest night, never negative. */
  readonly availableSpots: number;
  /** True when the room has no spare bed on its busiest night. */
  readonly isFull: boolean;
  /** True when more people are booked than the room has beds. */
  readonly isOverCapacity: boolean;
}

/** The minimum an assignment must expose to take part in the nights model. */
type StayWindow = Pick<RoomAssignment, 'startDate' | 'endDate'>;

// ============================================================================
// Headcount
// ============================================================================

/**
 * Builds an O(1) {@link HeadcountResolver} from a trip's guest list.
 *
 * An id with no matching guest resolves to 1, so an orphaned assignment still
 * occupies a bed rather than vanishing from the occupancy maths.
 *
 * @param persons - The trip's guests
 * @returns A resolver suitable for the occupancy helpers below
 */
export function createHeadcountResolver(
  persons: readonly Pick<Person, 'id' | 'headcount'>[],
): HeadcountResolver {
  const byId = new Map(persons.map((person) => [person.id, person]));
  return (personId) => {
    const person = byId.get(personId);
    return person ? getPersonHeadcount(person) : 1;
  };
}

// ============================================================================
// The nights model
// ============================================================================

/**
 * Checks if a reference date falls within a room assignment's stay period.
 * Uses the "check-in / check-out" model:
 * - startDate = check-in day (first night)
 * - endDate = check-out day (person leaves, NOT a stay night)
 *
 * ISO date strings (YYYY-MM-DD) sort lexicographically, making this efficient.
 *
 * @param startDate - Check-in date in ISO format (YYYY-MM-DD)
 * @param endDate - Check-out date in ISO format (YYYY-MM-DD)
 * @param referenceDate - Reference date in ISO format (YYYY-MM-DD)
 * @returns True if referenceDate is a night the person is staying (check-in <= ref < check-out)
 */
export function isDateInStayRange(
  startDate: string,
  endDate: string,
  referenceDate: string,
): boolean {
  if (!startDate || !endDate || !referenceDate) {
    return false;
  }
  return startDate <= referenceDate && referenceDate < endDate;
}

/**
 * Lists every night in a check-in/check-out window, as ISO date strings.
 *
 * This is the one place the nights model is turned into a list of days. Callers
 * that need "each night between these two dates" must use it instead of
 * re-deriving `endDate - 1` for themselves — that arithmetic had been rewritten
 * by hand in seven places, and they did not all agree.
 *
 * @param startDate - Check-in date (ISO YYYY-MM-DD), inclusive
 * @param endDate - Check-out date (ISO YYYY-MM-DD), exclusive
 * @returns The nights in ascending order; empty when the window holds none
 */
export function listStayNights(startDate: string, endDate: string): readonly string[] {
  if (!startDate || !endDate || startDate >= endDate) {
    return [];
  }

  const start = parseISO(startDate);
  const end = parseISO(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return [];
  }

  const lastNight = subDays(end, 1);
  if (start > lastNight) {
    return [];
  }

  return eachDayOfInterval({ start, end: lastNight }).map((day) => format(day, 'yyyy-MM-dd'));
}

/**
 * Tells whether two stays claim at least one night in common.
 *
 * Uses the nights model, so back-to-back stays do not overlap: a guest checking
 * out on the 10th and into another room the same day sleeps one night in each,
 * which is a room move rather than a double booking.
 *
 * @param a - First stay window
 * @param b - Second stay window
 * @returns True when the two windows share a night
 */
export function stayNightsOverlap(a: StayWindow, b: StayWindow): boolean {
  if (!a.startDate || !a.endDate || !b.startDate || !b.endDate) {
    return false;
  }
  if (a.startDate >= a.endDate || b.startDate >= b.endDate) {
    return false;
  }
  return a.startDate < b.endDate && b.startDate < a.endDate;
}

// ============================================================================
// Occupancy
// ============================================================================

/**
 * Calculates the peak occupancy for a room across a given date range, counting
 * **people** rather than assignment rows.
 *
 * For each night in the range, sums the headcount of every assignment covering
 * it, and returns the maximum across all nights.
 *
 * Uses the check-in/check-out model: startDate inclusive, endDate exclusive.
 *
 * @param roomAssignments - All assignments for this room
 * @param startDate - Start of the date range (ISO YYYY-MM-DD)
 * @param endDate - End of the date range (ISO YYYY-MM-DD, check-out day)
 * @param headcountOf - Resolves an assignment's guest to its headcount
 * @returns Peak number of people occupying the room on any single night
 */
export function calculatePeakOccupancy(
  roomAssignments: readonly RoomAssignment[],
  startDate: string,
  endDate: string,
  headcountOf: HeadcountResolver,
): number {
  if (roomAssignments.length === 0) {
    return 0;
  }

  let peak = 0;
  for (const night of listStayNights(startDate, endDate)) {
    let count = 0;
    for (const assignment of roomAssignments) {
      if (isDateInStayRange(assignment.startDate, assignment.endDate, night)) {
        count += headcountOf(assignment.personId);
      }
    }
    if (count > peak) {
      peak = count;
    }
  }
  return peak;
}

/**
 * Calculates {@link calculatePeakOccupancy} for every room at once, in a single
 * pass over the nights of the range.
 *
 * Views that render many rooms — the timeline, the guest wizard — should use
 * this rather than looping {@link calculatePeakOccupancy} per room, both to
 * avoid the rooms x assignments x nights blow-up and because it guarantees
 * every row was measured over exactly the same window.
 *
 * @param assignments - Assignments across any number of rooms
 * @param startDate - Start of the date range (ISO YYYY-MM-DD)
 * @param endDate - End of the date range (ISO YYYY-MM-DD, check-out day)
 * @param headcountOf - Resolves an assignment's guest to its headcount
 * @returns Peak occupancy keyed by room id; rooms with no assignment are absent
 */
export function calculatePeakOccupancyByRoom(
  assignments: readonly RoomAssignment[],
  startDate: string,
  endDate: string,
  headcountOf: HeadcountResolver,
): ReadonlyMap<RoomId, number> {
  const peaks = new Map<RoomId, number>();
  if (assignments.length === 0) {
    return peaks;
  }

  for (const night of listStayNights(startDate, endDate)) {
    const tonight = new Map<RoomId, number>();
    for (const assignment of assignments) {
      if (!isDateInStayRange(assignment.startDate, assignment.endDate, night)) {
        continue;
      }
      const roomId = assignment.roomId;
      tonight.set(roomId, (tonight.get(roomId) ?? 0) + headcountOf(assignment.personId));
    }
    for (const [roomId, count] of tonight) {
      if (count > (peaks.get(roomId) ?? 0)) {
        peaks.set(roomId, count);
      }
    }
  }

  return peaks;
}

/**
 * Turns a capacity and a peak occupancy into the facts the UI renders.
 *
 * @param capacity - The room's number of beds
 * @param peakOccupancy - Result of {@link calculatePeakOccupancy} for that room
 * @returns The shared occupancy summary
 */
export function summarizeRoomOccupancy(
  capacity: number,
  peakOccupancy: number,
): RoomOccupancySummary {
  return {
    peakOccupancy,
    availableSpots: Math.max(0, capacity - peakOccupancy),
    isFull: peakOccupancy >= capacity,
    isOverCapacity: peakOccupancy > capacity,
  };
}
