/**
 * @fileoverview A guest's stay, moved to match a journey they just recorded.
 *
 * Stated stay dates win over travel when the app asks where a guest is
 * (`guest-presence`). So a guest who had dates, then pasted their train
 * booking into the assistant, got the trains on the trip and stayed on the
 * calendar on their old days. This is the one rule that keeps the two
 * together: an arrival moves the stay's start to its day, a departure moves
 * its end.
 *
 * Only a guest with exactly one stated stay is moved. With none, the stay is
 * already read from the travel. With several, which stay the journey belongs
 * to is a guess, and a wrong guess loses a stay the person typed.
 *
 * @module features/persons/utils/stay-from-travel
 */

import { localDayKeyOfInstant } from '@/lib/utils/trip-days';

import type { ISODateString, Person, TransportType } from '@/types';

/** The two stay fields a journey can move. */
export interface StayDates {
  readonly stayStartDate: ISODateString;
  readonly stayEndDate: ISODateString;
}

/**
 * The guest's stay once a journey of theirs is recorded, or `null` when it
 * does not move.
 *
 * An arrival after the stay's end, or a departure before its start, carries
 * the other end along: the stay is never left inverted, and the matching leg,
 * usually the next action of the same booking, sets it right.
 *
 * @param person - The guest whose journey it is
 * @param type - Whether the journey brings them or takes them away
 * @param datetime - When it arrives or leaves, as stored on the transport
 * @returns The new stay dates, or `null` to leave the guest as they are
 */
export function stayFollowingTravel(
  person: Pick<Person, 'stayStartDate' | 'stayEndDate' | 'extraStays'>,
  type: TransportType,
  datetime: string,
): StayDates | null {
  const start = person.stayStartDate;
  const end = person.stayEndDate;
  if (!start || !end || start > end || (person.extraStays?.length ?? 0) > 0) {
    return null;
  }

  const day = localDayKeyOfInstant(datetime);
  if (!day) {
    return null;
  }

  if (type === 'arrival') {
    return day === start
      ? null
      : { stayStartDate: day, stayEndDate: end >= day ? end : day };
  }
  return day === end
    ? null
    : { stayStartDate: start <= day ? start : day, stayEndDate: day };
}
