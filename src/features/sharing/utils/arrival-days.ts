/**
 * @fileoverview The days the invite page's arrival question offers.
 *
 * @module features/sharing/utils/arrival-days
 */

import { parseISO } from 'date-fns';

import { listStayNights } from '@/features/rooms/utils/capacity-utils';
import type { ISODateString, Trip } from '@/types';

// ============================================================================
// Public API
// ============================================================================

/**
 * The days a guest can arrive on: every night of the trip, up to the day they
 * already said they leave.
 *
 * A trip whose start and end are one day has no night, and its one day is
 * still a day to arrive on.
 *
 * @param trip - The trip's dates
 * @param stayEndDate - The day the guest leaves, when known
 * @returns ISO days in ascending order; empty when the trip has no usable dates
 */
export function listArrivalDays(
  trip: Pick<Trip, 'startDate' | 'endDate'>,
  stayEndDate: ISODateString | undefined,
): readonly ISODateString[] {
  const lastDay = stayEndDate !== undefined && stayEndDate < trip.endDate ? stayEndDate : trip.endDate;
  const nights = listStayNights(trip.startDate, lastDay) as readonly ISODateString[];
  if (nights.length > 0) {
    return nights;
  }
  return trip.startDate && !Number.isNaN(parseISO(trip.startDate).getTime())
    ? [trip.startDate]
    : [];
}
