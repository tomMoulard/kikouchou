/**
 * @fileoverview The sample trip's photos: six public-domain pictures.
 *
 * The files live in `./sample-photos` and ship with the build as plain assets,
 * so the script the app starts with does not carry their bytes. They are
 * fetched once, on the first open of a device, after the sample is written
 * and the page is on screen (`attachSamplePhotos`). In a store app they are
 * files inside the app, so that works offline.
 *
 * Every picture is CC0 or public domain (see `sample-photos/CREDITS.md`).
 * That matters: a room copied out of the sample into the user's own trip
 * carries its photo, and that photo is then uploaded with the trip.
 *
 * A picture that cannot be fetched is left out, and its card keeps the
 * placeholder.
 *
 * @module features/trips/utils/sample-trip-photos
 */

import bunkUrl from '@/features/trips/utils/sample-photos/bunk.webp';
import houseUrl from '@/features/trips/utils/sample-photos/house.webp';
import masterUrl from '@/features/trips/utils/sample-photos/master.webp';
import sofaUrl from '@/features/trips/utils/sample-photos/sofa.webp';
import tentUrl from '@/features/trips/utils/sample-photos/tent.webp';
import twinUrl from '@/features/trips/utils/sample-photos/twin.webp';

// ============================================================================
// Type Definitions
// ============================================================================

/** What a sample photo shows: the trip's cover, or one of its rooms. */
export type SamplePhotoSubject = keyof typeof SAMPLE_PHOTO_URLS;

/** The pictures that could be loaded, by what they show. */
export type SamplePhotoBlobs = Readonly<Partial<Record<SamplePhotoSubject, Blob>>>;

// ============================================================================
// Constants
// ============================================================================

/** Where the build serves each picture. */
export const SAMPLE_PHOTO_URLS = {
  house: houseUrl,
  master: masterUrl,
  twin: twinUrl,
  bunk: bunkUrl,
  sofa: sofaUrl,
  tent: tentUrl,
} as const;

/** Every subject, in the order the sample lists them. */
export const SAMPLE_PHOTO_SUBJECTS = Object.keys(SAMPLE_PHOTO_URLS) as readonly SamplePhotoSubject[];

/** How long to wait for the pictures before giving up on them. */
export const SAMPLE_PHOTO_TIMEOUT_MS = 20000;

// ============================================================================
// Loading
// ============================================================================

/**
 * Fetches one picture.
 *
 * @returns The picture, or undefined when it could not be read as an image
 */
async function loadOne(
  url: string,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<Blob | undefined> {
  try {
    const response = await fetcher(url, { signal });
    if (!response.ok) {
      return undefined;
    }
    const blob = await response.blob();
    // A host that answers every unknown path with its HTML shell must not
    // put a web page in the photo cache.
    return blob.type.startsWith('image/') && blob.size > 0 ? blob : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fetches the sample's pictures. Never throws: a picture that fails, or that
 * is still loading after the timeout, is absent from the answer.
 *
 * @param fetcher - The fetch to use; a parameter so a test can pass its own
 * @param timeoutMs - How long to wait for all of them
 * @returns The pictures that loaded, by subject
 */
export async function loadSamplePhotos(
  fetcher: typeof fetch | undefined = globalThis.fetch,
  timeoutMs: number = SAMPLE_PHOTO_TIMEOUT_MS,
): Promise<SamplePhotoBlobs> {
  if (typeof fetcher !== 'function') {
    return {};
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const loaded = await Promise.all(
      SAMPLE_PHOTO_SUBJECTS.map(
        async (subject) =>
          [subject, await loadOne(SAMPLE_PHOTO_URLS[subject], fetcher, controller.signal)] as const,
      ),
    );
    const photos: Partial<Record<SamplePhotoSubject, Blob>> = {};
    for (const [subject, blob] of loaded) {
      if (blob !== undefined) {
        photos[subject] = blob;
      }
    }
    return photos;
  } finally {
    clearTimeout(timer);
  }
}
