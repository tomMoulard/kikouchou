/**
 * @fileoverview Timing and selection helpers for transports and pickups, plus
 * the proximity grouping used by the pickup alert panel.
 *
 * Every view that asks "is this transport still ahead of us?" or "how many
 * pickups still need a driver?" answers it here, so the analytics badge, the
 * alert panel and its visibility gate can never disagree.
 *
 * @module features/transports/utils/pickup-utils
 */

import { parseISO } from 'date-fns';

import type { Ride, Transport } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * Default time window in minutes for grouping pickups at the same station.
 */
export const DEFAULT_TIME_WINDOW_MINUTES = 60;

// ============================================================================
// Places
// ============================================================================

/**
 * Folds a place name into the key two places are compared on.
 *
 * One definition, because two features now decide "is this the same place?":
 * the proximity grouping below, which offers to put three legs in one car, and
 * `RideForm`, which remembers how long the drive to that place took last time.
 * A private copy in either is how the app comes to propose a shared car for a
 * station it then refuses to remember — `getDateLocale` reached twelve copies
 * in this repo before it was pulled back together.
 *
 * `location` is required by the `Transport` type, but nothing enforces that on
 * a record arriving over Yjs from a peer, and one such row used to throw
 * `Cannot read properties of undefined (reading 'trim')` straight into the
 * error boundary — taking the whole transports page down rather than the one
 * malformed pickup. An absent name folds to the empty key instead.
 *
 * @param location - A place name as stored, possibly absent
 * @returns The trimmed, case-folded key
 *
 * @example
 * ```typescript
 * normaliseStation('  CDG Terminal 2 '); // 'cdg terminal 2'
 * ```
 */
export function normaliseStation(location: string | undefined): string {
  return (location ?? '').trim().toLowerCase();
}

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * A group of pickups at the same station within a time window.
 */
export interface PickupGroup {
  /** The shared station name (normalized). */
  readonly station: string;
  /** Original station name for display (from first pickup). */
  readonly displayStation: string;
  /** Earliest datetime in the group (ISO string). */
  readonly startTime: string;
  /** Latest datetime in the group (ISO string). */
  readonly endTime: string;
  /** Pickups in this group, sorted by datetime. */
  readonly pickups: readonly Transport[];
}

// ============================================================================
// Timing
// ============================================================================

/**
 * Resolves a transport datetime to an absolute instant.
 *
 * `Transport.datetime` is an ISO 8601 string, but the schema accepts `Z`, a
 * numeric offset and no offset at all, and records also arrive over Yjs from
 * peers without ever passing through the form. Comparing those strings
 * lexicographically only happens to work while every value shares one exact
 * formatting: `2026-07-15T14:00:00+02:00` sorts *after* `2026-07-15T13:00:00Z`
 * even though it happens an hour *before* it. Everything here compares
 * instants instead.
 *
 * @param datetime - ISO datetime string
 * @returns Epoch milliseconds, or null when the value cannot be parsed
 */
export function toTransportInstant(datetime: string | undefined): number | null {
  if (!datetime) {
    return null;
  }

  try {
    const parsed = parseISO(datetime).getTime();
    return isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

/**
 * Decides whether a transport is still ahead of the reference instant.
 *
 * A datetime that cannot be parsed is never reported as upcoming: we cannot
 * prove it is in the future, and a row we cannot place in time must not
 * inflate a "still to come" count.
 *
 * @param datetime - ISO datetime string
 * @param nowMs - Reference instant in epoch milliseconds (`TransportContext.nowMs`)
 * @returns True when the transport happens at or after the reference instant
 */
export function isTransportUpcoming(
  datetime: string | undefined,
  nowMs: number,
): boolean {
  const instant = toTransportInstant(datetime);
  return instant !== null && instant >= nowMs;
}

/**
 * Orders transports chronologically by instant.
 *
 * Sorting by the raw string mis-orders mixed-offset values for the same reason
 * comparing them does — see {@link toTransportInstant}. A row whose datetime
 * cannot be parsed sorts last: it belongs at the end of a chronological list,
 * not floated to the top of one.
 *
 * @param transports - Transports to order (not mutated)
 * @returns A new array sorted earliest first
 */
export function sortTransportsByInstant(
  transports: readonly Transport[],
): Transport[] {
  return [...transports].sort((a, b) => {
    const left = toTransportInstant(a.datetime);
    const right = toTransportInstant(b.datetime);

    if (left === null) {
      return right === null ? 0 : 1;
    }
    if (right === null) {
      return -1;
    }
    return left - right;
  });
}

// ============================================================================
// Selection
// ============================================================================

/**
 * Selects the pickups that still need somebody to drive.
 *
 * This is the single answer to "how many rides still need a driver". It is
 * deliberately time-free: the base set is `TransportContext.upcomingPickups`,
 * which is already filtered against the context's single, minute-refreshed
 * reference instant. Re-deriving "now" here is what used to let the analytics
 * badge, the alert panel's visibility gate and the count inside the panel
 * disagree with one another.
 *
 * A leg is covered when *somebody is actually driving it*, which since rides
 * exist is three different arrangements:
 *
 * - it sits in a {@link Ride} that has a driver — the normal case;
 * - it carries a legacy `driverId` of its own, from before rides existed;
 * - it sits in a ride the driver is also a passenger on, which is still a
 *   driver.
 *
 * A leg in a ride **without** a driver is not covered. Being put in a car
 * nobody has volunteered to drive is precisely the state this list exists to
 * surface, and treating the ride's existence as an answer would hide three
 * people who still have no lift.
 *
 * `rides` is required rather than optional. An optional argument defaulting to
 * an empty list is how a new call site silently regresses to pre-ride
 * behaviour — it would report Guillaume's three passengers as unassigned, on
 * one screen only, with nothing failing.
 *
 * Rows whose datetime cannot be parsed are excluded, so every returned pickup
 * can be placed on a timeline by {@link groupPickupsByProximity} — the count
 * above the cards and the cards themselves therefore always match.
 *
 * @param upcomingPickups - The trip's upcoming pickups, from `TransportContext`
 * @param rides - The trip's rides, from `RideContext`
 * @returns Pickups nobody is driving yet, earliest first
 */
export function selectPickupsNeedingDriver(
  upcomingPickups: readonly Transport[],
  rides: readonly Ride[],
): readonly Transport[] {
  const drivenRideIds = collectDrivenRideIds(rides);

  return sortTransportsByInstant(
    upcomingPickups.filter(
      (transport) =>
        transport.needsPickup &&
        !isLegCovered(transport, drivenRideIds) &&
        toTransportInstant(transport.datetime) !== null,
    ),
  );
}

/**
 * Indexes the rides somebody has actually volunteered to drive.
 *
 * Built once and passed to {@link isLegCovered} rather than rebuilt per leg: a
 * list page asks the question for every row it renders.
 *
 * @param rides - The trip's rides
 * @returns The ids of the rides that have a driver
 */
export function collectDrivenRideIds(rides: readonly Ride[]): ReadonlySet<string> {
  return new Set(
    rides.filter((ride) => Boolean(ride.driverId)).map((ride) => ride.id as string),
  );
}

/**
 * Is somebody actually driving this leg?
 *
 * **The single definition.** It was briefly two: this selector knew that a ride
 * with a driver covers its legs, while the badge on the transport card and the
 * one in the map popup still asked the pre-ride question `needsPickup &&
 * !driverId`. So one page contradicted itself — the amber "nobody is driving
 * yet" panel disappeared once Guillaume volunteered, and Alice's own card went
 * on telling her nobody was collecting her.
 *
 * Three arrangements count as covered, and the third is the one that is easy to
 * miss: a ride the driver is also a passenger on is still a driven ride.
 *
 * A `rideId` naming a ride this device does not hold is **not** coverage. It
 * happens on the QR-changeset path, where legs travel and rides do not yet, and
 * treating an unresolvable id as "handled" would quietly drop somebody from the
 * list of people who still need a lift.
 *
 * @param transport - The leg
 * @param drivenRideIds - From {@link collectDrivenRideIds}
 * @returns True when somebody is driving it
 */
export function isLegCovered(
  transport: Transport,
  drivenRideIds: ReadonlySet<string>,
): boolean {
  // Truthiness, not `!== undefined`. An empty-string `driverId` is what a form
  // that cleared its select and a peer that serialised a blank both produce,
  // and it means *nobody is driving* — reading it as a driver drops the leg out
  // of the one list whose job is to surface people who still need a lift. The
  // pre-ride check was `!transport.driverId`; narrowing it to `!== undefined`
  // was a silent regression.
  if (transport.driverId) {
    return true;
  }

  return Boolean(transport.rideId) && drivenRideIds.has(transport.rideId!);
}

// ============================================================================
// Grouping
// ============================================================================

/**
 * Groups pickups by station proximity within a time window.
 *
 * Filtering is *not* this function's job — pass it the output of
 * {@link selectPickupsNeedingDriver} so that the number rendered above the
 * cards and the cards themselves come from the same selection.
 *
 * Algorithm:
 * 1. Sort by instant
 * 2. Group by matching station (case-insensitive trim) AND within timeWindow
 * 3. Return groups sorted by earliest instant
 *
 * @param pickups - Pickups to group, already selected by the caller
 * @param timeWindowMinutes - Max minutes between pickups to group (default: 60)
 * @returns Array of pickup groups sorted by earliest datetime
 */
export function groupPickupsByProximity(
  pickups: readonly Transport[],
  timeWindowMinutes: number = DEFAULT_TIME_WINDOW_MINUTES,
): PickupGroup[] {
  const sorted = sortTransportsByInstant(pickups);
  const windowMs = timeWindowMinutes * 60 * 1000;

  const groups: Array<{
    station: string;
    displayStation: string;
    pickups: Transport[];
    earliestTime: number;
    latestTime: number;
  }> = [];

  for (const pickup of sorted) {
    const pickupTime = toTransportInstant(pickup.datetime);
    // Defensive: a row we cannot place in time has no position in a proximity
    // window. `selectPickupsNeedingDriver` already drops those, so this only
    // guards a caller that hands over an unselected list.
    if (pickupTime === null) {
      continue;
    }

    // Shared with `RideForm`'s destination memory — see `normaliseStation`.
    const normalizedStation = normaliseStation(pickup.location);

    // Find an existing group that matches (within timeWindow of any pickup in the group)
    let matched = false;
    for (const group of groups) {
      if (
        group.station === normalizedStation &&
        pickupTime >= group.earliestTime - windowMs &&
        pickupTime <= group.latestTime + windowMs
      ) {
        group.pickups.push(pickup);
        if (pickupTime < group.earliestTime) group.earliestTime = pickupTime;
        if (pickupTime > group.latestTime) group.latestTime = pickupTime;
        matched = true;
        break;
      }
    }

    if (!matched) {
      groups.push({
        station: normalizedStation,
        displayStation: pickup.location ?? '',
        pickups: [pickup],
        earliestTime: pickupTime,
        latestTime: pickupTime,
      });
    }
  }

  // Sort groups by earliest time and convert to PickupGroup
  return groups
    .sort((a, b) => a.earliestTime - b.earliestTime)
    .map((g) => ({
      station: g.station,
      displayStation: g.displayStation,
      startTime: new Date(g.earliestTime).toISOString(),
      endTime: new Date(g.latestTime).toISOString(),
      pickups: g.pickups,
    }));
}
