/**
 * @fileoverview Telling a guest about every change that involves them.
 *
 * Anything added or changed that names a guest tells that guest's devices at
 * once: their own stay, a room night, a journey, a ride (its driver and every
 * passenger), a car, an activity they are in or run, a meal they cook, a
 * shopping item they buy. Invitations (`activity_invite`) and money lines
 * (`money_line`) have their own kinds; everything else is a `trip_change`.
 *
 * Two halves, both used by the repositories that write those rows:
 *
 * - {@link authorPatch} stamps `updatedBy`, the guest this device is on the
 *   trip, so the push server leaves them out: nobody is told about their own
 *   change. The layout keeps the answer current ({@link setChangeAuthor}).
 * - {@link announceGuestChange} queues the ask (`trip-notify.ts`), which goes
 *   once the change has reached the server. The server reads who the row
 *   names from the document, so the ask carries nothing but the row's id.
 *
 * A deletion is not told: the row, and so who it named, is gone from the
 * document by the time the server could read it.
 *
 * @module lib/notifications/guest-change
 */

import { db } from '@/lib/db/database';
import type { PersonId, TripId } from '@/types';

import { requestTripNotification, type TripChangeCollection } from './trip-notify';

/** The guest this device is, per trip, as the layout last said. */
const authors = new Map<TripId, PersonId>();

/**
 * Records who this device is on a trip, or that it does not know.
 *
 * @param tripId - The trip
 * @param personId - The guest this device is, or `null` when it has not said
 */
export function setChangeAuthor(tripId: TripId, personId: PersonId | null | undefined): void {
  if (personId) {
    authors.set(tripId, personId);
  } else {
    authors.delete(tripId);
  }
}

/**
 * The guest this device is on a trip, when it said.
 *
 * @param tripId - The trip
 * @returns Their id, or `undefined`
 */
export function changeAuthor(tripId: TripId): PersonId | undefined {
  return authors.get(tripId);
}

/**
 * The `updatedBy` to write with a change.
 *
 * On a new row it is left out when nobody is known. On a change it is always
 * written, `undefined` clearing an older author: whoever saved last is the
 * one not told, and a device that does not know who it is must not leave the
 * previous author out of the news.
 *
 * @param tripId - The trip the row is in
 * @param mode - `'create'` for a new row, `'update'` for a change
 * @returns The fields to spread into the row or the patch
 */
export function authorPatch(
  tripId: TripId,
  mode: 'create' | 'update',
): { updatedBy?: PersonId } {
  const author = authors.get(tripId);
  if (author !== undefined) {
    return { updatedBy: author };
  }
  return mode === 'update' ? { updatedBy: undefined } : {};
}

/**
 * Asks the push server to tell the guests a row names that it changed.
 *
 * Fire and forget: it never fails the write it follows. Does nothing for a
 * build without the push server, or a trip that is not shared.
 *
 * @param tripId - The trip the row is in
 * @param collection - Which rows
 * @param id - The row's id
 */
export function announceGuestChange(
  tripId: TripId,
  collection: TripChangeCollection,
  id: string,
): void {
  if ((import.meta.env.VITE_SHARE_ORIGIN ?? '') === '') {
    return;
  }
  void db.trips
    .get(tripId)
    .then((trip) => {
      if (trip) {
        requestTripNotification(trip, { kind: 'trip_change', collection, subjectId: id });
      }
    })
    .catch(() => {
      // A notification is never worth a failed write.
    });
}
