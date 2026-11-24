/**
 * @fileoverview Tells the repositories which guest this device is.
 *
 * The repositories stamp `updatedBy` on every row that names a guest, so the
 * guest who made a change is not notified of it (`guest-change.ts`). They
 * cannot read React state, so this keeps the answer in the module the
 * repositories read, for the trip open in the layout.
 *
 * @module lib/notifications/ChangeAuthorBinding
 */

import { memo, useEffect } from 'react';

import { useTripContext } from '@/contexts/TripContext';
import { useTripIdentity } from '@/hooks/useTripIdentity';

import { setChangeAuthor } from './guest-change';

/** Renders nothing; keeps the change author of the open trip current. */
export const ChangeAuthorBinding = memo(function ChangeAuthorBinding(): null {
  const { currentTrip } = useTripContext();
  const { myPersonId, isResolved } = useTripIdentity();
  const tripId = currentTrip?.id;

  useEffect(() => {
    if (tripId === undefined || !isResolved) {
      return;
    }
    setChangeAuthor(tripId, myPersonId);
  }, [isResolved, myPersonId, tripId]);

  return null;
});
