/**
 * @fileoverview The device-local record of ride notices already shown.
 *
 * @module lib/db/repositories/__tests__/ride-notice-repository.test
 */

import { describe, expect, it } from 'vitest';

import {
  clearRideNotices,
  getRideNotices,
  markNoticeFired,
  markTransportSeen,
} from '@/lib/db/repositories/ride-notice-repository';
import type { RideId, TransportId, TripId } from '@/types';

const TRIP_ID = 'trip-1' as TripId;

describe('clearRideNotices', () => {
  it('forgets a ride\'s own notice and leaves its passengers\' watermarks', async () => {
    await markNoticeFired(TRIP_ID, 'leave', 'ride-1' as RideId, 1);
    await markNoticeFired(TRIP_ID, 'leave', 'ride-2' as RideId, 1);
    await markTransportSeen(TRIP_ID, 'leg-1' as TransportId, '2026-07-15T10:00:00.000Z');

    await clearRideNotices('ride-1' as RideId);

    expect([...(await getRideNotices(TRIP_ID)).keys()].sort()).toEqual([
      'leave:ride-2',
      'moved:leg-1',
    ]);
  });
});
