/**
 * @fileoverview Day columns for horizontal trip timelines.
 *
 * @module lib/utils/trip-days
 */

import { parseISODateString, toISODateString } from '@/lib/db/utils';
import type { ISODateString, Trip } from '@/types';

/**
 * Builds one Date per calendar day of a trip, from its start date to its end
 * date inclusive.
 *
 * Days are stepped in UTC so daylight-saving transitions never skip or repeat a
 * column. Duplicate UTC days are collapsed defensively so the header column
 * count always matches the row grids.
 *
 * @param trip - The trip whose span to enumerate
 * @returns One Date per trip day, or an empty array when the dates are invalid
 *
 * @example
 * ```typescript
 * buildTripDayColumns(trip).length; // nights + 1
 * ```
 */
export function buildTripDayColumns(trip: Trip): readonly Date[] {
  const start = parseISODateString(trip.startDate);
  const end = parseISODateString(trip.endDate);
  if (!start || !end) {
    return [];
  }

  const raw: Date[] = [];
  let cursor = new Date(start.getTime());
  const endTime = end.getTime();

  while (cursor.getTime() <= endTime) {
    raw.push(new Date(cursor.getTime()));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  const seen = new Set<ISODateString>();
  const days: Date[] = [];
  for (const day of raw) {
    const key = toISODateString(day);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    days.push(day);
  }

  return days;
}
