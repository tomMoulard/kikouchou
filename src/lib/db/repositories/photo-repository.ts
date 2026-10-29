/**
 * Photo Repository
 *
 * Reads and writes the cover photos of trips and rooms on this device. The
 * entity names its photo with `photoId`; the bytes live in the `photos` table
 * here and in the `trip-photos` Storage bucket (see `lib/photos`).
 *
 * @module lib/db/repositories/photo-repository
 */

import { nanoid } from 'nanoid';

import { db, type PhotoRow } from '@/lib/db/database';
import { updateTimestamp } from '@/lib/db/utils';
import type { PhotoId, RoomId, TripId } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * The shape of a photo id: a nanoid, or anything of the same alphabet and a
 * sane length. Mirrors the `photo_id` check in the trip_photos migration, so
 * a value the server refuses is refused here first.
 */
const PHOTO_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

// ============================================================================
// Ids
// ============================================================================

/**
 * Mints the id of a new photo.
 *
 * @returns A fresh photo id
 */
export function createPhotoId(): PhotoId {
  return nanoid() as PhotoId;
}

/**
 * Reads a photo id that arrived from somewhere else: the shared document, a
 * template, a form.
 *
 * It ends up in a Storage path, so anything that is not shaped like an id is
 * dropped rather than trusted: a `../` in it would name another object.
 *
 * @param value - Any value
 * @returns The value as a photo id, or `undefined` when it is not one
 */
export function toPhotoId(value: unknown): PhotoId | undefined {
  return typeof value === 'string' && PHOTO_ID_PATTERN.test(value)
    ? (value as PhotoId)
    : undefined;
}

// ============================================================================
// Rows
// ============================================================================

/**
 * Reads the cached bytes of one photo.
 *
 * @param tripId - The local trip the photo belongs to
 * @param photoId - The photo
 * @returns The row, or `undefined` when this device does not hold it
 */
export async function getPhoto(
  tripId: TripId,
  photoId: PhotoId,
): Promise<PhotoRow | undefined> {
  return db.photos.get([tripId, photoId]);
}

/**
 * Stores the bytes of one photo on this device.
 *
 * @param tripId - The local trip the photo belongs to
 * @param photoId - The photo
 * @param blob - The image
 * @param pending - True when the server does not hold these bytes yet
 */
export async function putPhoto(
  tripId: TripId,
  photoId: PhotoId,
  blob: Blob,
  pending: boolean,
): Promise<void> {
  await db.photos.put({
    tripId,
    id: photoId,
    blob,
    pending: pending ? 1 : 0,
    createdAt: Date.now(),
  });
}

/**
 * Records that the server now holds a photo, so the sweep stops sending it.
 *
 * @param tripId - The local trip the photo belongs to
 * @param photoId - The photo
 */
export async function markPhotoUploaded(
  tripId: TripId,
  photoId: PhotoId,
): Promise<void> {
  await db.photos.update([tripId, photoId], { pending: 0 });
}

/**
 * Lists the photos this device holds that the server does not.
 *
 * @returns Every row still waiting for its upload
 */
export async function listPendingPhotos(): Promise<PhotoRow[]> {
  return db.photos.where('pending').equals(1).toArray();
}

/**
 * Drops a photo's bytes from this device when nothing in its trip names it
 * any more.
 *
 * A duplicated room shares its photo with the original, so the bytes go only
 * with the last reference. Runs inside the caller's transaction.
 *
 * @param tripId - The local trip
 * @param photoId - The photo that just lost a reference
 */
async function dropIfUnreferenced(tripId: TripId, photoId: PhotoId): Promise<void> {
  const trip = await db.trips.get(tripId);
  if (trip?.photoId === photoId) {
    return;
  }
  const roomStillUsesIt = await db.rooms
    .where('tripId')
    .equals(tripId)
    .filter((room) => room.photoId === photoId)
    .count();
  if (roomStillUsesIt > 0) {
    return;
  }
  await db.photos.delete([tripId, photoId]);
}

// ============================================================================
// Setting a photo on a trip or a room
// ============================================================================

/**
 * Sets, replaces or removes a trip's cover photo.
 *
 * A new photo is always a new id, never new bytes under the old one: another
 * member may be looking at the old photo, and Storage holds no client update
 * for it (see the trip_photos migration).
 *
 * @param tripId - The trip
 * @param blob - The prepared image, or `null` to remove the photo
 * @returns The new photo id, or `undefined` when the photo was removed
 * @throws {Error} If the trip does not exist
 */
export async function setTripPhoto(
  tripId: TripId,
  blob: Blob | null,
): Promise<PhotoId | undefined> {
  return db.transaction('rw', [db.trips, db.rooms, db.photos], async () => {
    const trip = await db.trips.get(tripId);
    if (!trip) {
      throw new Error(`Trip with id "${tripId}" not found`);
    }

    const photoId = blob ? createPhotoId() : undefined;
    if (blob && photoId) {
      await putPhoto(tripId, photoId, blob, true);
    }
    // Dexie deletes a key set to `undefined`, which is how "no photo" is
    // stored and how the document bridge reads it.
    await db.trips.update(tripId, { photoId, ...updateTimestamp() });

    if (trip.photoId && trip.photoId !== photoId) {
      await dropIfUnreferenced(tripId, trip.photoId);
    }
    return photoId;
  });
}

/**
 * Sets, replaces or removes a room's photo.
 *
 * @param tripId - The trip the room must belong to
 * @param roomId - The room
 * @param blob - The prepared image, or `null` to remove the photo
 * @returns The new photo id, or `undefined` when the photo was removed
 * @throws {Error} If the room does not exist or belongs to another trip
 */
export async function setRoomPhoto(
  tripId: TripId,
  roomId: RoomId,
  blob: Blob | null,
): Promise<PhotoId | undefined> {
  return db.transaction('rw', [db.trips, db.rooms, db.photos], async () => {
    const room = await db.rooms.get(roomId);
    if (!room || room.tripId !== tripId) {
      throw new Error(`Room with id "${roomId}" not found in trip "${tripId}"`);
    }

    const photoId = blob ? createPhotoId() : undefined;
    if (blob && photoId) {
      await putPhoto(tripId, photoId, blob, true);
    }
    await db.rooms.update(roomId, { photoId });

    if (room.photoId && room.photoId !== photoId) {
      await dropIfUnreferenced(tripId, room.photoId);
    }
    return photoId;
  });
}

/**
 * Copies photo bytes from one trip to another on this device, keeping the
 * ids. Used when rooms are copied from an earlier trip.
 *
 * The copies are pending: the new trip's prefix in Storage is a different
 * one, and only the copy on this device exists yet. A photo this device
 * never held is skipped, and the room keeps an id the card cannot show
 * until somebody adds it again.
 *
 * @param fromTripId - The trip the photos come from
 * @param toTripId - The trip they are copied into
 * @param photoIds - The photos to copy
 */
export async function copyPhotosToTrip(
  fromTripId: TripId,
  toTripId: TripId,
  photoIds: readonly PhotoId[],
): Promise<void> {
  const unique = [...new Set(photoIds)];
  if (unique.length === 0) {
    return;
  }
  await db.transaction('rw', db.photos, async () => {
    const rows = await db.photos.bulkGet(
      unique.map((photoId): [string, string] => [fromTripId, photoId]),
    );
    const copies = rows
      .filter((row): row is PhotoRow => row !== undefined)
      .map((row) => ({ ...row, tripId: toTripId, pending: 1 as const, createdAt: Date.now() }));
    await db.photos.bulkPut(copies);
  });
}
