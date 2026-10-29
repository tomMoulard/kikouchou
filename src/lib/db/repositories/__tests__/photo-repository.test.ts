/**
 * Integration tests for the photo repository.
 *
 * The properties under defence: a photo is keyed by its local trip, so an id
 * from somewhere else cannot reach another trip's bytes; a replaced photo is a
 * new id; and the bytes go only with the last reference to them.
 *
 * fake-indexeddb clones a jsdom Blob into an empty object, so these tests
 * check rows and keys, never the bytes that come back. A browser stores the
 * Blob itself.
 *
 * @module lib/db/repositories/__tests__/photo-repository.test
 */
import { describe, expect, it } from 'vitest';

import { db } from '@/lib/db/database';
import {
  copyPhotosToTrip,
  createPhotoId,
  getPhoto,
  listPendingPhotos,
  markPhotoUploaded,
  putPhoto,
  setRoomPhoto,
  setTripPhoto,
  toPhotoId,
} from '@/lib/db/repositories/photo-repository';
import {
  cloneRoomsToTrip,
  createRoom,
  duplicateRoomWithOwnershipCheck,
} from '@/lib/db/repositories/room-repository';
import { deleteTrip } from '@/lib/db/repositories/trip-repository';
import { createTestTrip } from '@/test/utils';
import type { PhotoId, TripId } from '@/types';

// ============================================================================
// Helpers
// ============================================================================

function image(label: string): Blob {
  return new Blob([label], { type: 'image/webp' });
}

async function newTrip(name = 'Trip'): Promise<TripId> {
  return createTestTrip({ name, startDate: '2026-07-01', endDate: '2026-07-05' });
}

// ============================================================================
// Tests
// ============================================================================

describe('toPhotoId', () => {
  it('keeps a value shaped like an id', () => {
    expect(toPhotoId(createPhotoId())).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(toPhotoId('abcdEFGH_-12')).toBe('abcdEFGH_-12');
  });

  it.each([
    ['a path', '../other-trip/photo'],
    ['too short', 'abc'],
    ['too long', 'a'.repeat(65)],
    ['a number', 12345678],
    ['nothing', undefined],
  ])('drops %s', (_label, value) => {
    expect(toPhotoId(value)).toBeUndefined();
  });
});

describe('setTripPhoto', () => {
  it('stores the bytes as pending and names them on the trip', async () => {
    const tripId = await newTrip();

    const photoId = await setTripPhoto(tripId, image('cover'));

    expect(photoId).toBeDefined();
    expect((await db.trips.get(tripId))?.photoId).toBe(photoId);
    const row = await getPhoto(tripId, photoId!);
    expect(row?.pending).toBe(1);
    expect(row?.tripId).toBe(tripId);
  });

  it('replaces with a new id and drops the old bytes', async () => {
    const tripId = await newTrip();
    const first = await setTripPhoto(tripId, image('one'));

    const second = await setTripPhoto(tripId, image('two'));

    expect(second).not.toBe(first);
    expect(await getPhoto(tripId, first!)).toBeUndefined();
    expect(await getPhoto(tripId, second!)).toBeDefined();
  });

  it('removes the photo and the key on null', async () => {
    const tripId = await newTrip();
    const photoId = await setTripPhoto(tripId, image('one'));

    const result = await setTripPhoto(tripId, null);

    expect(result).toBeUndefined();
    const trip = await db.trips.get(tripId);
    expect(trip && 'photoId' in trip).toBe(false);
    expect(await getPhoto(tripId, photoId!)).toBeUndefined();
  });

  it('refuses a trip that does not exist', async () => {
    await expect(setTripPhoto('missing' as TripId, image('x'))).rejects.toThrow(/not found/);
  });
});

describe('setRoomPhoto', () => {
  it('names the photo on the room', async () => {
    const tripId = await newTrip();
    const room = await createRoom(tripId, { name: 'Red room', capacity: 2 });

    const photoId = await setRoomPhoto(tripId, room.id, image('red'));

    expect((await db.rooms.get(room.id))?.photoId).toBe(photoId);
  });

  it('refuses a room of another trip', async () => {
    const tripId = await newTrip();
    const otherTripId = await newTrip('Other');
    const room = await createRoom(otherTripId, { name: 'Red room', capacity: 2 });

    await expect(setRoomPhoto(tripId, room.id, image('red'))).rejects.toThrow(/not found/);
    expect((await db.rooms.get(room.id))?.photoId).toBeUndefined();
  });

  it('keeps the bytes while a duplicated room still names them', async () => {
    const tripId = await newTrip();
    const room = await createRoom(tripId, { name: 'Red room', capacity: 2 });
    const photoId = await setRoomPhoto(tripId, room.id, image('red'));
    const copy = await duplicateRoomWithOwnershipCheck(room.id, tripId);
    expect(copy.photoId).toBe(photoId);

    await setRoomPhoto(tripId, room.id, null);

    expect(await getPhoto(tripId, photoId!)).toBeDefined();

    await setRoomPhoto(tripId, copy.id, null);

    expect(await getPhoto(tripId, photoId!)).toBeUndefined();
  });

  it('keeps the bytes the trip cover also names', async () => {
    const tripId = await newTrip();
    const room = await createRoom(tripId, { name: 'Red room', capacity: 2 });
    const photoId = createPhotoId();
    await putPhoto(tripId, photoId, image('shared'), false);
    await db.trips.update(tripId, { photoId });
    await db.rooms.update(room.id, { photoId });

    await setRoomPhoto(tripId, room.id, null);

    expect(await getPhoto(tripId, photoId)).toBeDefined();
  });
});

describe('the pending queue', () => {
  it('lists pending rows and forgets an uploaded one', async () => {
    const tripId = await newTrip();
    const photoId = await setTripPhoto(tripId, image('one'));
    const settled = createPhotoId();
    await putPhoto(tripId, settled, image('two'), false);

    expect((await listPendingPhotos()).map((row) => row.id)).toEqual([photoId]);

    await markPhotoUploaded(tripId, photoId!);

    expect(await listPendingPhotos()).toEqual([]);
  });
});

describe('the key is the local trip', () => {
  it('keeps the same photo id apart in two trips', async () => {
    const first = await newTrip('First');
    const second = await newTrip('Second');
    const photoId = 'samePhotoId01' as PhotoId;

    await putPhoto(first, photoId, image('first'), false);
    await putPhoto(second, photoId, image('second'), true);

    // Two rows: writing the second did not overwrite the first.
    expect(await db.photos.count()).toBe(2);
    expect((await getPhoto(first, photoId))?.pending).toBe(0);
    expect((await getPhoto(second, photoId))?.pending).toBe(1);
  });
});

describe('copying rooms to another trip', () => {
  it('copies the photo bytes as pending, under the new trip', async () => {
    const source = await newTrip('Source');
    const target = await newTrip('Target');
    const room = await createRoom(source, { name: 'Red room', capacity: 2 });
    const photoId = await setRoomPhoto(source, room.id, image('red'));
    await markPhotoUploaded(source, photoId!);

    const [cloned] = await cloneRoomsToTrip(source, target);

    expect(cloned?.photoId).toBe(photoId);
    const copy = await getPhoto(target, photoId!);
    expect(copy?.pending).toBe(1);
    expect(copy?.tripId).toBe(target);
  });

  it('skips a photo the source does not hold', async () => {
    const source = await newTrip('Source');
    const target = await newTrip('Target');

    await copyPhotosToTrip(source, target, ['absentPhoto01' as PhotoId]);

    expect(await db.photos.where('tripId').equals(target).count()).toBe(0);
  });
});

describe('deleteTrip', () => {
  it('deletes the trip photos with the trip', async () => {
    const tripId = await newTrip();
    await setTripPhoto(tripId, image('cover'));

    await deleteTrip(tripId);

    expect(await db.photos.where('tripId').equals(tripId).count()).toBe(0);
  });
});
