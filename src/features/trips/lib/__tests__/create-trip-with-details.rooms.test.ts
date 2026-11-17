/**
 * @fileoverview Tests for the rooms a new trip is created with.
 *
 * A template hands its rooms to the wizard with their notes, and the new trip
 * must keep them: a customer reads "low ceiling" in their own copy of the trip.
 *
 * @module features/trips/lib/__tests__/create-trip-with-details.rooms.test
 */

import { describe, expect, it } from 'vitest';

import { db } from '@/lib/db/database';
import { isoDate } from '@/test/utils';

import { createTripWithDetails } from '../create-trip-with-details';

// ============================================================================
// Tests
// ============================================================================

describe('createTripWithDetails, rooms', () => {
  it("saves each room's notes, and none for a room that has none", async () => {
    const outcome = await createTripWithDetails({
      form: {
        name: 'Chalet',
        startDate: isoDate('2026-07-01'),
        endDate: isoDate('2026-07-05'),
      },
      guests: [],
      rooms: [
        { name: 'Attic', capacity: 2, icon: 'bed-double', description: 'Low ceiling.' },
        { name: 'Barn', capacity: 1, icon: 'bed-single' },
      ],
      selectAsCurrent: false,
    });

    const rooms = await db.rooms.where('tripId').equals(outcome.trip.id).sortBy('order');
    expect(rooms.map((room) => room.description)).toEqual(['Low ceiling.', undefined]);
  });
});
