/**
 * @fileoverview "Does this transport concern me?" — one predicate, two screens.
 *
 * The transport list and the transport map answer the same question about the
 * same rows, and the moment they answer it differently a guest sees a leg on
 * the map that the list says is not theirs. So the predicate is written once,
 * here, on top of `rideConcernsPerson` — which is the wider claim: my own leg,
 * the car I drive, and the car I sit in.
 *
 * The one thing this adds on top of a journey is a leg that is in **no car at
 * all**. `resolveRides` only produces a journey for a leg that names a ride or
 * carries a legacy `driverId`, so somebody arriving by train with nobody
 * collecting them has no journey to be found through — and their own arrival is
 * the single most relevant row on the page.
 *
 * @module features/transports/utils/transport-scope
 */

import {
  rideConcernsPerson,
  type ResolvedRide,
} from '@/features/transports/utils/ride-model';
import type { PersonId, Transport, TransportId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * How much of the trip's travel a view is showing.
 *
 * `'mine'` is everything that concerns the identified guest; `'all'` is the
 * whole trip's logistics.
 */
export type TransportScope = 'mine' | 'all';

// ============================================================================
// Constants
// ============================================================================

/** The URL search parameter both transport views persist their scope in. */
export const TRANSPORT_SCOPE_PARAM = 'scope';

/** Every scope, so a parser cannot fall out of step with the union. */
const TRANSPORT_SCOPES: readonly TransportScope[] = ['mine', 'all'];

// ============================================================================
// Parsing
// ============================================================================

/**
 * Reads a scope out of a URL search parameter.
 *
 * A value nobody recognises falls back rather than throwing: the parameter is
 * user-editable and arrives in shared links, and a typo must not blank a page.
 *
 * @param raw - The raw `?scope=` value, or null when absent
 * @param fallback - What an absent or unrecognised value means
 * @returns The scope to render
 *
 * @example
 * ```typescript
 * const scope = parseTransportScope(searchParams.get(TRANSPORT_SCOPE_PARAM), 'all');
 * ```
 */
export function parseTransportScope(
  raw: string | null | undefined,
  fallback: TransportScope,
): TransportScope {
  return TRANSPORT_SCOPES.find((scope) => scope === raw) ?? fallback;
}

// ============================================================================
// Selection
// ============================================================================

/**
 * Selects the transports that concern one guest.
 *
 * `personId` is **required**, not optional-with-a-fallback. A caller that does
 * not know who it is has to say so at the call site and show everything, which
 * is the whole point: an optional parameter defaulting to `undefined` would
 * filter a page down to nothing and read to the user as "you have no travel".
 *
 * Generic in the transport so a caller that has already narrowed its rows —
 * the map filters to those with coordinates — gets its own type back.
 *
 * @param transports - The rows on offer
 * @param journeys - The trip's resolved car journeys
 * @param personId - The guest asking
 * @returns The subset concerning them, in the order given
 *
 * @example
 * ```typescript
 * const visible = scope === 'mine' && myPersonId !== undefined
 *   ? selectTransportsConcerning(transports, journeys, myPersonId)
 *   : transports;
 * ```
 */
export function selectTransportsConcerning<TTransport extends Transport>(
  transports: readonly TTransport[],
  journeys: readonly ResolvedRide[],
  personId: PersonId,
): TTransport[] {
  const inConcerningJourney = new Set<TransportId>();

  for (const journey of journeys) {
    if (!rideConcernsPerson(journey, personId)) {
      continue;
    }
    for (const leg of journey.legs) {
      inConcerningJourney.add(leg.transport.id);
    }
  }

  return transports.filter(
    (transport) =>
      transport.personId === personId || inConcerningJourney.has(transport.id),
  );
}
