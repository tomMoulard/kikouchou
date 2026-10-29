/**
 * @fileoverview Writes the arrival day a guest gave before they signed in.
 *
 * A guest with no account answers "When do you arrive?" on the invite page
 * while their trip is a viewer trip, which nothing on the device may write.
 * The answer waits in `lib/sharing/pending-arrival`. Signing in returns to `/`,
 * not to the invite page, and the account sweep turns the viewer trip into a
 * member trip on the way. So the write happens here, in `Layout`, on whatever
 * page the guest is on once the trip can take it.
 *
 * "Can take it" is three things together: the trip is a member trip (no
 * `viewerToken`, a `remoteTripId`), and the sync provider says `synced`. The
 * last one matters. Written before the server's document has been projected
 * into Dexie, the projection would put the document's value back over it, and
 * the answer would be lost without a word.
 *
 * @module hooks/usePendingArrival
 */

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useTripContext } from '@/contexts/TripContext';
import { updatePersonWithOwnershipCheck } from '@/lib/db';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { notify } from '@/lib/notifications';
import { captureEvent } from '@/lib/posthog';
import { clearPendingArrival, readPendingArrival } from '@/lib/sharing/pending-arrival';
import { useSyncStatus } from '@/lib/sync/SupabaseTripSync';
import { formatFullDate } from '@/lib/utils/date-format';

// ============================================================================
// Hook
// ============================================================================

/**
 * Saves the current trip's pending arrival once the trip is writable and
 * synced, then forgets it.
 *
 * Tried once per trip per mount. A write that fails forgets the answer: the
 * guest it names is gone from the trip, and no later load would find them.
 */
export function usePendingArrival(): void {
  const { t, i18n } = useTranslation();
  const { currentTrip } = useTripContext();
  const { state } = useSyncStatus();
  const attemptedRef = useRef<string | null>(null);

  const tripId = currentTrip?.id;
  const writable =
    currentTrip !== null &&
    currentTrip !== undefined &&
    currentTrip.viewerToken === undefined &&
    currentTrip.remoteTripId !== undefined;
  const synced = state.status === 'synced';

  useEffect(() => {
    if (tripId === undefined || !writable || !synced || attemptedRef.current === tripId) {
      return;
    }
    const pending = readPendingArrival(tripId);
    if (pending === undefined) {
      return;
    }
    attemptedRef.current = tripId;

    void (async () => {
      try {
        await updatePersonWithOwnershipCheck(pending.personId, tripId, {
          stayStartDate: pending.date,
        });
      } catch (error) {
        // The guest is gone from the trip, or belongs to another one. There is
        // nobody left to give the day to.
        console.error('Failed to save the pending arrival:', error);
        clearPendingArrival(tripId);
        return;
      }
      clearPendingArrival(tripId);
      captureEvent('guest_arrival_saved', { via: 'after_sign_in' });
      notify.success(
        t('sharing.join.arrivalSavedAfterSignIn', {
          date: formatFullDate(pending.date, getDateLocale(i18n.language)),
          defaultValue: 'Your arrival on {{date}} is saved. The others can see it.',
        }),
      );
    })();
  }, [i18n.language, synced, t, tripId, writable]);
}
