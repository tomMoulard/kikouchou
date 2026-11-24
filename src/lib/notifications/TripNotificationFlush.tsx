/**
 * @fileoverview Sends the queued "tell the others" asks once they can work.
 *
 * Mounted inside the trip's sync provider: an ask works once the change it
 * names has reached the server, which is when the sync reports nothing left to
 * send. Also on mount (asks queued in an earlier session) and when the device
 * comes back online. See `trip-notify`.
 *
 * @module lib/notifications/TripNotificationFlush
 */

import { memo, useEffect } from 'react';

import { useSyncStatus } from '@/lib/sync/SupabaseTripSync';

import { flushTripNotifications } from './trip-notify';

/** Renders nothing; flushes the queue at the moments an ask can succeed. */
export const TripNotificationFlush = memo(function TripNotificationFlush(): null {
  const { state } = useSyncStatus();
  const settled = state.status === 'synced' && state.pendingCount === 0;

  useEffect(() => {
    if (settled) {
      void flushTripNotifications();
    }
  }, [settled]);

  useEffect(() => {
    const flush = (): void => {
      void flushTripNotifications();
    };
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, []);

  return null;
});
