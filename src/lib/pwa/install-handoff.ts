/**
 * @fileoverview Where a phone should install the app *from*, for a given trip.
 *
 * An installed iPhone app has storage separate from Safari's, and a manifest
 * with no `start_url` opens the Home Screen app on the page it was added from.
 * So the page to install from is one that can find the trip again with nothing
 * in storage: the invite page for a viewer, whose token re-reads the trip
 * anywhere, or the trip's stable link for a member, which downloads it once
 * they sign in again. Both pages swap the document's manifest for the variant
 * without `start_url` while they are on screen (`lib/pwa/use-here-manifest`).
 *
 * `?install=1` is the same request the landing page's install CTA makes: the
 * banner answers it with the browser's own steps, and the page stays put
 * instead of going on to the calendar.
 *
 * @module lib/pwa/install-handoff
 */

import type { Trip } from '@/types';

// ============================================================================
// Functions
// ============================================================================

/**
 * The page to install from so the installed app opens on this trip.
 *
 * @param trip - The trip on screen
 * @returns The handoff URL, or null for a trip that lives on this device only
 */
export function installHandoffUrl(trip: Pick<Trip, 'viewerToken' | 'remoteTripId'>): string | null {
  if (trip.viewerToken !== undefined) {
    return `/join/${encodeURIComponent(trip.viewerToken)}?install=1`;
  }
  if (trip.remoteTripId !== undefined) {
    return `/t/${encodeURIComponent(trip.remoteTripId)}?install=1`;
  }
  return null;
}
