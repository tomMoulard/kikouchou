/**
 * @fileoverview The `trip-photos` bucket: paths, upload and download.
 *
 * Two prefixes, each with its own rule in the trip_photos migration:
 *
 * - `trips/<remoteTripId>/<photoId>`: the trip's members read and add.
 * - `templates/<templateToken>/<photoId>`: the template's owner adds, and
 *   anybody holding the link reads while the template is published.
 *
 * No client overwrites or deletes an object. A replaced photo is a new id.
 *
 * @module lib/photos/storage
 */

import type { TypedSupabaseClient } from '@/lib/supabase/client';
import type { PhotoId } from '@/types';

import { PHOTO_MAX_BYTES } from './prepare';

// ============================================================================
// Constants
// ============================================================================

/** The bucket, as the migration names it. */
export const PHOTO_BUCKET = 'trip-photos';

/**
 * The types a downloaded photo may have. The bucket accepts the same list,
 * but a downloaded body is still remote input: it is checked again here
 * before it is stored, and an SVG, which can carry script, is never one.
 */
const ACCEPTED_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png']);

/** How long the browser may cache an uploaded photo. It never changes. */
const CACHE_CONTROL_SECONDS = '31536000';

// ============================================================================
// Paths
// ============================================================================

/**
 * Where a trip's photo lives.
 *
 * @param remoteTripId - The server's id for the trip
 * @param photoId - The photo
 * @returns The object path inside {@link PHOTO_BUCKET}
 */
export function tripPhotoPath(remoteTripId: string, photoId: PhotoId): string {
  return `trips/${remoteTripId}/${photoId}`;
}

/**
 * Where a published template's photo lives.
 *
 * @param templateToken - The token in the template link
 * @param photoId - The photo
 * @returns The object path inside {@link PHOTO_BUCKET}
 */
export function templatePhotoPath(templateToken: string, photoId: PhotoId): string {
  return `templates/${templateToken}/${photoId}`;
}

// ============================================================================
// Upload and download
// ============================================================================

/**
 * Whether a storage error says the object is already there.
 *
 * That is success for this module: an object is written once and never
 * changed, so whoever wrote it first wrote the same bytes.
 *
 * @param error - The error the storage client returned
 * @returns True for "already exists"
 */
function isAlreadyThere(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { status, statusCode, code } = error as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
  };
  return (
    status === 409 ||
    statusCode === '409' ||
    code === 'Duplicate' ||
    code === 'ResourceAlreadyExists'
  );
}

/**
 * Uploads a photo, once.
 *
 * @param client - A Supabase client
 * @param path - The object path
 * @param blob - The prepared image
 * @throws {Error} When the server refuses for any reason but "already there"
 */
export async function uploadPhoto(
  client: TypedSupabaseClient,
  path: string,
  blob: Blob,
): Promise<void> {
  const { error } = await client.storage.from(PHOTO_BUCKET).upload(path, blob, {
    contentType: blob.type,
    cacheControl: CACHE_CONTROL_SECONDS,
    upsert: false,
  });
  if (error && !isAlreadyThere(error)) {
    throw new Error(`Photo upload failed: ${error.message}`);
  }
}

/**
 * Downloads a photo and checks it is one.
 *
 * @param client - A Supabase client
 * @param path - The object path
 * @returns The image, or `null` when it is missing, unreadable for this
 *   caller, of a type that is not a photo, or larger than the bucket allows
 */
export async function downloadPhoto(
  client: TypedSupabaseClient,
  path: string,
): Promise<Blob | null> {
  const { data, error } = await client.storage.from(PHOTO_BUCKET).download(path);
  if (error || !data) {
    return null;
  }
  if (!ACCEPTED_TYPES.has(data.type) || data.size > PHOTO_MAX_BYTES) {
    return null;
  }
  return data;
}
