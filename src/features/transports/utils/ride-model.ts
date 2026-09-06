/**
 * @fileoverview The resolved view of a car journey — the single shape every
 * transport surface reads.
 *
 * Two things in this codebase describe "somebody is driving somebody":
 *
 * 1. A {@link Ride} with legs pointing at it through `Transport.rideId`. This is
 *    what everything creates now.
 * 2. A {@link Transport} carrying a bare `driverId`, from before rides existed.
 *
 * No migration turns the second into the first. Writing `Ride` rows from a
 * Dexie upgrade would mean whichever device happened to open the app first
 * invented arrangements and pushed them into the shared document as though the
 * group had agreed them — the same failure `transport-datetime` refuses for
 * timezones, one entity further out. So the old shape is *read* instead, as a
 * one-passenger ride, and nothing downstream has to know which it started as.
 *
 * `resolveRides` is that read. Everything derived about a journey — who drives,
 * whether they are also a passenger, when they leave, which legs no longer fit
 * — is computed here once and shared, so a card, a calendar pill, a map popup
 * and a notification can never disagree about the same car.
 *
 * @module features/transports/utils/ride-model
 */

import { toTransportInstant } from '@/features/transports/utils/pickup-utils';
import {
  DEFAULT_LEAD_TIME_MINUTES,
  type Person,
  type PersonId,
  type Ride,
  type RideId,
  type Transport,
  type Vehicle,
} from '@/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * How far a leg may sit from its ride's meeting time before it is flagged.
 *
 * Matches `DEFAULT_TIME_WINDOW_MINUTES`, the window the pickup grouping already
 * uses to suggest that several legs could share a car — so a group the app
 * itself proposed never comes back flagged the moment it is accepted.
 *
 * The flag is advisory. A ride whose meeting time is deliberately early because
 * the driver wants a coffee first is not wrong, and nothing here moves it.
 */
export const RIDE_MATCH_WINDOW_MINUTES = 60;

/** A leg is *late* relative to its ride when it lands after the window. */
export type LegMismatch = 'before' | 'after';

// ============================================================================
// Type Definitions
// ============================================================================

/** One passenger's leg, resolved against the guest who is travelling. */
export interface ResolvedLeg {
  readonly transport: Transport;
  /** The traveller, when the trip still holds them. */
  readonly person: Person | undefined;
  /**
   * How this leg sits against the ride's meeting time, when it does not fit.
   *
   * `undefined` is the normal case. `'after'` is the one the user asked about:
   * Alice moved her train two hours later and three people are now waiting.
   */
  readonly mismatch: LegMismatch | undefined;
  /** Minutes between the leg and the ride's meeting time, absolute. */
  readonly mismatchMinutes: number;
}

/** A car journey with everything a view needs to render it. */
export interface ResolvedRide {
  readonly id: RideId;
  /**
   * The stored ride, or `undefined` when this journey is a legacy transport
   * with a `driverId` and no ride of its own.
   *
   * A view that offers to *edit* the journey must check this: there is no row
   * to update until the legacy leg is promoted to a real ride.
   */
  readonly ride: Ride | undefined;
  readonly direction: Ride['direction'];
  readonly meetDatetime: string;
  /** The meeting instant in epoch ms, or null when it cannot be parsed. */
  readonly meetAtMs: number | null;
  readonly location: string;
  readonly coordinates: Ride['coordinates'];
  /** Minutes before the meeting time the driver must leave. */
  readonly leadTimeMinutes: number;
  /** When the driver must set off, epoch ms, or null when unplaceable. */
  readonly leaveAtMs: number | null;
  /**
   * The driver, when the trip still holds them.
   *
   * `undefined` means two different things — nobody is driving, or somebody is
   * and this device cannot name them — so anything counting seats must read
   * {@link driverId} instead. That distinction cost a seat: a car whose driver
   * had not projected yet reported itself one place emptier than it was.
   */
  readonly driver: Person | undefined;
  /** Who is driving, whether or not this device can name them. */
  readonly driverId: PersonId | undefined;
  readonly vehicle: Vehicle | undefined;
  readonly legs: readonly ResolvedLeg[];
  /**
   * Whether the driver is also one of the passengers.
   *
   * Derived, never stored — Tom and Aurélia taking the hire car to the airport
   * is a fact about who owns the legs, and a stored flag would go stale the
   * moment either of them left the car. It is what turns "you need to leave to
   * pick people up" into "you need to leave".
   */
  readonly isSelfDriven: boolean;
  /** True when this journey is a legacy `driverId`-only transport. */
  readonly isLegacy: boolean;
}

/** Everything `resolveRides` needs, so callers pass data rather than query it. */
export interface ResolveRidesInput {
  readonly transports: readonly Transport[];
  readonly rides: readonly Ride[];
  readonly vehicles: readonly Vehicle[];
  readonly persons: readonly Person[];
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Whole minutes between two instants, or null when either cannot be placed.
 *
 * Rounded here rather than at each call site: the value is rendered straight
 * into `rides.legMismatch.*`, and a leg 2h30m30s out would otherwise read
 * "150.5 min".
 */
function minutesBetween(left: number | null, right: number | null): number | null {
  return left === null || right === null
    ? null
    : Math.round((left - right) / 60_000);
}

/**
 * Places one leg against its ride's meeting time.
 *
 * A leg nobody can place in time is never flagged: we cannot prove it does not
 * fit, and a row we cannot read must not accuse its passenger of moving.
 */
function resolveLeg(
  transport: Transport,
  personsById: ReadonlyMap<string, Person>,
  meetAtMs: number | null,
): ResolvedLeg {
  const offset = minutesBetween(toTransportInstant(transport.datetime), meetAtMs);

  if (offset === null || Math.abs(offset) <= RIDE_MATCH_WINDOW_MINUTES) {
    return {
      transport,
      person: personsById.get(transport.personId),
      mismatch: undefined,
      mismatchMinutes: offset === null ? 0 : Math.abs(offset),
    };
  }

  return {
    transport,
    person: personsById.get(transport.personId),
    mismatch: offset > 0 ? 'after' : 'before',
    mismatchMinutes: Math.abs(offset),
  };
}

/**
 * Orders legs the way a driver reads them: earliest first, unplaceable last.
 *
 * Decorate-sort-undecorate, because a comparator is called O(n log n) times and
 * `toTransportInstant` is a full `parseISO`. `resolveLeg` has already parsed
 * each datetime one step earlier to place the leg against the ride, so parsing
 * again inside the comparison was doing the expensive part of the work
 * `log n` times over. `sortRides` never had the problem — it compares the
 * `meetAtMs` it was handed — which is the shape copied here.
 */
function sortLegs(legs: ResolvedLeg[]): ResolvedLeg[] {
  return legs
    .map((leg) => ({ leg, at: toTransportInstant(leg.transport.datetime) }))
    .sort((left, right) => {
      if (left.at === null) {
        return right.at === null
          ? left.leg.transport.id.localeCompare(right.leg.transport.id)
          : 1;
      }
      if (right.at === null) {
        return -1;
      }
      return left.at === right.at
        ? left.leg.transport.id.localeCompare(right.leg.transport.id)
        : left.at - right.at;
    })
    .map(({ leg }) => leg);
}

/** Orders journeys chronologically, unplaceable ones last. */
function sortRides(rides: ResolvedRide[]): ResolvedRide[] {
  return rides.sort((left, right) => {
    if (left.meetAtMs === null) {
      return right.meetAtMs === null ? left.id.localeCompare(right.id) : 1;
    }
    if (right.meetAtMs === null) {
      return -1;
    }
    return left.meetAtMs === right.meetAtMs
      ? left.id.localeCompare(right.id)
      : left.meetAtMs - right.meetAtMs;
  });
}

// ============================================================================
// Resolution
// ============================================================================

/**
 * Resolves a trip's car journeys into the shape every view renders.
 *
 * Both storage shapes come out identical, so no caller branches on which it
 * was. A legacy leg is reported with `isLegacy: true` and `ride: undefined`,
 * which is the one distinction that survives — a view offering to edit the
 * journey has to promote it to a real ride first.
 *
 * @param input - The trip's transports, rides, vehicles and guests
 * @returns Journeys ordered by meeting time, earliest first
 *
 * @example
 * ```typescript
 * const journeys = resolveRides({ transports, rides, vehicles, persons });
 * const mine = journeys.filter((journey) => journey.driverId === myPersonId);
 * ```
 */
export function resolveRides(input: ResolveRidesInput): ResolvedRide[] {
  const personsById = new Map<string, Person>(
      input.persons.map((person) => [person.id, person]),
    ),
    vehiclesById = new Map<string, Vehicle>(
      input.vehicles.map((vehicle) => [vehicle.id, vehicle]),
    ),
    ridesById = new Map<string, Ride>(input.rides.map((ride) => [ride.id, ride])),
    legsByRideId = new Map<string, Transport[]>();

  // A `rideId` naming a ride this device does not hold is not membership. It
  // happens on the QR-changeset path, where legs travel and rides do not yet,
  // and treating it as a car would render a journey with no time and no place.
  const legacyLegs: Transport[] = [];

  for (const transport of input.transports) {
    if (transport.rideId !== undefined && ridesById.has(transport.rideId)) {
      const existing = legsByRideId.get(transport.rideId);
      if (existing === undefined) {
        legsByRideId.set(transport.rideId, [transport]);
      } else {
        existing.push(transport);
      }
      continue;
    }

    if (transport.driverId !== undefined) {
      legacyLegs.push(transport);
    }
  }

  const resolved: ResolvedRide[] = [];

  for (const ride of input.rides) {
    const meetAtMs = toTransportInstant(ride.meetDatetime),
      leadTimeMinutes = ride.leadTimeMinutes ?? DEFAULT_LEAD_TIME_MINUTES,
      legs = sortLegs(
        (legsByRideId.get(ride.id) ?? []).map((transport) =>
          resolveLeg(transport, personsById, meetAtMs),
        ),
      );

    resolved.push({
      id: ride.id,
      ride,
      direction: ride.direction,
      meetDatetime: ride.meetDatetime,
      meetAtMs,
      location: ride.location,
      coordinates: ride.coordinates,
      leadTimeMinutes,
      leaveAtMs: meetAtMs === null ? null : meetAtMs - leadTimeMinutes * 60_000,
      driver:
        ride.driverId === undefined ? undefined : personsById.get(ride.driverId),
      driverId: ride.driverId,
      vehicle:
        ride.vehicleId === undefined ? undefined : vehiclesById.get(ride.vehicleId),
      legs,
      isSelfDriven:
        ride.driverId !== undefined &&
        legs.some((leg) => leg.transport.personId === ride.driverId),
      isLegacy: false,
    });
  }

  for (const transport of legacyLegs) {
    const meetAtMs = toTransportInstant(transport.datetime);

    resolved.push({
      // The leg's own id. A legacy journey has no row of its own, and borrowing
      // the leg's id keeps every list key stable across the promotion to a real
      // ride — the leg keeps its id, the journey gains one.
      id: transport.id as unknown as RideId,
      ride: undefined,
      direction: transport.type === 'arrival' ? 'pickup' : 'dropoff',
      meetDatetime: transport.datetime,
      meetAtMs,
      location: transport.location,
      coordinates: transport.coordinates,
      leadTimeMinutes: DEFAULT_LEAD_TIME_MINUTES,
      leaveAtMs:
        meetAtMs === null ? null : meetAtMs - DEFAULT_LEAD_TIME_MINUTES * 60_000,
      driver:
        transport.driverId === undefined
          ? undefined
          : personsById.get(transport.driverId),
      driverId: transport.driverId,
      vehicle: undefined,
      legs: [
        {
          transport,
          person: personsById.get(transport.personId),
          // A one-passenger journey derived from the leg itself cannot disagree
          // with it about the time.
          mismatch: undefined,
          mismatchMinutes: 0,
        },
      ],
      isSelfDriven: transport.driverId === transport.personId,
      isLegacy: true,
    });
  }

  return sortRides(resolved);
}

// ============================================================================
// Selection
// ============================================================================

/**
 * Decides whether a journey concerns one particular guest.
 *
 * "Concerns me" is deliberately wider than "is mine": it is my own leg, the car
 * I am driving, and the car I am sitting in. Anything else on the trip is
 * somebody else's logistics.
 *
 * Compares `driverId`, not `driver?.id`. The resolved `driver` is undefined both
 * when nobody is driving and when this device has not projected that guest's row
 * yet — so reading it dropped a driver out of their *own* car's filter for as
 * long as their row was missing, which on a freshly joined device is exactly
 * when they most want to know what they are driving.
 *
 * @param journey - A resolved journey
 * @param personId - The guest asking, or undefined when nobody is identified
 * @returns True when the journey involves that guest
 */
export function rideConcernsPerson(
  journey: ResolvedRide,
  personId: PersonId | undefined,
): boolean {
  if (personId === undefined) {
    return false;
  }

  return (
    journey.driverId === personId ||
    journey.legs.some((leg) => leg.transport.personId === personId)
  );
}

/**
 * Selects the journeys a given guest is driving.
 *
 * This is the recipient rule for the "you need to leave now" alert, which goes
 * to the driver alone — nobody else can act on it.
 *
 * @param journeys - Resolved journeys
 * @param personId - The driver asking, or undefined when nobody is identified
 * @returns The journeys they drive, in the order given
 */
export function selectRidesDrivenBy(
  journeys: readonly ResolvedRide[],
  personId: PersonId | undefined,
): ResolvedRide[] {
  if (personId === undefined) {
    return [];
  }

  return journeys.filter((journey) => journey.driverId === personId);
}

/**
 * Selects the legs that no longer fit the car they are booked into.
 *
 * The user's case: Alice moved her train two hours, and Tom and Aurélia are
 * still expecting a 17:00 car. Nothing here resolves it — the ride keeps its
 * time and the driver is offered the choice — because moving a car three people
 * share is not a decision an algorithm should take on one passenger's behalf.
 *
 * @param journeys - Resolved journeys
 * @returns Each mismatched leg alongside the journey it belongs to
 */
export function selectMismatchedLegs(
  journeys: readonly ResolvedRide[],
): { readonly journey: ResolvedRide; readonly leg: ResolvedLeg }[] {
  const mismatched: { journey: ResolvedRide; leg: ResolvedLeg }[] = [];

  for (const journey of journeys) {
    for (const leg of journey.legs) {
      if (leg.mismatch !== undefined) {
        mismatched.push({ journey, leg });
      }
    }
  }

  return mismatched;
}
