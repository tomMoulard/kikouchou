/**
 * @fileoverview Shared utility functions for room capacity calculations.
 * Used across RoomListPage, QuickAssignmentDialog, and RoomAssignmentSection.
 *
 * @module features/rooms/utils/capacity-utils
 */

import { eachDayOfInterval, format, parseISO } from 'date-fns';

import { getPersonHeadcount, type Person, type PersonId, type RoomAssignment } from '@/types';

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
  if (roomAssignments.length === 0 || !startDate || !endDate || startDate >= endDate) {
    return 0;
  }

  const start = parseISO(startDate);
  const end = parseISO(endDate);
  const lastNight = new Date(end);
  lastNight.setDate(lastNight.getDate() - 1);

  if (start > lastNight) {
    return 0;
  }

  let peak = 0;
  const dates = eachDayOfInterval({ start, end: lastNight });
  for (const d of dates) {
    const dateStr = format(d, 'yyyy-MM-dd');
    let count = 0;
    for (const a of roomAssignments) {
      if (isDateInStayRange(a.startDate, a.endDate, dateStr)) {
        count += headcountOf(a.personId);
      }
    }
    if (count > peak) {
      peak = count;
    }
  }
  return peak;
}
