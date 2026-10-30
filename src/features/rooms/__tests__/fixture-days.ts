/**
 * @fileoverview Fixture days for the rooms tests, counted from today.
 *
 * AGENTS.md: fixture dates pinned to a literal month go stale. These put a
 * fixture trip a month ahead of whatever day the suite runs on, so its days
 * stay in the future, and give each day by its place in the trip.
 *
 * Every helper works in local days, which is what the room screens and their
 * pickers work in.
 *
 * @module features/rooms/__tests__/fixture-days
 */

import { addDays, startOfDay } from 'date-fns';

import { toLocalISODateString } from '@/lib/db/utils';
import type { ISODateString } from '@/types';

/** Local midnight of the fixture trip's first day: thirty days from today. */
export const FIXTURE_TRIP_START: Date = startOfDay(addDays(new Date(), 30));

/**
 * Local midnight of the trip's `n`-th day, where day 1 is its first.
 *
 * Zero and negative values reach back before the trip: day 0 is the day
 * before it starts.
 */
export function tripDate(n: number, hours = 0, minutes = 0): Date {
  const date = addDays(FIXTURE_TRIP_START, n - 1);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

/** The `yyyy-MM-dd` key of the trip's `n`-th day. */
export function tripDay(n: number): ISODateString {
  return toLocalISODateString(tripDate(n));
}
