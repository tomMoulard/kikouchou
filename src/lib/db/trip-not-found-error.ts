/**
 * @fileoverview The error `setCurrentTrip` throws for a trip this device does
 * not hold.
 *
 * Trips are stored per device, so a `/trips/<id>/…` link opened on another
 * device names a trip that is simply not here. That is an expected state, not
 * a fault, and a caller needs a way to tell it apart from a failed database
 * write without matching on the message text.
 *
 * Its own module rather than an export of `TripContext`: dozens of tests mock
 * that module with a factory that lists only `useTripContext`, and an extra
 * export there would be missing from every one of those mocks.
 *
 * @module lib/db/trip-not-found-error
 */

export class TripNotFoundError extends Error {
  readonly tripId: string;

  constructor(tripId: string) {
    super(`Trip with ID "${tripId}" not found`);
    this.name = 'TripNotFoundError';
    this.tripId = tripId;
  }
}
