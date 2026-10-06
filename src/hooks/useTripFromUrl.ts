/**
 * @fileoverview Makes the trip named in the URL the current trip.
 *
 * Every trip page reads `:tripId` from the URL and copies it into
 * `TripContext`. Trips are stored per device, so a link opened on a device
 * that does not hold the trip makes `setCurrentTrip` reject with
 * {@link TripNotFoundError}. That is an expected state, not a fault: the hook
 * reports it as `isTripMissing` so the page can say what happened, and it does
 * not log it. A `console.error` here reached error tracking as an unhandled
 * exception on every such link.
 *
 * @module hooks/useTripFromUrl
 */

import { useEffect, useState } from 'react';

import { useTripContext } from '@/contexts/TripContext';
import { TripNotFoundError } from '@/lib/db/trip-not-found-error';
import { captureEvent } from '@/lib/posthog';

// ============================================================================
// Type Definitions
// ============================================================================

export interface UseTripFromUrlResult {
  /** `true` once this device has confirmed it does not hold the URL's trip. */
  readonly isTripMissing: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * The trip page a path points at: `transports` for `/trips/<id>/transports`,
 * `calendar` for the bare `/trips/<id>`. Never the trip id itself.
 */
function tripPageOf(pathname: string): string {
  return pathname.split('/')[3] || 'calendar';
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Keeps `TripContext` on the trip the URL names.
 *
 * Must be used within `TripProvider`.
 *
 * @param tripIdFromUrl - The `:tripId` route param
 * @returns Whether the trip is not on this device
 */
export function useTripFromUrl(tripIdFromUrl: string | undefined): UseTripFromUrlResult {
  const { currentTrip, isLoading, setCurrentTrip } = useTripContext();
  const [missingTripId, setMissingTripId] = useState<string | null>(null);
  const currentTripId = currentTrip?.id;

  useEffect(() => {
    if (!tripIdFromUrl || isLoading || currentTripId === tripIdFromUrl) {
      return;
    }

    let cancelled = false;
    setCurrentTrip(tripIdFromUrl).catch((err: unknown) => {
      if (!(err instanceof TripNotFoundError)) {
        console.error('Failed to set current trip from URL:', err);
        return;
      }
      if (!cancelled) {
        setMissingTripId(tripIdFromUrl);
        captureEvent('trip_missing_on_device', {
          page: tripPageOf(window.location.pathname),
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [tripIdFromUrl, currentTripId, isLoading, setCurrentTrip]);

  return {
    isTripMissing: missingTripId === tripIdFromUrl && currentTripId !== tripIdFromUrl,
  };
}
