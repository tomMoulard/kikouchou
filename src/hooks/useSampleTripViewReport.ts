/**
 * @fileoverview Reports each page of the sample trip a user opens.
 *
 * A first open selects the sample without a click, so "the sample is the
 * current trip" says nothing about whether anybody looked at it. A page of it
 * on screen does. `sample_trip_viewed` fires once per navigation to such a
 * page, with the page and the way the user got there: `list` from the trip
 * list, `nav` from the bottom bar, the "More" sheet or the sidebar, `other`
 * for anything else (a typed URL, a reload of a page reached some other way).
 *
 * The way in travels as router state, `{ via }`, set by the link that was
 * clicked. History keeps that state, so going back to an entry reports how
 * the user first reached it.
 *
 * It is not a usage action: exploring a demo is not planning a trip, so it
 * goes through `captureEvent` and not `captureUsage`.
 *
 * @module hooks/useSampleTripViewReport
 */

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

import { useTripContext } from '@/contexts/TripContext';
import { captureEvent } from '@/lib/posthog';

// ============================================================================
// Type Definitions
// ============================================================================

/** Where a click that opened a trip page came from. */
export type TripPageOpenedVia = 'list' | 'nav';

/** The router state a link sets to say where it is. */
export interface TripPageNavigationState {
  readonly via: TripPageOpenedVia;
}

// ============================================================================
// Constants
// ============================================================================

/** Router state for a trip opened from the trip list. */
export const OPENED_FROM_LIST: TripPageNavigationState = { via: 'list' };

/** Router state for a page opened from the navigation. */
export const OPENED_FROM_NAV: TripPageNavigationState = { via: 'nav' };

// ============================================================================
// Helpers
// ============================================================================

/**
 * Reads the way in from router state, which any code can set to anything.
 */
function readVia(state: unknown): TripPageOpenedVia | 'other' {
  if (typeof state !== 'object' || state === null || !('via' in state)) {
    return 'other';
  }
  const { via } = state as { readonly via: unknown };
  return via === 'list' || via === 'nav' ? via : 'other';
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Captures `sample_trip_viewed` when the location is a page of the sample.
 *
 * The bare `/trips/<id>` is skipped: it redirects to the calendar, which is
 * then reported on its own. Deduplicated on the location key, so a re-render
 * or StrictMode's second effect run does not count one view twice.
 */
export function useSampleTripViewReport(): void {
  const { sampleTripId } = useTripContext();
  const { pathname, key, state } = useLocation();
  const reportedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (sampleTripId === undefined) {
      return;
    }
    const [, root, tripId, page] = pathname.split('/');
    if (root !== 'trips' || tripId !== sampleTripId || !page) {
      return;
    }
    if (reportedKeyRef.current === key) {
      return;
    }
    reportedKeyRef.current = key;
    captureEvent('sample_trip_viewed', { page, via: readVia(state) });
  }, [sampleTripId, pathname, key, state]);
}
