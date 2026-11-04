/**
 * @fileoverview How far a trip is from having anything to show on its calendar.
 *
 * A trip is created with a name and a guest list, and lands on the calendar,
 * where there is nothing to draw until it also has dates, rooms, guests
 * sleeping in them and travel. The dates are asked for here rather than at
 * creation: a group often does not know them yet, and a required question up
 * front made people stop. This module turns that gap into an ordered list
 * of steps with counts, so the empty calendar can say what to do next instead
 * of only that it is empty.
 *
 * Counts are in **people**, not guest rows: one row can stand for a couple or
 * a family (`Person.headcount`), and "2 of 5 have a room" has to mean the same
 * five people the room capacities are measured against.
 *
 * @module features/calendar/utils/setup-checklist
 */

import { getPersonHeadcount } from '@/types';
import type { Person, PersonId, Room, RoomAssignment, Transport } from '@/types';

// ============================================================================
// Types
// ============================================================================

/**
 * The setup steps, in the order they are worked through.
 *
 * Every step a trip can have. A given trip may show fewer — see
 * {@link buildTripSetupChecklist} — so read the count off the checklist rather
 * than off this list.
 *
 * A union built from a `const` array rather than an enum — `erasableSyntaxOnly`
 * forbids enums — so the render order and the type come from one declaration.
 */
export const TRIP_SETUP_STEP_KEYS = ['dates', 'guests', 'rooms', 'assignments', 'arrivals'] as const;

/** One step of {@link TRIP_SETUP_STEP_KEYS}. */
export type TripSetupStepKey = (typeof TRIP_SETUP_STEP_KEYS)[number];

/**
 * One line of the checklist.
 */
export interface TripSetupStep {
  /** Which step this is; the caller maps it to copy and to a destination. */
  readonly key: TripSetupStepKey;
  /** How much of the step is done, in people for the guest-shaped steps. */
  readonly count: number;
  /**
   * What `count` is counting towards, when the step is an "N of M".
   *
   * Omitted for the steps that are done as soon as there is one of the thing:
   * a trip needs *some* rooms, not one room per guest.
   */
  readonly total?: number;
  /** Whether this step needs nothing more. */
  readonly isDone: boolean;
}

/**
 * The whole checklist, plus the progress figures its header shows.
 */
export interface TripSetupChecklist {
  /**
   * The steps this trip has, in {@link TRIP_SETUP_STEP_KEYS} order.
   *
   * A step that cannot apply to the trip is absent, so a caller renders and
   * counts what it is given rather than the whole key list.
   */
  readonly steps: readonly TripSetupStep[];
  /** How many steps are done. */
  readonly doneCount: number;
  /** How many steps this trip has, so a caller never hardcodes it. */
  readonly stepCount: number;
  /** True when every step is done and the calendar has nothing left to wait for. */
  readonly isComplete: boolean;
}

/**
 * What the checklist is built from — the four collections the calendar already
 * holds, so nothing new is read from the database for it.
 */
export interface TripSetupChecklistInput {
  readonly persons: readonly Person[];
  readonly rooms: readonly Room[];
  readonly assignments: readonly RoomAssignment[];
  readonly arrivals: readonly Transport[];
  /**
   * True when the trip's dates are known and enclose no night — a start and an
   * end on the same day.
   *
   * Required rather than optional, because the answer decides whether a step
   * appears at all: a call site that forgot it would quietly put the step back
   * that this field exists to remove. Read it from `isZeroNightWindow`.
   */
  readonly tripHasNoNights: boolean;
  /**
   * True when the trip has its own dates. Read it from `tripHasDates`.
   *
   * Required for the same reason as `tripHasNoNights`: a call site that forgot
   * it would mark every trip as dated, and nobody would be asked for the dates.
   */
  readonly tripHasDates: boolean;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Works out which trip-setup steps are done and how far along the rest are.
 *
 * The "dates" step completes once the trip has its own dates. It is first,
 * because the timeline reads every other step against them.
 *
 * The "assignments" step completes only when **every** guest has a room: a
 * guest with nowhere to sleep is the thing this list exists to surface. It is
 * left out altogether on a trip with no nights, where there is no bed to put
 * anybody in: nothing can book a stay of zero nights, so the step sat there at
 * "Nobody has a room yet" for ever. The "arrivals" step completes at the first arrival, because a host who drives
 * their own guests in never books travel for all of them and a step that can
 * never tick off is worse than no step.
 *
 * @param input - The trip's guests, rooms, room assignments and arrivals
 * @returns The ordered steps and their progress
 *
 * @example
 * ```typescript
 * const checklist = buildTripSetupChecklist({
 *   persons: [alice, bob],
 *   rooms: [attic],
 *   assignments: [aliceInAttic],
 *   arrivals: [],
 *   tripHasNoNights: false,
 *   tripHasDates: true,
 * });
 * // checklist.doneCount === 3  (dates, guests, rooms)
 * // checklist.steps[3] === { key: 'assignments', count: 1, total: 2, isDone: false }
 * ```
 */
export function buildTripSetupChecklist(
  input: TripSetupChecklistInput,
): TripSetupChecklist {
  const { persons, rooms, assignments, arrivals, tripHasNoNights, tripHasDates } = input;

  const assignedPersonIds = new Set<PersonId>();
  for (const assignment of assignments) {
    assignedPersonIds.add(assignment.personId);
  }

  let totalPeople = 0,
    assignedPeople = 0;

  for (const person of persons) {
    const headcount = getPersonHeadcount(person);
    totalPeople += headcount;
    if (assignedPersonIds.has(person.id)) {
      assignedPeople += headcount;
    }
  }

  const steps: readonly TripSetupStep[] = [
    {
      key: 'dates',
      count: tripHasDates ? 1 : 0,
      isDone: tripHasDates,
    },
    {
      key: 'guests',
      count: totalPeople,
      isDone: totalPeople > 0,
    },
    {
      key: 'rooms',
      count: rooms.length,
      isDone: rooms.length > 0,
    },
    // Left out rather than marked done: a tick would claim the guests had been
    // placed, and there was never anywhere to place them.
    ...(tripHasNoNights
      ? []
      : [
          {
            key: 'assignments' as const,
            count: assignedPeople,
            total: totalPeople,
            isDone: totalPeople > 0 && assignedPeople === totalPeople,
          },
        ]),
    {
      key: 'arrivals',
      count: arrivals.length,
      isDone: arrivals.length > 0,
    },
  ];

  const doneCount = steps.filter((step) => step.isDone).length;

  return {
    steps,
    doneCount,
    stepCount: steps.length,
    isComplete: doneCount === steps.length,
  };
}

/**
 * What the visibility rule is decided from.
 */
export interface TripSetupChecklistVisibilityInput {
  /** The checklist itself, so a finished trip never shows one. */
  readonly checklist: TripSetupChecklist;
  /** The trip's arrivals. */
  readonly arrivals: readonly Transport[];
  /** The trip's departures. */
  readonly departures: readonly Transport[];
}

/**
 * Whether the calendar hands the user the checklist rather than letting the
 * calendar speak for itself.
 *
 * Travel is the one thing that ends it. The rule used to be "anything at all
 * is scheduled", which counted room assignments — so the list vanished the
 * moment the first guest got a bed, taking the remaining steps with it and
 * leaving a calendar with nothing on it but stay bars. Travel is the last
 * step, it is the one the calendar can actually draw a day around, and once a
 * leg exists the user has plainly found the transport screen and does not need
 * to be pointed at it.
 *
 * Missing dates keep it on screen even after travel exists: the checklist is
 * the one place that asks for the dates, so hiding it would leave a trip
 * without dates that nothing asks about.
 *
 * @param input - The checklist and the trip's travel
 * @returns True while the checklist should be on screen
 *
 * @example
 * ```typescript
 * shouldShowTripSetupChecklist({ checklist, arrivals: [], departures: [] }); // true
 * ```
 */
export function shouldShowTripSetupChecklist(
  input: TripSetupChecklistVisibilityInput,
): boolean {
  const { checklist, arrivals, departures } = input;

  if (checklist.isComplete) {
    return false;
  }
  const datesMissing = checklist.steps.some((step) => step.key === 'dates' && !step.isDone);
  return datesMissing || (arrivals.length === 0 && departures.length === 0);
}
