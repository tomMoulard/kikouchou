/**
 * @fileoverview Tests for preparing a picked photo.
 *
 * jsdom has no canvas encoder and no `createImageBitmap`, so both are stubbed:
 * what is under test is the decision, not the pixels. Which size, which
 * format, which quality, and which failure the form explains.
 *
 * @module lib/photos/__tests__/prepare.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PHOTO_MAX_BYTES,
  PHOTO_MAX_EDGE,
  PhotoPrepareError,
  fitWithin,
  preparePhoto,
} from '@/lib/photos/prepare';

// ============================================================================
// Test doubles
// ============================================================================

const close = vi.fn();
const drawImage = vi.fn();

/** What `toBlob` hands back, per call, in order. */
let encoded: (Blob | null)[] = [];
// Typed with all three parameters so the tests can read the type and the
// quality off `mock.calls`.
const toBlob = vi.fn<(callback: BlobCallback, type?: string, quality?: number) => void>(
  (callback) => {
    callback(encoded.shift() ?? null);
  },
);

function blobOf(type: string, size: number): Blob {
  return new Blob([new Uint8Array(size)], { type });
}

beforeEach(() => {
  encoded = [];
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 4000, height: 3000, close })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(toBlob);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  close.mockClear();
  drawImage.mockClear();
  toBlob.mockClear();
});

// ============================================================================
// Tests
// ============================================================================

describe('fitWithin', () => {
  it('scales the long edge down to the limit and keeps the ratio', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: PHOTO_MAX_EDGE, height: 1200 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: PHOTO_MAX_EDGE });
  });

  it('never scales up', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('never returns a zero side', () => {
    expect(fitWithin(0, 0)).toEqual({ width: 1, height: 1 });
  });
});

describe('preparePhoto', () => {
  it('refuses a file that is not an image', async () => {
    await expect(preparePhoto(new Blob(['x'], { type: 'text/plain' }))).rejects.toMatchObject({
      reason: 'not_an_image',
    });
  });

  it('refuses an image the browser cannot decode', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => Promise.reject(new Error('bad'))));

    await expect(preparePhoto(blobOf('image/heic', 10))).rejects.toMatchObject({
      reason: 'decode_failed',
    });
  });

  it('draws at the fitted size and returns WebP with the EXIF rotation applied', async () => {
    const webp = blobOf('image/webp', 1000);
    encoded = [webp];

    const result = await preparePhoto(blobOf('image/jpeg', 5_000_000));

    expect(result).toBe(webp);
    expect(createImageBitmap).toHaveBeenCalledWith(expect.any(Blob), {
      imageOrientation: 'from-image',
    });
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, PHOTO_MAX_EDGE, 1200);
    expect(close).toHaveBeenCalled();
  });

  it('falls back to JPEG where the browser cannot write WebP', async () => {
    const png = blobOf('image/png', 1000);
    const jpeg = blobOf('image/jpeg', 1000);
    encoded = [png, jpeg];

    const result = await preparePhoto(blobOf('image/jpeg', 10));

    expect(result).toBe(jpeg);
    expect(toBlob.mock.calls.map((call) => call[1])).toEqual(['image/webp', 'image/jpeg']);
  });

  it('lowers the quality until the photo fits', async () => {
    const tooBig = blobOf('image/webp', PHOTO_MAX_BYTES + 1);
    const fits = blobOf('image/webp', PHOTO_MAX_BYTES);
    encoded = [tooBig, fits];

    const result = await preparePhoto(blobOf('image/jpeg', 10));

    expect(result).toBe(fits);
    expect(toBlob.mock.calls.map((call) => call[2])).toEqual([0.82, 0.7]);
  });

  it('gives up when even the lowest quality is too large', async () => {
    const tooBig = blobOf('image/webp', PHOTO_MAX_BYTES + 1);
    encoded = [tooBig, tooBig, tooBig, tooBig];

    const error = await preparePhoto(blobOf('image/jpeg', 10)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PhotoPrepareError);
    expect((error as PhotoPrepareError).reason).toBe('too_large');
    expect(close).toHaveBeenCalled();
  });

  it('reports a canvas with no 2D context as unreadable', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    await expect(preparePhoto(blobOf('image/jpeg', 10))).rejects.toMatchObject({
      reason: 'decode_failed',
    });
  });
});
