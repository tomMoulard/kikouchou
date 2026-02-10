/**
 * @fileoverview Shared utility functions for room capacity calculations.
 * Used across RoomListPage, QuickAssignmentDialog, and RoomAssignmentSection.
 *
 * @module features/rooms/utils/capacity-utils
 */

import { eachDayOfInterval, format, parseISO } from 'date-fns';
import type { RoomAssignment } from '@/types';

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
 * Calculates the peak occupancy for a room across a given date range.
 * For each date in the range, counts how many assignments overlap that date.
 * Returns the maximum count (peak) across all dates.
 *
 * Uses the check-in/check-out model: startDate inclusive, endDate exclusive.
 *
 * @param roomAssignments - All assignments for this room
 * @param startDate - Start of the date range (ISO YYYY-MM-DD)
 * @param endDate - End of the date range (ISO YYYY-MM-DD, check-out day)
 * @returns Peak occupancy number
 */
export function calculatePeakOccupancy(
  roomAssignments: readonly RoomAssignment[],
  startDate: string,
  endDate: string,
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
        count++;
      }
    }
    if (count > peak) {
      peak = count;
    }
  }
  return peak;
}
