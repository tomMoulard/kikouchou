/**
 * @fileoverview Turns a picked image into the bytes a cover photo stores.
 *
 * A phone camera writes 4000 px JPEGs of 5 MB and more. A card shows a photo
 * a few hundred pixels wide, the bytes are cached on every member's device,
 * and the bucket refuses anything over 2 MiB. So every photo is drawn once
 * onto a canvas at most {@link PHOTO_MAX_EDGE} px on its long edge and
 * re-encoded, before it is stored anywhere.
 *
 * Re-encoding also drops the EXIF block, and with it the GPS position of the
 * camera: a photo of the guest room is not a statement of where the phone was.
 *
 * @module lib/photos/prepare
 */

// ============================================================================
// Constants
// ============================================================================

/** The long edge of a stored photo, in pixels. */
export const PHOTO_MAX_EDGE = 1600;

/** The largest photo the bucket accepts: 2 MiB, as in the trip_photos migration. */
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Qualities tried in order until the photo fits. The first one fits for any
 * ordinary photo at 1600 px; the others are for a picture made of noise.
 */
const QUALITIES = [0.82, 0.7, 0.55, 0.4] as const;

// ============================================================================
// Type Definitions
// ============================================================================

/** Why a picked file could not become a photo. */
export type PhotoPrepareFailure = 'not_an_image' | 'decode_failed' | 'too_large';

/** Thrown by {@link preparePhoto}, with the reason the UI explains. */
export class PhotoPrepareError extends Error {
  readonly reason: PhotoPrepareFailure;

  constructor(reason: PhotoPrepareFailure) {
    super(`Could not prepare the photo: ${reason}`);
    this.name = 'PhotoPrepareError';
    this.reason = reason;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Promisified `canvas.toBlob`.
 *
 * @param canvas - The drawn canvas
 * @param type - The wanted MIME type
 * @param quality - Lossy quality, 0 to 1
 * @returns The encoded blob, or `null` when the browser could not encode it
 */
function encode(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

/**
 * The size a photo is drawn at: the original, or scaled down so its long
 * edge is {@link PHOTO_MAX_EDGE}. Never scaled up.
 *
 * @param width - Original width in pixels
 * @param height - Original height in pixels
 * @returns The target width and height, whole pixels, at least 1
 */
export function fitWithin(
  width: number,
  height: number,
): { readonly width: number; readonly height: number } {
  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(width, height, 1));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Resizes and re-encodes a picked image as WebP, or JPEG where the browser
 * cannot write WebP (Safari's `toBlob` hands back a PNG instead).
 *
 * @param file - What the file input or the camera returned
 * @returns The stored form of the photo, at most {@link PHOTO_MAX_BYTES}
 * @throws {PhotoPrepareError} When the file is not an image, cannot be
 *   decoded, or stays too large at the lowest quality
 */
export async function preparePhoto(file: Blob): Promise<Blob> {
  if (!file.type.startsWith('image/')) {
    throw new PhotoPrepareError('not_an_image');
  }

  let bitmap: ImageBitmap;
  try {
    // `from-image` applies the EXIF rotation, so a portrait photo taken on a
    // phone is not stored lying on its side.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoPrepareError('decode_failed');
  }

  try {
    const size = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new PhotoPrepareError('decode_failed');
    }
    context.drawImage(bitmap, 0, 0, size.width, size.height);

    for (const quality of QUALITIES) {
      let blob = await encode(canvas, 'image/webp', quality);
      if (blob?.type !== 'image/webp') {
        blob = await encode(canvas, 'image/jpeg', quality);
      }
      if (blob && blob.size <= PHOTO_MAX_BYTES) {
        return blob;
      }
    }
    throw new PhotoPrepareError('too_large');
  } finally {
    bitmap.close();
  }
}
