/**
 * @fileoverview Moves photo bytes between this device and the bucket.
 *
 * Up: {@link uploadPendingPhotos} sends every photo this device holds alone,
 * for every trip that is on the server and that this device is a member of.
 * A photo added to a local-only trip waits, and goes the moment the trip is
 * uploaded.
 *
 * Down: {@link fetchTripPhoto} fetches a photo a card asks for and does not
 * find here, and caches it.
 *
 * @module lib/photos/photo-sync
 */

import { db } from '@/lib/db/database';
import {
  getPhoto,
  listPendingPhotos,
  markPhotoUploaded,
  putPhoto,
} from '@/lib/db/repositories/photo-repository';
import type { TypedSupabaseClient } from '@/lib/supabase/client';
import type { PhotoId, TripId } from '@/types';

import { downloadPhoto, tripPhotoPath, uploadPhoto } from './storage';

// ============================================================================
// Constants
// ============================================================================

/** The types the bucket accepts, as the trip_photos migration lists them. */
const UPLOADABLE_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png']);

// ============================================================================
// Upload
// ============================================================================

/** What one pass of {@link uploadPendingPhotos} did. */
export interface PhotoUploadResult {
  readonly uploaded: number;
  readonly failed: number;
}

/**
 * Uploads every pending photo of every member trip on this device.
 *
 * One at a time: a phone on a train uploading four photos side by side
 * finishes none of them sooner. A failure leaves the row pending for the
 * next pass and does not stop the others.
 *
 * @param client - A signed-in Supabase client
 * @returns How many photos went up, and how many did not
 */
export async function uploadPendingPhotos(
  client: TypedSupabaseClient,
): Promise<PhotoUploadResult> {
  const pending = await listPendingPhotos();
  let uploaded = 0;
  let failed = 0;

  for (const row of pending) {
    const trip = await db.trips.get(row.tripId);
    // A local-only trip has no prefix yet, and a viewer trip is read-only on
    // this device: both wait.
    if (!trip?.remoteTripId || trip.viewerToken !== undefined) {
      continue;
    }
    // The sample's drawings are SVG, which the bucket refuses. Rooms copied
    // from the sample carry them, so they are skipped here rather than sent
    // to be refused on every pass.
    if (!UPLOADABLE_TYPES.has(row.blob.type)) {
      continue;
    }
    const tripId = row.tripId as TripId;
    const photoId = row.id as PhotoId;
    try {
      await uploadPhoto(client, tripPhotoPath(trip.remoteTripId, photoId), row.blob);
      await markPhotoUploaded(tripId, photoId);
      uploaded += 1;
    } catch (error) {
      failed += 1;
      console.warn(
        '[photos] could not upload a photo:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return { uploaded, failed };
}

/**
 * The pending photos {@link uploadPendingPhotos} would send now, as a stable
 * key: sorted `tripId:photoId` pairs. What `PhotoUploadSync` watches.
 *
 * @returns The key, empty when nothing is waiting
 */
export async function readUploadablePhotoKey(): Promise<string> {
  const pending = await listPendingPhotos();
  if (pending.length === 0) {
    return '';
  }
  const trips = await db.trips.bulkGet([...new Set(pending.map((row) => row.tripId))]);
  const memberTripIds = new Set(
    trips
      .filter((trip) => trip?.remoteTripId !== undefined && trip.viewerToken === undefined)
      .map((trip) => trip?.id),
  );
  return pending
    .filter((row) => memberTripIds.has(row.tripId as TripId) && UPLOADABLE_TYPES.has(row.blob.type))
    .map((row) => `${row.tripId}:${row.id}`)
    .sort()
    .join(',');
}

// ============================================================================
// Download
// ============================================================================

/**
 * Downloads in flight, by `tripId:photoId`, so ten cards naming one photo
 * make one request.
 */
const inFlight = new Map<string, Promise<boolean>>();

/**
 * Fetches a trip's photo into this device's cache, unless it is already
 * there.
 *
 * @param client - A signed-in Supabase client
 * @param tripId - The local trip, which is the cache key; never a remote id
 * @param remoteTripId - The server's id for the trip, which is the path
 * @param photoId - The photo the document names
 * @returns True when the cache now holds the photo
 */
export function fetchTripPhoto(
  client: TypedSupabaseClient,
  tripId: TripId,
  remoteTripId: string,
  photoId: PhotoId,
): Promise<boolean> {
  const key = `${tripId}:${photoId}`;
  const running = inFlight.get(key);
  if (running) {
    return running;
  }

  const attempt = (async () => {
    if (await getPhoto(tripId, photoId)) {
      return true;
    }
    const blob = await downloadPhoto(client, tripPhotoPath(remoteTripId, photoId));
    if (!blob) {
      return false;
    }
    await putPhoto(tripId, photoId, blob, false);
    return true;
  })()
    .catch((error: unknown) => {
      console.warn(
        '[photos] could not download a photo:',
        error instanceof Error ? error.message : String(error),
      );
      return false;
    })
    .finally(() => {
      // Forgotten either way: a photo that failed may be uploaded by its
      // author a minute later, and the next card to ask should try again.
      inFlight.delete(key);
    });

  inFlight.set(key, attempt);
  return attempt;
}
