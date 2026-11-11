/**
 * Tests for seedSampleTripOnce and shouldOfferSampleTrip.
 *
 * @module features/trips/utils/__tests__/seed-sample-trip.test
 */
import { describe, expect, it, vi } from 'vitest';

import {
  SAMPLE_TRIP_FORCE_STORAGE_KEY,
  attachSamplePhotos,
  seedSampleTripOnce,
  shouldOfferSampleTrip,
} from '../seed-sample-trip';
import { SAMPLE_PHOTO_SUBJECTS, type SamplePhotoBlobs } from '../sample-trip-photos';

import { db } from '@/lib/db/database';
import { createTrip, ensureSettings, getSettings } from '@/lib/db';
import { toISODateStringFromString } from '@/lib/db/utils';

// ============================================================================
// Helpers
// ============================================================================

function storageWith(value: string | null): Pick<Storage, 'getItem'> {
  return { getItem: (key) => (key === SAMPLE_TRIP_FORCE_STORAGE_KEY ? value : null) };
}

/** Every picture, each with its subject as its bytes. */
function everyPhoto(): SamplePhotoBlobs {
  return Object.fromEntries(
    SAMPLE_PHOTO_SUBJECTS.map((subject) => [subject, new Blob([subject], { type: 'image/webp' })]),
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('attachSamplePhotos', () => {
  it('gives the sample trip and every room its own picture', async () => {
    await seedSampleTripOnce('en');
    const photos = everyPhoto();
    // fake-indexeddb hands a stored Blob back as an empty object, so the
    // bytes are read on their way in.
    const put = vi.spyOn(db.photos, 'put');

    await expect(attachSamplePhotos(async () => photos)).resolves.toBe(6);
    const written = put.mock.calls.map(([row]) => row);
    put.mockRestore();

    const trip = (await db.trips.toArray())[0]!;
    const rooms = await db.rooms.where('tripId').equals(trip.id).sortBy('order');
    const stored = await db.photos.toArray();
    const blobOf = (photoId: string | undefined) =>
      written.find((photo) => photo.id === photoId && photo.tripId === trip.id)?.blob;

    expect(stored).toHaveLength(6);
    // The sample is never uploaded, so nothing waits to be.
    expect(stored.every((photo) => photo.pending === 0)).toBe(true);
    expect(blobOf(trip.photoId)).toBe(photos.house);
    expect(rooms.map((room) => [room.icon, blobOf(room.photoId)])).toEqual([
      ['bed-double', photos.master],
      ['bed-twin', photos.twin],
      ['bunk-bed', photos.bunk],
      ['sofa', photos.sofa],
      ['tent', photos.tent],
    ]);
  });

  it('attaches the pictures that loaded and leaves the other rows without one', async () => {
    await seedSampleTripOnce('en');
    const { tent } = everyPhoto();

    await expect(attachSamplePhotos(async () => ({ tent: tent! }))).resolves.toBe(1);

    const trip = (await db.trips.toArray())[0]!;
    const rooms = await db.rooms.where('tripId').equals(trip.id).toArray();

    expect(trip.photoId).toBeUndefined();
    expect(rooms.filter((room) => room.photoId !== undefined).map((room) => room.icon)).toEqual([
      'tent',
    ]);
    expect(await db.photos.count()).toBe(1);
  });

  it('keeps a photo the user chose in the meantime', async () => {
    await seedSampleTripOnce('en');
    const trip = (await db.trips.toArray())[0]!;
    await db.trips.update(trip.id, { photoId: 'photoCHOSEN01' as never });

    await expect(attachSamplePhotos(async () => everyPhoto())).resolves.toBe(5);
    expect((await db.trips.get(trip.id))?.photoId).toBe('photoCHOSEN01');
  });

  it('writes nothing when the sample was deleted while the pictures loaded', async () => {
    await seedSampleTripOnce('en');

    const attached = attachSamplePhotos(async () => {
      await db.trips.clear();
      return everyPhoto();
    });

    await expect(attached).resolves.toBe(0);
    expect(await db.photos.count()).toBe(0);
  });

  it('does not fetch anything on a device with no sample trip', async () => {
    await ensureSettings();
    const loadPhotos = vi.fn(async () => everyPhoto());

    await expect(attachSamplePhotos(loadPhotos)).resolves.toBe(0);
    expect(loadPhotos).not.toHaveBeenCalled();
  });
});

describe('seedSampleTripOnce', () => {
  it('writes the whole sample on a first open, in the given language', async () => {
    await expect(seedSampleTripOnce('fr')).resolves.toBe('seeded');

    const trips = await db.trips.toArray();
    const settings = await getSettings();

    expect(trips).toHaveLength(1);
    expect(trips[0]?.name).toMatch(/Voyage exemple/);
    expect(settings.sampleTripId).toBe(trips[0]?.id);
    expect(settings.sampleTripSeeded).toBe(true);
    expect(settings.language).toBe('fr');
    expect(settings.currentTripId).toBe(trips[0]?.id);

    for (const table of [
      db.rooms,
      db.persons,
      db.roomAssignments,
      db.vehicles,
      db.rides,
      db.transports,
      db.activities,
      db.expenses,
    ]) {
      expect(await table.where('tripId').equals(trips[0]!.id).count(), table.name).toBeGreaterThan(0);
    }
    expect(await db.guestGroups.count()).toBe(0);
  });

  it('seeds only once, even after the sample is deleted', async () => {
    await seedSampleTripOnce('en');
    await db.trips.clear();

    await expect(seedSampleTripOnce('en')).resolves.toBe('already-decided');
    expect(await db.trips.count()).toBe(0);
  });

  it('seeds once when two tabs open at the same time', async () => {
    const outcomes = await Promise.all([seedSampleTripOnce('en'), seedSampleTripOnce('en')]);

    expect([...outcomes].sort()).toEqual(['already-decided', 'seeded']);
    expect(await db.trips.count()).toBe(1);
  });

  it('declines on a device that has run the app before, and remembers it', async () => {
    await ensureSettings();

    await expect(seedSampleTripOnce('en')).resolves.toBe('returning-device');
    expect(await db.trips.count()).toBe(0);
    expect((await getSettings()).sampleTripSeeded).toBe(true);
    expect((await getSettings()).sampleTripId).toBeUndefined();

    await expect(seedSampleTripOnce('en')).resolves.toBe('already-decided');
  });

  it('declines when trips exist without a settings row', async () => {
    await createTrip({
      name: 'Mine',
      startDate: toISODateStringFromString('2026-07-01'),
      endDate: toISODateStringFromString('2026-07-03'),
    });

    await expect(seedSampleTripOnce('en')).resolves.toBe('returning-device');
    expect(await db.trips.count()).toBe(1);
    expect((await getSettings()).language).toBe('en');
  });
});

describe('shouldOfferSampleTrip', () => {
  it('offers the sample to a person', () => {
    expect(shouldOfferSampleTrip({ webdriver: false }, storageWith(null))).toBe(true);
  });

  it('skips it under automation', () => {
    expect(shouldOfferSampleTrip({ webdriver: true }, storageWith(null))).toBe(false);
  });

  it('lets automation force it with the storage key', () => {
    expect(shouldOfferSampleTrip({ webdriver: true }, storageWith('on'))).toBe(true);
  });

  it('skips it under automation when storage throws', () => {
    const throwing: Pick<Storage, 'getItem'> = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };

    expect(shouldOfferSampleTrip({ webdriver: true }, throwing)).toBe(false);
  });
});
