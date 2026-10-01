/**
 * @fileoverview Selects the transports that belong to the guest this browser
 * says it is: the rides they drive, and their own arrivals and departures.
 *
 * Every transport view that answers "which of these are mine?" answers it
 * here, so the run sheet's filter, the "Your rides" panel and the highlight on
 * a transport card can never disagree about one leg.
 *
 * @module features/transports/utils/my-transports
 */

import { sortTransportsByInstant } from './pickup-utils';

import type { PersonId, Transport } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * One guest's own transports, split by the part they play in them.
 */
export interface MyTransports {
  /** Legs this guest drives somebody to or from, earliest first. */
  readonly driving: readonly Transport[];
  /** This guest's own arrivals and departures, earliest first. */
  readonly traveling: readonly Transport[];
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Says whether a guest drives this leg.
 *
 * @param transport - The transport to test
 * @param personId - The guest this browser is, or undefined for nobody
 * @returns True when the guest is the driver of that leg
 */
export function isDrivenBy(
  transport: Transport,
  personId: PersonId | undefined,
): boolean {
  return personId !== undefined && transport.driverId === personId;
}

/**
 * Says whether a guest travels on this leg.
 *
 * @param transport - The transport to test
 * @param personId - The guest this browser is, or undefined for nobody
 * @returns True when the leg is that guest's own arrival or departure
 */
export function isTravelledBy(
  transport: Transport,
  personId: PersonId | undefined,
): boolean {
  return personId !== undefined && transport.personId === personId;
}

/**
 * Says whether a leg concerns a guest at all, as traveller or as driver.
 *
 * This is what a card highlight asks: the reader wants one glance to tell
 * them which rows on the page are theirs.
 *
 * @param transport - The transport to test
 * @param personId - The guest this browser is, or undefined for nobody
 * @returns True when the guest travels on the leg or drives it
 */
export function isMyTransport(
  transport: Transport,
  personId: PersonId | undefined,
): boolean {
  return isTravelledBy(transport, personId) || isDrivenBy(transport, personId);
}

/**
 * Splits a guest's own transports out of a list.
 *
 * Deliberately time-free, like `selectPickupsNeedingDriver`: hand it the set
 * the caller already decided to show — usually the upcoming transports from
 * `TransportContext` — rather than letting this re-derive "now" and drift away
 * from the list it sits above.
 *
 * A guest who drives their own leg appears in both lists. That is the honest
 * answer: the leg is their journey *and* their job, and dropping it from
 * either list would hide one of the two from them.
 *
 * @param transports - The transports to split (not mutated)
 * @param personId - The guest this browser is, or undefined for nobody
 * @returns The legs they drive and the legs they travel on, earliest first
 */
export function selectMyTransports(
  transports: readonly Transport[],
  personId: PersonId | undefined,
): MyTransports {
  if (personId === undefined) {
    return { driving: [], traveling: [] };
  }

  const driving: Transport[] = [];
  const traveling: Transport[] = [];

  for (const transport of transports) {
    if (isDrivenBy(transport, personId)) {
      driving.push(transport);
    }
    if (isTravelledBy(transport, personId)) {
      traveling.push(transport);
    }
  }

  return {
    driving: sortTransportsByInstant(driving),
    traveling: sortTransportsByInstant(traveling),
  };
}
