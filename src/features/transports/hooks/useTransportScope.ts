/**
 * @fileoverview The `?scope=mine|all` filter, shared by the transport views.
 *
 * Both the list and the map ask the same two questions — "who is holding this
 * device" and "how much of the trip's travel are we showing" — so both ask them
 * here rather than each keeping its own answer.
 *
 * Two decisions are load-bearing:
 *
 * - **The journeys are resolved from every transport on the trip, never from
 *   the rows the caller happens to be showing.** The map only plots legs that
 *   carry coordinates; resolving cars from that subset would drop my own
 *   coordinate-less leg out of the car I am sitting in, and the car would then
 *   look like somebody else's logistics and take my friends' legs off the map
 *   with it.
 * - **No identity means no filtering, whatever the URL says.** `?scope=mine` on
 *   a device that does not know who it is would hide every row and read as data
 *   loss, so the scope is clamped to `all` until an identity resolves — which
 *   also covers the beat before `useTripIdentity` has finished looking.
 *
 * @module features/transports/hooks/useTransportScope
 */

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { resolveRides } from '@/features/transports/utils/ride-model';
import {
  parseTransportScope,
  selectTransportsConcerning,
  TRANSPORT_SCOPE_PARAM,
  type TransportScope,
} from '@/features/transports/utils/transport-scope';
import { useTripIdentity } from '@/hooks';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRideContext } from '@/contexts/RideContext';
import { useTransportContext } from '@/contexts/TransportContext';
import type { Transport } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** What a transport view gets back when it asks for its scope. */
export interface UseTransportScopeResult<TTransport extends Transport> {
  /** The scope in force — never `'mine'` while nobody is identified. */
  readonly scope: TransportScope;
  /**
   * Whether filtering is possible at all.
   *
   * False while the identity is still resolving *and* when nobody has said who
   * they are; a view renders the hint instead of the switch.
   */
  readonly canFilter: boolean;
  /** The rows to render, already filtered. */
  readonly visibleTransports: readonly TTransport[];
  /** How many of the caller's rows the scope is hiding right now. */
  readonly hiddenCount: number;
  /** Writes the choice to the URL, where a reload and a shared link keep it. */
  setScope: (scope: TransportScope) => void;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Filters a view's transports down to the ones that concern the guest holding
 * the device, and persists the choice in `?scope=`.
 *
 * Must be used within `TripProvider`, `PersonProvider`, `TransportProvider` and
 * `RideProvider`, and under a router.
 *
 * @param candidates - The rows this view would render unfiltered
 * @returns The scope, the filtered rows, and a setter
 *
 * @example
 * ```tsx
 * const { scope, canFilter, visibleTransports, hiddenCount, setScope } =
 *   useTransportScope(transportsWithCoordinates);
 * ```
 */
export function useTransportScope<TTransport extends Transport>(
  candidates: readonly TTransport[],
): UseTransportScopeResult<TTransport> {
  const [searchParams, setSearchParams] = useSearchParams();
  const { myPersonId, isResolved } = useTripIdentity();
  const { persons } = usePersonContext();
  const { rides, vehicles } = useRideContext();
  const { arrivals, departures } = useTransportContext();

  const canFilter = isResolved && myPersonId !== undefined;

  // Absent means "only mine" for somebody the app can name, and "everyone" for
  // everybody else — the answer that never hides a row nobody can get back.
  const scope: TransportScope = canFilter
    ? parseTransportScope(searchParams.get(TRANSPORT_SCOPE_PARAM), 'mine')
    : 'all';

  const journeys = useMemo(
    () =>
      resolveRides({
        transports: [...arrivals, ...departures],
        rides,
        vehicles,
        persons,
      }),
    [arrivals, departures, rides, vehicles, persons],
  );

  const visibleTransports = useMemo(
    () =>
      scope === 'mine' && myPersonId !== undefined
        ? selectTransportsConcerning(candidates, journeys, myPersonId)
        : candidates,
    [candidates, journeys, myPersonId, scope],
  );

  const setScope = useCallback(
    (next: TransportScope): void => {
      setSearchParams((previous) => {
        const params = new URLSearchParams(previous);
        params.set(TRANSPORT_SCOPE_PARAM, next);
        return params;
      });
    },
    [setSearchParams],
  );

  return {
    scope,
    canFilter,
    visibleTransports,
    hiddenCount: candidates.length - visibleTransports.length,
    setScope,
  };
}
