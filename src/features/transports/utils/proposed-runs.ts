/**
 * @fileoverview The car journeys the app proposes on its own.
 *
 * A host should not have to assemble cars by hand. The app already knows every
 * leg's place and time, how many people each guest row stands for and which of
 * them need a child seat — so it can say "these three travel together, the car
 * has to hold four with one booster, and it must be there at 17:02". What is
 * left for a person is the only part the app cannot know: who drives, and in
 * what.
 *
 * This is the same shape the rooms feature settled on — the app works out the
 * arrangement, a person reviews it in one pass — and it composes the pieces
 * that already existed rather than adding a second grouping rule:
 *
 * - `groupPickupsByProximity` decides which legs travel together,
 * - `suggestRidesForGroup` turns one group into one car per direction,
 * - `tallyRequiredChildSeats` counts what those passengers need.
 *
 * A run is a *proposal*: nothing is stored until somebody confirms it, so the
 * list is derived on every render and can never go stale against the legs.
 *
 * @module features/transports/utils/proposed-runs
 */

import {
  DEFAULT_TIME_WINDOW_MINUTES,
  collectDrivenRideIds,
  groupPickupsByProximity,
} from '@/features/transports/utils/pickup-utils';
import { tallyRequiredChildSeats } from '@/features/transports/utils/ride-capacity';
import { suggestRidesForGroup } from '@/features/transports/utils/ride-suggestion';
import { CHILD_SEAT_KINDS, getPersonHeadcount } from '@/types';
import type {
  ChildSeatKind,
  ISODateTimeString,
  Person,
  PersonId,
  Ride,
  RideDirection,
  RideId,
  Transport,
} from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * One car journey the app is proposing, ready for somebody to take on.
 */
export interface ProposedRun {
  /**
   * A stable identity for this proposal.
   *
   * Derived from the direction and the legs it holds, so React keeps the same
   * card — and any pending state on it — while the legs are unchanged, and
   * gives it up when they are not. Never stored.
   */
  readonly key: string;
  /** Whether the car fetches these guests or takes them away. */
  readonly direction: RideDirection;
  /** The meeting point. */
  readonly location: string;
  /** When the car has to be there: the first of these legs. */
  readonly meetDatetime: ISODateTimeString;
  /** The legs that would travel in it, earliest first. */
  readonly legs: readonly Transport[];
  /**
   * The car these legs already sit in, when they agree on one.
   *
   * Confirming then fills that car instead of building a rival one beside it.
   */
  readonly existingRideId: RideId | undefined;
  /**
   * How many people the car has to carry, driver excluded.
   *
   * People, not guest rows: one row can stand for a couple or a family
   * (`Person.headcount`), and a car is loaded with people.
   */
  readonly seatsNeeded: number;
  /**
   * The child restraints these passengers need, one entry per child.
   *
   * Ordered by {@link CHILD_SEAT_KINDS} so two runs needing the same seats
   * read the same way.
   */
  readonly childSeatsNeeded: readonly ChildSeatKind[];
}

/**
 * What a proposal is built from.
 */
export interface ProposedRunsInput {
  /**
   * The legs that still need somebody to drive.
   *
   * Pass `selectPickupsNeedingDriver`'s output: the selection is deliberately
   * not repeated here, so the number the analytics badge counts, the number
   * the alert panel shows and the runs proposed below can never disagree.
   */
  readonly legsNeedingLift: readonly Transport[];
  /** The trip's rides, from `RideContext`. */
  readonly rides: readonly Ride[];
  /** The trip's guests, for headcounts and child seats. */
  readonly persons: readonly Person[];
  /** How far apart two legs can be and still share a car. */
  readonly timeWindowMinutes?: number;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Reads the legs that need a lift as the cars they imply.
 *
 * @param input - The legs needing a lift, the trip's rides and its guests
 * @returns One proposal per car, earliest meeting time first
 *
 * @example
 * ```typescript
 * const runs = buildProposedRuns({ legsNeedingLift, rides, persons });
 * // runs[0].seatsNeeded === 3, runs[0].childSeatsNeeded === ['booster']
 * ```
 */
export function buildProposedRuns(
  input: ProposedRunsInput,
): readonly ProposedRun[] {
  const {
    legsNeedingLift,
    rides,
    persons,
    timeWindowMinutes = DEFAULT_TIME_WINDOW_MINUTES,
  } = input;

  // Indexed once: every leg asks for its guest, and a linear scan per leg is a
  // scan of the guest list per guest.
  const personsById = new Map<PersonId, Person>(
    persons.map((person) => [person.id, person]),
  );

  // The rides this device actually holds, so a leg pointing at a car that
  // arrived over a QR changeset — legs travel that path, rides do not — is not
  // mistaken for a car that can be extended.
  const knownRideIds = new Set<string>(rides.map((ride) => ride.id));
  // Named for what it is not used for: a driven ride's legs are already
  // covered upstream, so this only guards a caller that skipped the selection.
  const drivenRideIds = collectDrivenRideIds(rides);

  const runs: ProposedRun[] = [];

  for (const group of groupPickupsByProximity(legsNeedingLift, timeWindowMinutes)) {
    for (const suggestion of suggestRidesForGroup(group, knownRideIds)) {
      const legs = suggestion.legs.filter(
        (leg) => leg.rideId === undefined || !drivenRideIds.has(leg.rideId),
      );

      if (legs.length === 0) {
        continue;
      }

      const passengers = legs.map((leg) => personsById.get(leg.personId));

      runs.push({
        key: `${suggestion.direction}:${legs.map((leg) => leg.id).join(',')}`,
        direction: suggestion.direction,
        location: suggestion.location,
        meetDatetime: suggestion.meetDatetime,
        legs,
        existingRideId: suggestion.existingRideId,
        seatsNeeded: passengers.reduce(
          (total, passenger) =>
            total + (passenger === undefined ? 1 : getPersonHeadcount(passenger)),
          0,
        ),
        childSeatsNeeded: listRequiredChildSeats(passengers),
      });
    }
  }

  return runs;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Spells a child-seat tally out as one entry per seat.
 *
 * The card names the seats rather than counting kinds — "two boosters" is what
 * a driver has to find — and a vehicle stores them the same way, so the two
 * can be compared directly.
 *
 * @param passengers - The guests travelling, some possibly unknown
 * @returns One entry per required seat, in {@link CHILD_SEAT_KINDS} order
 */
function listRequiredChildSeats(
  passengers: readonly (Person | undefined)[],
): readonly ChildSeatKind[] {
  const tally = tallyRequiredChildSeats(
    passengers.filter((passenger): passenger is Person => passenger !== undefined),
  );

  const seats: ChildSeatKind[] = [];
  for (const kind of CHILD_SEAT_KINDS) {
    for (let index = 0; index < tally[kind]; index += 1) {
      seats.push(kind);
    }
  }

  return seats;
}
