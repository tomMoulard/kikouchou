/**
 * @fileoverview When a driver has to set off, and how loudly to say so.
 *
 * `resolveRides` already answers *when*: `leaveAtMs` is the meeting time minus
 * the lead time the driver typed, and it is `null` whenever the meeting time
 * cannot be placed. This module answers *whether to say anything about it now*,
 * which is a question about the clock rather than about the ride, and is
 * therefore kept out of the model and out of the component.
 *
 * Three states, because the driver has three different jobs:
 *
 * - `upcoming` — nothing to do yet, but the car is on today's horizon.
 * - `leaveNow` — inside the lead window: set off.
 * - `late` — the meeting time has passed and somebody is standing on a
 *   pavement.
 *
 * Two windows bound the list at either end, and both exist so the banner can
 * *stop*. A permanently-present alert is furniture: people stop reading it, and
 * then it fails on the one morning it mattered.
 *
 * A ride whose `leaveAtMs` is `null` is never returned. We cannot prove such a
 * ride is due, and a banner that can never clear is worse than a missing one.
 *
 * @module features/transports/utils/ride-departure
 */

import {
  selectRidesDrivenBy,
  type ResolvedRide,
} from '@/features/transports/utils/ride-model';
import type { PersonId } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * How far ahead of its leave time a ride is worth mentioning at all.
 *
 * Twelve hours: long enough that tonight's airport run is on the list when the
 * driver opens the app over breakfast, short enough that a trip planned in
 * March does not put a banner on every page until it happens.
 */
export const UPCOMING_HORIZON_MINUTES = 720;

/**
 * How long after the meeting time a ride keeps saying "you are late".
 *
 * An hour. Past that the news has been overtaken by events — the driver either
 * went, or the group has long since sorted it out by phone — and the only thing
 * a still-red banner does is teach people to ignore red banners.
 */
export const LATE_GRACE_MINUTES = 60;

/** One minute, in milliseconds. Named so the arithmetic below reads. */
const MINUTE_MS = 60_000;

// ============================================================================
// Type Definitions
// ============================================================================

/** The three things the app can have to say about a driver's next departure. */
export const RIDE_DEPARTURE_STATUSES = ['upcoming', 'leaveNow', 'late'] as const;

/** How urgent one of the driver's rides is right now. */
export type RideDepartureStatus = (typeof RIDE_DEPARTURE_STATUSES)[number];

/**
 * One of the driver's rides, placed against the clock.
 *
 * `leaveAtMs` and `meetAtMs` are narrowed to numbers here: a departure only
 * exists for a ride whose instants could both be placed, so every consumer is
 * spared the null check that the model has to carry.
 */
export interface RideDeparture {
  readonly journey: ResolvedRide;
  readonly status: RideDepartureStatus;
  /** When the driver must set off, epoch ms. */
  readonly leaveAtMs: number;
  /** When the car must be at the meeting point, epoch ms. */
  readonly meetAtMs: number;
}

// ============================================================================
// Classification
// ============================================================================

/**
 * Places one journey against a reference instant.
 *
 * A ride with a zero lead time has no window in which "set off" is distinct
 * from "be there", so it steps straight from `upcoming` to `late` at the
 * meeting time. That is the honest reading of a lead time the driver set to
 * zero, not an edge case to paper over.
 *
 * @param journey - A resolved journey
 * @param nowMs - The reference instant, epoch ms
 * @returns The status, or `undefined` when the ride must not be announced
 */
export function classifyRideDeparture(
  journey: ResolvedRide,
  nowMs: number,
): RideDepartureStatus | undefined {
  const { leaveAtMs, meetAtMs } = journey;

  // Both, although the model derives one from the other: a departure hands its
  // consumers two plain numbers, and narrowing here is what makes that true.
  if (leaveAtMs === null || meetAtMs === null) {
    return undefined;
  }

  if (nowMs >= meetAtMs) {
    return nowMs - meetAtMs > LATE_GRACE_MINUTES * MINUTE_MS ? undefined : 'late';
  }

  if (nowMs >= leaveAtMs) {
    return 'leaveNow';
  }

  return leaveAtMs - nowMs > UPCOMING_HORIZON_MINUTES * MINUTE_MS
    ? undefined
    : 'upcoming';
}

// ============================================================================
// Selection
// ============================================================================

/**
 * Selects the departures one guest needs to be told about, soonest first.
 *
 * The recipient rule is `selectRidesDrivenBy`: the "you need to leave" alert
 * goes to the driver alone, because nobody else can act on it. A passenger
 * learning that their driver is late has been given a worry and no lever.
 *
 * @param journeys - Every resolved journey on the trip
 * @param personId - The guest holding the device, or undefined when unknown
 * @param nowMs - The reference instant, epoch ms
 * @returns The driver's announceable departures, ordered by leave time
 *
 * @example
 * ```typescript
 * const departures = selectRideDepartures(journeys, myPersonId, nowMs);
 * const due = departures.filter((departure) => departure.status !== 'upcoming');
 * ```
 */
export function selectRideDepartures(
  journeys: readonly ResolvedRide[],
  personId: PersonId | undefined,
  nowMs: number,
): RideDeparture[] {
  const departures: RideDeparture[] = [];

  for (const journey of selectRidesDrivenBy(journeys, personId)) {
    const status = classifyRideDeparture(journey, nowMs);

    if (status === undefined || journey.leaveAtMs === null || journey.meetAtMs === null) {
      continue;
    }

    departures.push({
      journey,
      status,
      leaveAtMs: journey.leaveAtMs,
      meetAtMs: journey.meetAtMs,
    });
  }

  return departures.sort((left, right) =>
    left.leaveAtMs === right.leaveAtMs
      ? left.journey.id.localeCompare(right.journey.id)
      : left.leaveAtMs - right.leaveAtMs,
  );
}
