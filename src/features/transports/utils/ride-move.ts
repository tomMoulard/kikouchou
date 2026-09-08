/**
 * @fileoverview What moving a shared car to one passenger's new time would cost
 * the passengers already in it.
 *
 * Alice moved her train two hours and the ride is flagged. Taking the car to
 * her new time is one of the two honest answers — but with Tom and Aurélia in
 * the same car it can push *them* out, which is the same bug wearing a
 * different hat. So the cost is computed before the move is offered rather than
 * surfaced as a fresh warning afterwards: a driver who learns about it after
 * the fact has already changed a plan three people were notified of.
 *
 * Kept out of `ride-model` on purpose. That module answers "what is true about
 * this journey right now"; this one answers "what would be true if I did that",
 * and only the resolution UI asks.
 *
 * @module features/transports/utils/ride-move
 */

import { toTransportInstant } from '@/features/transports/utils/pickup-utils';
import {
  RIDE_MATCH_WINDOW_MINUTES,
  type ResolvedLeg,
  type ResolvedRide,
} from '@/features/transports/utils/ride-model';

// ============================================================================
// Type Definitions
// ============================================================================

/** What moving a ride to one leg's time would do to the rest of the car. */
export interface RideMovePreview {
  /** The instant the ride would be moved to. */
  readonly targetDatetime: string;
  /**
   * The legs that would sit outside the match window afterwards.
   *
   * A leg nobody can place in time is never counted, for the same reason
   * `resolveRides` never flags one: we cannot prove it does not fit, so it must
   * not be used as an argument against a move either.
   */
  readonly displaced: readonly ResolvedLeg[];
}

// ============================================================================
// Preview
// ============================================================================

/**
 * Works out what moving a ride to one of its legs' times would cost.
 *
 * @param journey - The journey being considered
 * @param targetDatetime - The instant the ride would move to
 * @returns The preview, or `null` when the target instant cannot be read
 *
 * @example
 * ```typescript
 * const preview = previewRideMove(journey, leg.transport.datetime);
 * preview?.displaced.length; // 2 — Tom and Aurélia would be left behind
 * ```
 */
export function previewRideMove(
  journey: ResolvedRide,
  targetDatetime: string,
): RideMovePreview | null {
  const targetAtMs = toTransportInstant(targetDatetime);

  if (targetAtMs === null) {
    return null;
  }

  const displaced = journey.legs.filter((leg) => {
    // The leg the move is *for* is never its own casualty, even when another
    // passenger happens to share its exact instant — that one is covered by the
    // comparison below.
    if (leg.transport.datetime === targetDatetime) {
      return false;
    }

    const legAtMs = toTransportInstant(leg.transport.datetime);

    return (
      legAtMs !== null &&
      Math.abs(legAtMs - targetAtMs) / 60_000 > RIDE_MATCH_WINDOW_MINUTES
    );
  });

  return { targetDatetime, displaced };
}
