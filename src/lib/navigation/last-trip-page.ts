/**
 * @fileoverview The page of a trip this device showed last.
 *
 * An invite link opened a second time on the same device used to run the
 * whole join flow again: "Which one are you?", then the calendar. The person
 * had already joined, so the link now goes back to where they were. That needs
 * the page they were on, kept per trip, on this device.
 *
 * The record is also the evidence that the join flow ended: it is written only
 * from a page of the trip, and the join page is outside the trip. A visitor who
 * closed the tab on "Which one are you?" has no record and is asked again.
 *
 * Only the page is kept, never the query string: `?new=1` would open a form
 * a second time. The value is read back from storage another tab or an older
 * build may have written, so a page outside {@link TRIP_PAGES} reads as none.
 *
 * Nothing here reads `window.location`: the caller passes the path in.
 *
 * @module lib/navigation/last-trip-page
 */

import type { TripId } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/** Prefix of the localStorage key that holds a trip's last page. */
export const LAST_TRIP_PAGE_STORAGE_PREFIX = 'kikouchou-last-trip-page:';

/**
 * The pages of a trip that a link can go back to: the routes under
 * `/trips/:tripId/`, as the router lists them.
 */
export const TRIP_PAGES = [
  'calendar',
  'rooms',
  'persons',
  'transports',
  'transports/vehicles',
  'transports/map',
  'transports/runsheet',
  'activities',
  'meals',
  'money',
  'analytics',
  'summary',
  'sync',
  'edit',
] as const;

/** One page of a trip, as stored. */
export type TripPage = (typeof TRIP_PAGES)[number];

const TRIP_PAGE_SET: ReadonlySet<string> = new Set(TRIP_PAGES);

// ============================================================================
// Helpers
// ============================================================================

function isTripPage(value: string): value is TripPage {
  return TRIP_PAGE_SET.has(value);
}

/**
 * Returns the localStorage key a trip's last page lives under.
 *
 * @param tripId - The local trip id
 * @returns The localStorage key string
 */
export function getLastTripPageStorageKey(tripId: TripId | string): string {
  return `${LAST_TRIP_PAGE_STORAGE_PREFIX}${tripId}`;
}

/**
 * Splits a pathname into the trip and the page it shows.
 *
 * @param pathname - A router pathname, without the base URL
 * @returns The trip id and the page, or undefined when the path is not a
 *   known page of a trip
 */
export function parseTripPagePath(
  pathname: string,
): { readonly tripId: string; readonly page: TripPage } | undefined {
  const [, root, tripId, ...rest] = pathname.split('/');
  if (root !== 'trips' || !tripId || tripId === 'new') {
    return undefined;
  }
  const page = rest.filter((segment) => segment.length > 0).join('/');
  return isTripPage(page) ? { tripId, page } : undefined;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Stores the page a trip shows now, when the path is a page of a trip.
 *
 * Best-effort: storage that is full or refused costs the shortcut, and the
 * link then asks the questions again.
 *
 * @param pathname - The router pathname on screen
 */
export function rememberTripPage(pathname: string): void {
  const parsed = parseTripPagePath(pathname);
  if (parsed === undefined || typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(getLastTripPageStorageKey(parsed.tripId), parsed.page);
  } catch {
    // Storage unavailable: nothing to remember with.
  }
}

/**
 * Reads the page a trip showed last on this device.
 *
 * @param tripId - The local trip id
 * @returns The page, or undefined when this device never showed the trip or
 *   storage is unavailable
 */
export function readLastTripPage(tripId: TripId | string): TripPage | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  try {
    const value = window.localStorage.getItem(getLastTripPageStorageKey(tripId));
    return value !== null && isTripPage(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
