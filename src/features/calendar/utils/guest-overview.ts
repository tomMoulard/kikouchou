/**
 * @fileoverview Everything the trip knows about one guest, gathered in one
 * place for the detail dialog.
 *
 * Clicking a guest's pill on the calendar used to answer one question — which
 * room — and the reader then went hunting through four other screens for the
 * rest: when they land, what they signed up for, and whether they still owe the
 * kitty. This builder collects those answers off the data the calendar page
 * already holds, so the dialog can show the whole guest rather than one booking.
 *
 * @module features/calendar/utils/guest-overview
 */

import { resolveGuestStayWindow } from '@/features/persons/utils/guest-presence';
import type { PersonBalance } from '@/features/money/lib/balances';
import {
  getActivityEndDayKey,
  getActivityStartDayKey,
} from '@/features/activities/utils/activity-utils';
import type {
  Activity,
  CurrencyCode,
  ISODateString,
  Person,
  Room,
  RoomAssignment,
  Transport,
  Trip,
} from '@/types';

// ============================================================================
// Types
// ============================================================================

/** One of the guest's stays, with the room it is in resolved. */
export interface GuestOverviewStay {
  readonly assignment: RoomAssignment;
  readonly room: Room | undefined;
}

/**
 * The whole picture of one guest on one trip.
 */
export interface GuestOverview {
  readonly person: Person;
  /**
   * The day the guest arrives, and the day they leave.
   *
   * The same window the rest of the app uses (`resolveGuestStayWindow`): the
   * guest's own stay dates when they have them, otherwise their first arrival
   * and last departure, otherwise the trip's own dates. Never a fourth answer
   * that only this dialog believes.
   */
  readonly checkIn: ISODateString | null;
  readonly checkOut: ISODateString | null;
  /** Every room this guest is booked into, earliest first. */
  readonly stays: readonly GuestOverviewStay[];
  /** Every leg this guest travels on, earliest first. */
  readonly transports: readonly Transport[];
  /** Every activity this guest is signed up for, earliest first. */
  readonly activities: readonly Activity[];
  /**
   * What the guest owes the group, or the group owes them.
   *
   * Undefined when the trip's accounts have not loaded, or when this guest has
   * never appeared on a money line — which is not the same as being square, and
   * the dialog says so.
   */
  readonly balance: PersonBalance | undefined;
  /** The trip's currency, for formatting `balance`. */
  readonly currency: CurrencyCode | undefined;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Gathers one guest's rooms, travel, agenda and standing in the accounts.
 *
 * Everything is filtered and sorted here rather than in the dialog, so the
 * component that shows it holds no rules about what belongs to whom.
 *
 * @param args - The guest, the trip, and the trip's rooms, bookings, legs, agenda and balances
 * @returns The guest's full picture, ready to render
 *
 * @example
 * ```ts
 * const overview = buildGuestOverview({ person, trip, rooms, assignments, arrivals, departures, activities });
 * overview.transports.length; // legs this guest travels on
 * ```
 */
export function buildGuestOverview(args: {
  readonly person: Person;
  readonly trip: Trip;
  readonly rooms: readonly Room[];
  readonly assignments: readonly RoomAssignment[];
  readonly arrivals: readonly Transport[];
  readonly departures: readonly Transport[];
  readonly activities: readonly Activity[];
  readonly balance?: PersonBalance | undefined;
  readonly currency?: CurrencyCode | undefined;
}): GuestOverview {
  const { person, trip, rooms, assignments, arrivals, departures, activities } = args;

  const roomsById = new Map<string, Room>(rooms.map((room) => [room.id, room]));

  const stays = assignments
    .filter((assignment) => assignment.personId === person.id)
    .sort(
      (left, right) =>
        left.startDate.localeCompare(right.startDate) || left.endDate.localeCompare(right.endDate),
    )
    .map((assignment) => ({ assignment, room: roomsById.get(assignment.roomId) }));

  const transports = [...arrivals, ...departures]
    .filter((transport) => transport.personId === person.id)
    .sort((left, right) => left.datetime.localeCompare(right.datetime));

  const guestActivities = activities
    .filter((activity) => activity.participantIds.includes(person.id))
    .sort((left, right) => {
      const leftKey = getActivityStartDayKey(left) ?? '';
      const rightKey = getActivityStartDayKey(right) ?? '';
      return (
        leftKey.localeCompare(rightKey) ||
        (getActivityEndDayKey(left) ?? '').localeCompare(getActivityEndDayKey(right) ?? '')
      );
    });

  const { arrival: checkIn, departure: checkOut } = resolveGuestStayWindow(
    person,
    arrivals,
    departures,
    { startDate: trip.startDate, endDate: trip.endDate },
  );

  return {
    person,
    checkIn,
    checkOut,
    stays,
    transports,
    activities: guestActivities,
    balance: args.balance,
    currency: args.currency,
  };
}
