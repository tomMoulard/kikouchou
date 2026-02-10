/**
 * @fileoverview Utility functions for pickup grouping and proximity detection.
 *
 * @module features/transports/utils/pickup-utils
 */

import { parseISO } from 'date-fns';
import type { Transport } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * Default time window in minutes for grouping pickups at the same station.
 */
export const DEFAULT_TIME_WINDOW_MINUTES = 60;

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
// Functions
// ============================================================================

/**
 * Groups unassigned pickups by station proximity within a time window.
 *
 * Algorithm:
 * 1. Filter to unassigned pickups (needsPickup && !driverId && datetime >= now)
 * 2. Sort by datetime
 * 3. Group by matching station (case-insensitive trim) AND within timeWindow
 * 4. Return sorted groups by earliest datetime
 *
 * @param pickups - Array of upcoming transports
 * @param timeWindowMinutes - Max minutes between pickups to group (default: 60)
 * @returns Array of pickup groups sorted by earliest datetime
 */
export function groupPickupsByProximity(
  pickups: readonly Transport[],
  timeWindowMinutes: number = DEFAULT_TIME_WINDOW_MINUTES,
): PickupGroup[] {
  const now = new Date();

  // Filter to unassigned upcoming pickups
  const unassigned = pickups.filter((t) => {
    if (!t.needsPickup || t.driverId) return false;
    try {
      const date = parseISO(t.datetime);
      return !isNaN(date.getTime()) && date >= now;
    } catch {
      return false;
    }
  });

  // Sort by datetime
  const sorted = [...unassigned].sort((a, b) => a.datetime.localeCompare(b.datetime));

  const groups: Array<{
    station: string;
    displayStation: string;
    pickups: Transport[];
    earliestTime: number;
    latestTime: number;
  }> = [];

  for (const pickup of sorted) {
    const normalizedStation = pickup.location.trim().toLowerCase();
    const pickupTime = parseISO(pickup.datetime).getTime();
    const windowMs = timeWindowMinutes * 60 * 1000;

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
        displayStation: pickup.location,
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
