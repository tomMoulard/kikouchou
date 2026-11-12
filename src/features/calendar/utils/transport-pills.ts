/**
 * @fileoverview Merges the guests of one train into one calendar pill.
 *
 * @module features/calendar/utils/transport-pills
 */

import { getSharedLegKey } from '@/lib/db/shared-legs';

import type { CalendarTransport } from '../types';

/**
 * Draws the guests of one train as one pill, in the order the day lists them.
 *
 * Two legs share a pill only when the pill can speak for both: the same train
 * (`sharedLegId`), the same car, the same pickup request and the same driver.
 * The pill names every guest (`personName`) and carries the other legs in
 * `sharedWith`.
 *
 * @param dayTransports - One day's pills, one per leg
 * @returns The day's pills, one per train and pickup arrangement
 */
export function mergeSharedLegPills(
  dayTransports: readonly CalendarTransport[],
): CalendarTransport[] {
  const pills = new Map<string, CalendarTransport>();
  for (const calTransport of dayTransports) {
    const { transport } = calTransport;
    const pillKey = [
      getSharedLegKey(transport),
      calTransport.ride?.id ?? '',
      String(transport.needsPickup),
      transport.driverId ?? '',
    ].join('|');
    const pill = pills.get(pillKey);
    pills.set(
      pillKey,
      pill
        ? {
            ...pill,
            personName: `${pill.personName}, ${calTransport.personName}`,
            sharedWith: [...(pill.sharedWith ?? []), transport],
          }
        : calTransport,
    );
  }
  return [...pills.values()];
}
