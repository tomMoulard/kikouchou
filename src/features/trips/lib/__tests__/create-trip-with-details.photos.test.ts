/**
 * @fileoverview Tests for the photos a new trip is created with.
 *
 * The cover comes from the form or a template, each room's photo from a
 * template. A photo that cannot be saved is a warning, never a lost trip.
 *
 * @module features/trips/lib/__tests__/create-trip-with-details.photos.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db/database';
import { setRoomPhoto, setTripPhoto } from '@/lib/db/repositories/photo-repository';
import { isoDate } from '@/test/utils';

import { createTripWithDetails } from '../create-trip-with-details';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('@/lib/db/repositories/photo-repository', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/db/repositories/photo-repository')>();
  return {
    ...actual,
    setTripPhoto: vi.fn(actual.setTripPhoto),
    setRoomPhoto: vi.fn(actual.setRoomPhoto),
  };
});

const FORM = {
  name: 'Chalet',
  startDate: isoDate('2026-07-01'),
  endDate: isoDate('2026-07-05'),
};

function image(label: string): Blob {
  return new Blob([label], { type: 'image/webp' });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('createTripWithDetails, photos', () => {
  it('saves the cover and each room photo under the new trip', async () => {
    const cover = image('cover');
    const red = image('red');

    const outcome = await createTripWithDetails({
      form: FORM,
      guests: [],
      rooms: [
        { name: 'Red room', capacity: 2, icon: 'bed-double', photo: red },
        { name: 'Plain room', capacity: 1, icon: 'bed-single' },
      ],
      photo: cover,
      selectAsCurrent: false,
    });

    expect(outcome.warnings).toEqual([]);
    const trip = await db.trips.get(outcome.trip.id);
    expect(trip?.photoId).toBeDefined();
    const rooms = await db.rooms.where('tripId').equals(outcome.trip.id).sortBy('order');
    expect(rooms[0]?.photoId).toBeDefined();
    expect(rooms[1]?.photoId).toBeUndefined();
    expect(await db.photos.where('tripId').equals(outcome.trip.id).count()).toBe(2);
  });

  it('creates the trip and warns when a photo cannot be saved', async () => {
    vi.mocked(setTripPhoto).mockRejectedValueOnce(new Error('quota'));
    vi.mocked(setRoomPhoto).mockRejectedValueOnce(new Error('quota'));

    const outcome = await createTripWithDetails({
      form: FORM,
      guests: [],
      rooms: [{ name: 'Red room', capacity: 2, icon: 'bed-double', photo: image('red') }],
      photo: image('cover'),
      selectAsCurrent: false,
    });

    expect(await db.trips.get(outcome.trip.id)).toBeDefined();
    expect(outcome.counts.rooms).toBe(1);
    expect(outcome.warnings).toEqual(['photos']);
  });

  it('touches no photo when none was given', async () => {
    const outcome = await createTripWithDetails({
      form: FORM,
      guests: [],
      rooms: [{ name: 'Plain room', capacity: 1, icon: 'bed-single' }],
      selectAsCurrent: false,
    });

    expect(setTripPhoto).not.toHaveBeenCalled();
    expect(setRoomPhoto).not.toHaveBeenCalled();
    expect(outcome.warnings).toEqual([]);
  });
});
