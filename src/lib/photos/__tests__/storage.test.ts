/**
 * @fileoverview Tests for the trip-photos bucket helpers.
 *
 * Two properties: an object written twice is still one success, and a
 * downloaded body is remote input that must be a photo before it is kept.
 *
 * @module lib/photos/__tests__/storage.test
 */

import { describe, expect, it, vi } from 'vitest';

import {
  PHOTO_BUCKET,
  downloadPhoto,
  templatePhotoPath,
  tripPhotoPath,
  uploadPhoto,
} from '@/lib/photos/storage';
import type { TypedSupabaseClient } from '@/lib/supabase/client';
import type { PhotoId } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

function fakeClient(bucket: {
  upload?: ReturnType<typeof vi.fn>;
  download?: ReturnType<typeof vi.fn>;
}) {
  const from = vi.fn(() => bucket);
  return { client: { storage: { from } } as unknown as TypedSupabaseClient, from };
}

const PHOTO = 'photoId000001' as PhotoId;

// ============================================================================
// Tests
// ============================================================================

describe('paths', () => {
  it('puts a trip photo under the trip and a template photo under the token', () => {
    expect(tripPhotoPath('remote-uuid', PHOTO)).toBe('trips/remote-uuid/photoId000001');
    expect(templatePhotoPath('tokentokentoken1', PHOTO)).toBe(
      'templates/tokentokentoken1/photoId000001',
    );
  });
});

describe('uploadPhoto', () => {
  it('uploads once, never overwriting, with the blob type', async () => {
    const upload = vi.fn(async () => ({ data: {}, error: null }));
    const { client, from } = fakeClient({ upload });
    const blob = new Blob(['x'], { type: 'image/webp' });

    await uploadPhoto(client, 'trips/a/b', blob);

    expect(from).toHaveBeenCalledWith(PHOTO_BUCKET);
    expect(upload).toHaveBeenCalledWith('trips/a/b', blob, expect.objectContaining({
      contentType: 'image/webp',
      upsert: false,
    }));
  });

  it.each([
    ['a 409 status', { message: 'exists', status: 409 }],
    ['a 409 status code', { message: 'exists', statusCode: '409' }],
    ['a Duplicate code', { message: 'exists', code: 'Duplicate' }],
    ['a ResourceAlreadyExists code', { message: 'exists', code: 'ResourceAlreadyExists' }],
  ])('treats %s as success: the same bytes are already there', async (_label, error) => {
    const { client } = fakeClient({ upload: vi.fn(async () => ({ data: null, error })) });

    await expect(uploadPhoto(client, 'p', new Blob(['x']))).resolves.toBeUndefined();
  });

  it('throws on any other refusal', async () => {
    const { client } = fakeClient({
      upload: vi.fn(async () => ({ data: null, error: { message: 'denied', status: 403 } })),
    });

    await expect(uploadPhoto(client, 'p', new Blob(['x']))).rejects.toThrow(/denied/);
  });
});

describe('downloadPhoto', () => {
  it('returns a photo', async () => {
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    const { client } = fakeClient({ download: vi.fn(async () => ({ data: blob, error: null })) });

    await expect(downloadPhoto(client, 'p')).resolves.toBe(blob);
  });

  it('returns null when the server refuses', async () => {
    const { client } = fakeClient({
      download: vi.fn(async () => ({ data: null, error: { message: 'not found' } })),
    });

    await expect(downloadPhoto(client, 'p')).resolves.toBeNull();
  });

  it('refuses an SVG, which can carry script', async () => {
    const svg = new Blob(['<svg/>'], { type: 'image/svg+xml' });
    const { client } = fakeClient({ download: vi.fn(async () => ({ data: svg, error: null })) });

    await expect(downloadPhoto(client, 'p')).resolves.toBeNull();
  });

  it('refuses a body larger than the bucket allows', async () => {
    const huge = new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'image/webp' });
    const { client } = fakeClient({ download: vi.fn(async () => ({ data: huge, error: null })) });

    await expect(downloadPhoto(client, 'p')).resolves.toBeNull();
  });
});
