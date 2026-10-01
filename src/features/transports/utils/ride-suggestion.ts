/**
 * @fileoverview Turning "these three could share a car" into a car.
 *
 * `groupPickupsByProximity` already says which legs land at the same station
 * inside the same hour — that grouping *is* the app proposing a shared car. What
 * was missing is the step from the proposal to a {@link Ride}, and the two
 * awkward cases that step has to answer honestly:
 *
 * - **A group is not always one car.** Legs are grouped by station and time,
 *   not by direction, so an arrival at 14:00 and a departure at 14:30 at Lyon
 *   Part-Dieu land in the same group. A ride has exactly one `direction`, so
 *   such a group implies *two* cars — {@link suggestRidesForGroup} returns one
 *   suggestion per direction rather than picking one and dropping the other
 *   passengers on the pavement.
 * - **A leg nobody can place in time cannot be put in a car.** The meeting time
 *   comes from the earliest leg, so a group of unreadable datetimes yields no
 *   suggestion at all instead of a ride the repository would reject.
 *
 * Nothing here writes: a suggestion is a proposal a caller turns into a ride
 * with `createRide` plus one `setTransportRide` per leg.
 *
 * @module features/transports/utils/ride-suggestion
 */

import {
  type PickupGroup,
  sortTransportsByInstant,
  toTransportInstant,
} from '@/features/transports/utils/pickup-utils';
import type {
  ISODateTimeString,
  Ride,
  RideDirection,
  RideId,
  Transport,
} from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * One car a proximity group implies, ready to be created.
 *
 * The legs are ordered earliest first, so `meetDatetime` is the first leg's own
 * stored datetime rather than a recomputed instant — a car meets the first
 * guest to land, and reusing the leg's own string keeps the offset it was
 * written with.
 */
export interface RideSuggestion {
  /** Whether the car fetches these guests or takes them away. */
  readonly direction: RideDirection;
  /** The meeting point, from the group's display station. */
  readonly location: string;
  /** The earliest leg's datetime — when the car has to be there. */
  readonly meetDatetime: ISODateTimeString;
  /** The legs that would ride in it, earliest first. */
  readonly legs: readonly Transport[];
  /**
   * The car these legs already have, when the ones with a car agree on it.
   *
   * A group stays on this panel until somebody volunteers, so the same
   * suggestion is offered again after its car exists. Extending that car is
   * what the user means the second time; creating another would move the
   * passengers out of the first one and leave it empty.
   *
   * `undefined` when no leg has a car this device holds, and also when the
   * legs are split across two — there is then no single car to extend, and a
   * new one merges them.
   */
  readonly existingRideId: RideId | undefined;
  /** True when every leg already sits in {@link existingRideId}. */
  readonly isArranged: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Normalises a station name for comparison.
 *
 * Same rule as `groupPickupsByProximity` uses to decide that two legs are at
 * the same place, so a leg can always join a ride the grouping would have put
 * it with. `location` is required by the `Transport` type but nothing enforces
 * that on a record arriving over Yjs, hence the `?? ''`.
 *
 * @param location - A station name, possibly absent on a remote record
 * @returns The trimmed, lower-cased name
 */
function normaliseStation(location: string | undefined): string {
  return (location ?? '').trim().toLowerCase();
}

/**
 * The one car these legs already share, or `undefined`.
 *
 * Legs with no car at all are ignored: a group half of which has been arranged
 * still has one car to finish. Two different cars answer `undefined`, because
 * there is then nothing a single "put them together" action could extend.
 *
 * A `rideId` naming a ride this device does not hold is **not** membership —
 * the same rule `resolveRides` and `isLegCovered` apply, and for the same
 * reason: legs travel on the QR-changeset path and rides do not yet, so an
 * invitee holds legs pointing at cars they have never seen. Trusting one would
 * be worse than useless here, because every write against it fails: the group
 * button would either extend a ride that does not exist, or vanish entirely on
 * the grounds that the car was already arranged.
 *
 * @param legs - The legs of one suggestion
 * @param knownRideIds - The ids of the rides this device actually holds
 * @returns The shared ride id, when they agree on one this device holds
 */
function sharedRideId(
  legs: readonly Transport[],
  knownRideIds: ReadonlySet<string>,
): RideId | undefined {
  let shared: RideId | undefined;

  for (const leg of legs) {
    if (leg.rideId === undefined || !knownRideIds.has(leg.rideId)) {
      continue;
    }
    if (shared === undefined) {
      shared = leg.rideId;
    } else if (shared !== leg.rideId) {
      return undefined;
    }
  }

  return shared;
}

// ============================================================================
// Suggestion
// ============================================================================

/**
 * The direction of the car a leg needs.
 *
 * An arrival is fetched from the station, a departure is taken to it. This is
 * the same reading `resolveRides` gives a legacy leg, so a promoted leg keeps
 * the direction it always had.
 *
 * @param transport - The guest's own leg
 * @returns `'pickup'` for an arrival, `'dropoff'` for a departure
 */
export function rideDirectionForLeg(transport: Transport): RideDirection {
  return transport.type === 'arrival' ? 'pickup' : 'dropoff';
}

/**
 * Reads a proximity group as the car (or cars) it implies.
 *
 * One suggestion per direction present, ordered pick-ups first — an arrival and
 * a departure at the same station cannot share a ride, and silently keeping
 * only one of them would leave the other guests believing a car was arranged.
 *
 * @param group - A group from `groupPickupsByProximity`
 * @param knownRideIds - The ids of the rides this device holds, from `RideContext`
 * @returns One suggestion per direction, or none when no leg can be placed in time
 *
 * @example
 * ```typescript
 * const [suggestion] = suggestRidesForGroup(group, knownRideIds);
 * const ride = await createRide({ ...suggestion, legs: undefined });
 * ```
 */
export function suggestRidesForGroup(
  group: PickupGroup,
  knownRideIds: ReadonlySet<string>,
): readonly RideSuggestion[] {
  const byDirection = new Map<RideDirection, Transport[]>();

  for (const pickup of group.pickups) {
    // A leg with no readable datetime cannot set a meeting time and cannot be
    // checked against one either. `selectPickupsNeedingDriver` already drops
    // those; this guards a caller that grouped an unselected list.
    if (toTransportInstant(pickup.datetime) === null) {
      continue;
    }

    const direction = rideDirectionForLeg(pickup),
      existing = byDirection.get(direction);

    if (existing === undefined) {
      byDirection.set(direction, [pickup]);
    } else {
      existing.push(pickup);
    }
  }

  const suggestions: RideSuggestion[] = [];

  for (const direction of ['pickup', 'dropoff'] as const) {
    const legs = byDirection.get(direction);

    if (legs === undefined || legs.length === 0) {
      continue;
    }

    const ordered = sortTransportsByInstant(legs),
      earliest = ordered[0];

    // Unreachable — the list is non-empty — but `noUncheckedIndexedAccess`
    // wants the narrowing and it costs one line.
    if (earliest === undefined) {
      continue;
    }

    const existingRideId = sharedRideId(ordered, knownRideIds);

    suggestions.push({
      direction,
      location: group.displayStation,
      meetDatetime: earliest.datetime,
      legs: ordered,
      existingRideId,
      isArranged:
        existingRideId !== undefined &&
        ordered.every((leg) => leg.rideId === existingRideId),
    });
  }

  return suggestions;
}

// ============================================================================
// Joining
// ============================================================================

/**
 * The rides one leg could still be added to.
 *
 * A car is joinable when it goes the same way, to the same place, and has not
 * left yet. The ride the leg already sits in is excluded — offering to add a
 * passenger to the car they are in is not an action, and taking the offer would
 * be a no-op write to the shared document.
 *
 * A ride whose meeting time cannot be read is excluded rather than kept: we
 * cannot prove it is still ahead, and putting a guest in a car that may already
 * have gone is the worse of the two mistakes.
 *
 * @param rides - The trip's rides, from `RideContext`
 * @param transport - The leg looking for a car
 * @param nowMs - The reference instant, from `TransportContext.nowMs`
 * @returns Matching rides, earliest meeting time first
 */
export function selectJoinableRides(
  rides: readonly Ride[],
  transport: Transport,
  nowMs: number,
): readonly Ride[] {
  const direction = rideDirectionForLeg(transport),
    station = normaliseStation(transport.location);

  return rides
    .filter((ride) => {
      if (ride.direction !== direction || ride.id === transport.rideId) {
        return false;
      }
      if (normaliseStation(ride.location) !== station) {
        return false;
      }

      const meetAtMs = toTransportInstant(ride.meetDatetime);
      return meetAtMs !== null && meetAtMs >= nowMs;
    })
    .sort(
      (left, right) =>
        (toTransportInstant(left.meetDatetime) ?? 0) -
        (toTransportInstant(right.meetDatetime) ?? 0),
    );
}
