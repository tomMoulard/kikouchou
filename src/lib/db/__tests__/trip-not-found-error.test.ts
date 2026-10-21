/**
 * @fileoverview The error a trip lookup throws when the trip is gone.
 *
 * @module lib/db/__tests__/trip-not-found-error.test
 */

import { describe, expect, it } from 'vitest';

import { TripNotFoundError } from '@/lib/db/trip-not-found-error';

describe('TripNotFoundError', () => {
  it('names itself and the trip it could not find', () => {
    const error = new TripNotFoundError('trip-1');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('TripNotFoundError');
    expect(error.message).toBe('Trip with ID "trip-1" not found');
    expect(error.tripId).toBe('trip-1');
  });
});
