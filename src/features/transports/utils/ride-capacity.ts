/**
 * @fileoverview Does everyone fit in the car, and are the right child seats in it?
 *
 * Both questions are asked by the ride card, the ride form and the capacity
 * badge, and all three have to give the same answer — so they are answered
 * once, here.
 *
 * Two rules the rest of the codebase already learned the hard way:
 *
 * - **Count people, not rows.** One guest row can stand for a couple
 *   ("Alice+Auré" is `headcount: 2`), so a five-seat car does not hold five
 *   rows. Every figure here sums through a required {@link HeadcountResolver};
 *   an optional one defaulting to 1 is how a new call site silently regresses.
 * - **An absent limit is not a limit of zero.** A vehicle with no `seatCount`
 *   has not been measured, so no warning is raised against it. Reading a
 *   missing capacity as zero would mark every unmeasured car as overloaded.
 *
 * @module features/transports/utils/ride-capacity
 */

import type { HeadcountResolver } from '@/features/rooms/utils/capacity-utils';
import type { ResolvedRide } from '@/features/transports/utils/ride-model';
import { CHILD_SEAT_KINDS, type ChildSeatKind, type Vehicle } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** How many of each child seat a ride needs, or a vehicle carries. */
export type ChildSeatTally = Readonly<Record<ChildSeatKind, number>>;

/** A seat kind the ride needs more of than the car provides. */
export interface ChildSeatShortfall {
  readonly kind: ChildSeatKind;
  /** How many the passengers need. */
  readonly required: number;
  /** How many the car carries. */
  readonly available: number;
  /** `required - available`, always at least 1. */
  readonly missing: number;
}

/** Everything a capacity surface renders about one journey. */
export interface RideCapacitySummary {
  /** People travelling, driver included, counted as bodies rather than rows. */
  readonly seatsUsed: number;
  /** The car's seat count, or undefined when it has not been measured. */
  readonly seatsAvailable: number | undefined;
  /** Seats left, or undefined when there is no limit to subtract from. */
  readonly seatsFree: number | undefined;
  /** True only when a known limit is genuinely exceeded. */
  readonly isOverCapacity: boolean;
  /** True when the car is exactly full — a nudge, not a warning. */
  readonly isFull: boolean;
  /** Child seats the passengers need. */
  readonly requiredChildSeats: ChildSeatTally;
  /** Child seats the car carries; all zero when no car is chosen. */
  readonly availableChildSeats: ChildSeatTally;
  /** Kinds the car is short of. Empty when every child is covered. */
  readonly childSeatShortfalls: readonly ChildSeatShortfall[];
  /** True when no vehicle is chosen, so nothing could be checked. */
  readonly isUnchecked: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const EMPTY_TALLY: ChildSeatTally = {
  rearFacing: 0,
  forwardFacing: 0,
  booster: 0,
};

// ============================================================================
// Tallies
// ============================================================================

/**
 * Counts the child seats a set of passengers needs.
 *
 * A guest standing for several people contributes **one** seat of their kind,
 * not `headcount` of them: a headcount says how many bodies to count, never
 * which of them is small. A child who needs a seat belongs in a row of their
 * own, which is what {@link Person.childSeat} documents.
 *
 * @param passengers - The guests travelling, driver included
 * @returns One count per seat kind
 */
export function tallyRequiredChildSeats(
  passengers: readonly { readonly childSeat?: ChildSeatKind }[],
): ChildSeatTally {
  const tally: Record<ChildSeatKind, number> = { ...EMPTY_TALLY };

  for (const passenger of passengers) {
    // Guarded rather than trusted, even though the type says otherwise: these
    // guests come out of the shared document, where a peer or a newer build can
    // put anything. An unknown kind would index a fresh key with `undefined + 1`
    // and leave `NaN` in the tally the card renders.
    if (
      passenger.childSeat !== undefined &&
      (CHILD_SEAT_KINDS as readonly unknown[]).includes(passenger.childSeat)
    ) {
      tally[passenger.childSeat] += 1;
    }
  }

  return tally;
}

/**
 * Counts the child seats a car carries.
 *
 * @param vehicle - The chosen car, or undefined when none is
 * @returns One count per seat kind; all zero without a car
 */
export function tallyAvailableChildSeats(
  vehicle: Vehicle | undefined,
): ChildSeatTally {
  const tally: Record<ChildSeatKind, number> = { ...EMPTY_TALLY };

  for (const kind of vehicle?.childSeats ?? []) {
    tally[kind] += 1;
  }

  return tally;
}

// ============================================================================
// Summary
// ============================================================================

/**
 * Answers "does this lot fit in that car" for one resolved journey.
 *
 * The driver occupies a seat, and occupies it exactly once: on a self-driven
 * ride they already own one of the legs, so counting them again would report a
 * couple driving themselves to the airport as four people.
 *
 * A guest a leg names but the trip no longer holds still counts as one body —
 * the same choice `createHeadcountResolver` makes for an orphaned assignment.
 * Somebody is standing at that station whether or not their row survived.
 *
 * @param journey - The resolved journey
 * @param resolveHeadcount - Required: how many people a guest row stands for
 * @returns Every figure the capacity surfaces render
 *
 * @example
 * ```typescript
 * const summary = summariseRideCapacity(journey, createHeadcountResolver(persons));
 * if (summary.isOverCapacity) { … }
 * ```
 */
export function summariseRideCapacity(
  journey: ResolvedRide,
  resolveHeadcount: HeadcountResolver,
): RideCapacitySummary {
  const passengers = journey.legs.map((leg) => leg.person),
    seatsFromLegs = journey.legs.reduce(
      (total, leg) => total + resolveHeadcount(leg.transport.personId),
      0,
    ),
    // Keyed on `driverId`, not on the resolved `driver`. A driver this device
    // cannot name is still a person in the car — the same reading
    // `seatsFromLegs` already gives an unresolved passenger, and the same one
    // `createHeadcountResolver` gives an orphaned assignment. Reading the
    // resolved object instead made a full car report a free seat whenever the
    // driver's guest row had not projected yet.
    //
    // Zero only when the driver is already one of the passengers. `isSelfDriven`
    // is exactly that question, derived from who owns the legs.
    driverSeats =
      journey.driverId === undefined || journey.isSelfDriven
        ? 0
        : resolveHeadcount(journey.driverId),
    seatsUsed = seatsFromLegs + driverSeats,
    seatsAvailable = journey.vehicle?.seatCount,
    requiredChildSeats = tallyRequiredChildSeats(
      journey.isSelfDriven || journey.driver === undefined
        ? passengers.filter((person) => person !== undefined)
        : [...passengers.filter((person) => person !== undefined), journey.driver],
    ),
    availableChildSeats = tallyAvailableChildSeats(journey.vehicle);

  const childSeatShortfalls: ChildSeatShortfall[] = [];
  if (journey.vehicle !== undefined) {
    for (const kind of CHILD_SEAT_KINDS) {
      const required = requiredChildSeats[kind],
        available = availableChildSeats[kind];

      if (required > available) {
        childSeatShortfalls.push({
          kind,
          required,
          available,
          missing: required - available,
        });
      }
    }
  }

  return {
    seatsUsed,
    seatsAvailable,
    seatsFree:
      seatsAvailable === undefined ? undefined : Math.max(0, seatsAvailable - seatsUsed),
    isOverCapacity: seatsAvailable !== undefined && seatsUsed > seatsAvailable,
    isFull: seatsAvailable !== undefined && seatsUsed === seatsAvailable,
    requiredChildSeats,
    availableChildSeats,
    childSeatShortfalls,
    isUnchecked: journey.vehicle === undefined,
  };
}

/**
 * Whether a summary is worth drawing the user's attention to.
 *
 * One predicate so a badge, a card and a form agree on what counts as a
 * problem. Being exactly full is not one: a full car is a correctly loaded car.
 *
 * @param summary - A capacity summary
 * @returns True when the car cannot carry what is booked into it
 */
export function hasCapacityWarning(summary: RideCapacitySummary): boolean {
  return summary.isOverCapacity || summary.childSeatShortfalls.length > 0;
}

/**
 * How many *people* a car is collecting.
 *
 * Not `legs.length`. `Person.headcount` means one guest row can stand for a
 * couple or a family, so a car collecting "Alice+Auré", Bruno and Chloé carries
 * five bodies and would otherwise be reported as three passengers — enough for
 * somebody to take the four-seater on the strength of it. The same rule every
 * occupancy figure in this app follows.
 *
 * The driver is excluded: they are not a passenger, and on a self-driven ride
 * they already own one of the legs, so counting them would double them. Use
 * {@link summariseRideCapacity}'s `seatsUsed` for the figure that includes
 * them.
 *
 * @param journey - The resolved journey
 * @param resolveHeadcount - Required: how many people a guest row stands for
 * @returns The number of people in the car's passenger seats
 */
export function countRidePassengers(
  journey: ResolvedRide,
  resolveHeadcount: HeadcountResolver,
): number {
  return journey.legs.reduce(
    (total, leg) => total + resolveHeadcount(leg.transport.personId),
    0,
  );
}
