/**
 * @fileoverview Which nights a guest still needs a bed for.
 *
 * The one answer behind the rooms timeline's "needs room" row, the auto-assign
 * planner and the "everyone has a room" notice, so those three can never
 * disagree about who is still homeless.
 *
 * @module features/rooms/utils/unassigned-guests
 */

import { addDays, eachDayOfInterval, format, isSameDay, parseISO } from 'date-fns';

import {
  deriveGuestStayDateBounds,
  type TripStayWindow,
} from '@/features/persons/utils/guest-presence';
import type { Person, RoomAssignment, Transport } from '@/types';

// ============================================================================
// Types
// ============================================================================

/**
 * An unbroken run of nights a guest has no room for, in the check-in /
 * check-out shape the rest of the app books with.
 */
export interface UnassignedStay {
  /** First night with no room. */
  readonly startDate: string;
  /** Check-out: the morning after the run's last night. */
  readonly endDate: string;
}

/**
 * A guest's stay window plus the nights inside it with no room.
 */
export interface UnassignedGuestDates {
  /** First date they need a room (arrival date) */
  readonly startDate: string;
  /** Last date they need a room (day before departure) */
  readonly endDate: string;
  /** Dates without room assignment (ISO strings) */
  readonly unassignedDates: string[];
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * The span the host actually booked for this guest: earliest assignment start
 * to latest assignment end, or `null` when they have no room at all.
 *
 * Dates are `yyyy-MM-dd`, so string comparison is chronological.
 */
function resolveBookedSpan(
  personAssignments: readonly RoomAssignment[],
): { readonly start: string; readonly end: string } | null {
  let start: string | null = null;
  let end: string | null = null;

  for (const assignment of personAssignments) {
    if (start === null || assignment.startDate < start) {
      start = assignment.startDate;
    }
    if (end === null || assignment.endDate > end) {
      end = assignment.endDate;
    }
  }

  return start !== null && end !== null ? { start, end } : null;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Calculates the nights a person needs a room for but has none.
 *
 * The stay window comes from what the guest's own records *state* — explicit
 * stay dates, then arrival/departure transports. For a bound nothing states,
 * the room the host booked answers next, and only then the trip's own dates.
 *
 * That order is the point. A guessed bound must never manufacture a complaint.
 * A guest who filled in nothing and was given a room used to be measured
 * against the trip window, so widening the trip's dates afterwards left them
 * sitting in their room *and* in the "needs room" row for the days the trip had
 * grown by — nights nobody ever said they would be there for. Letting the
 * booking answer first means the host's own decision defines the stay, and the
 * trip fallback keeps doing the job it was added for: an undated guest with no
 * room at all still needs one, for the whole trip, and still says so.
 *
 * Uses the check-in / check-out model throughout: a stay from `start` to `end`
 * covers the nights `start … end - 1`.
 *
 * @param person - The guest
 * @param arrivals - All arrival transports in the trip
 * @param departures - All departure transports in the trip
 * @param assignments - All room assignments in the trip
 * @param tripWindow - The trip's own dates, the last-resort fallback
 * @returns The stay window and its uncovered nights, or `null` when the guest
 *   needs nothing: no known window, no nights in it, or every night has a bed
 */
export function calculateUnassignedDates(
  person: Person,
  arrivals: readonly Transport[],
  departures: readonly Transport[],
  assignments: readonly RoomAssignment[],
  tripWindow: TripStayWindow,
): UnassignedGuestDates | null {
  const personAssignments = assignments.filter((a) => a.personId === person.id);
  const stated = deriveGuestStayDateBounds(person, arrivals, departures);
  const booked = resolveBookedSpan(personAssignments);

  const arrivalDate = stated.arrival ?? booked?.start ?? tripWindow.startDate ?? null;
  const departureDate = stated.departure ?? booked?.end ?? tripWindow.endDate ?? null;

  // Still no range => we don't know when they need a room
  if (!arrivalDate || !departureDate) {
    return null;
  }

  // If departure is same day as arrival, no nights stayed
  if (arrivalDate >= departureDate) {
    return null;
  }

  // Person arrives on arrivalDate and sleeps that night; they leave on the
  // morning of departureDate, so the last night is the one before it.
  const start = parseISO(arrivalDate);
  const end = parseISO(departureDate);
  const lastNight = new Date(end);
  lastNight.setDate(lastNight.getDate() - 1);

  const datesNeeded = eachDayOfInterval({ start, end: lastNight }).map((d) =>
    format(d, 'yyyy-MM-dd'),
  );

  // Build set of dates covered by assignments
  const coveredDates = new Set<string>();
  for (const assignment of personAssignments) {
    const assignmentStart = parseISO(assignment.startDate);
    const assignmentEnd = parseISO(assignment.endDate);

    const lastCoveredNight = new Date(assignmentEnd);
    lastCoveredNight.setDate(lastCoveredNight.getDate() - 1);

    if (assignmentStart <= lastCoveredNight) {
      const coveredNights = eachDayOfInterval({
        start: assignmentStart,
        end: lastCoveredNight,
      });
      for (const night of coveredNights) {
        coveredDates.add(format(night, 'yyyy-MM-dd'));
      }
    }
  }

  const unassignedDates = datesNeeded.filter((date) => !coveredDates.has(date));

  if (unassignedDates.length === 0) {
    return null;
  }

  return {
    startDate: arrivalDate,
    endDate: departureDate,
    unassignedDates,
  };
}

/**
 * Groups loose uncovered nights into the runs a booking could actually cover.
 *
 * {@link calculateUnassignedDates} answers with individual nights, which is
 * right for counting but wrong for drawing or booking: a guest housed for the
 * middle of their stay has two separate gaps, and one bar across both would
 * claim the nights they already have a bed for. Each run becomes its own stay,
 * so a bar spans only nights that really need a room and dragging it books
 * exactly those.
 *
 * Returned in the check-out convention used everywhere else — a run of nights
 * `3rd, 4th` is `startDate: 3rd, endDate: 5th` — so the result can be handed
 * straight to `createAssignment`.
 *
 * Nights are de-duplicated and ordered first, and one that will not parse is
 * skipped rather than breaking the run either side of it.
 *
 * @param nights - Local day keys (`yyyy-MM-dd`) with no room, in any order
 * @returns One entry per unbroken run, earliest first
 */
export function groupUnassignedNightsIntoStays(
  nights: readonly string[],
): readonly UnassignedStay[] {
  const parsed = [...new Set(nights)]
    .sort()
    .map((night) => ({ night, date: parseISO(night) }))
    .filter(({ date }) => !isNaN(date.getTime()));

  const stays: UnassignedStay[] = [];
  let runStart: string | null = null;
  let runLastNight: Date | null = null;

  const close = (): void => {
    if (runStart !== null && runLastNight !== null) {
      stays.push({
        startDate: runStart,
        endDate: format(addDays(runLastNight, 1), 'yyyy-MM-dd'),
      });
    }
  };

  for (const { night, date } of parsed) {
    if (runLastNight !== null && isSameDay(addDays(runLastNight, 1), date)) {
      runLastNight = date;
      continue;
    }

    close();
    runStart = night;
    runLastNight = date;
  }
  close();

  return stays;
}
