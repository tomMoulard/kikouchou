/**
 * @fileoverview Tests for moving photo bytes between the device and the bucket.
 *
 * Up: only a member trip's pending photos go, a failure stays pending, and a
 * drawing the bucket would refuse is never sent. Down: the cache key is the
 * local trip, and ten cards asking for one photo make one request.
 *
 * The photo rows are doubles because fake-indexeddb does not keep a Blob; the
 * trips are real rows.
 *
 * @module lib/photos/__tests__/photo-sync.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db, type PhotoRow } from '@/lib/db/database';
import {
  getPhoto,
  listPendingPhotos,
  markPhotoUploaded,
  putPhoto,
} from '@/lib/db/repositories/photo-repository';
import {
  fetchTripPhoto,
  readUploadablePhotoKey,
  uploadPendingPhotos,
} from '@/lib/photos/photo-sync';
import { downloadPhoto, uploadPhoto } from '@/lib/photos/storage';
import type { TypedSupabaseClient } from '@/lib/supabase/client';
import type { PhotoId, Trip, TripId } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('@/lib/db/repositories/photo-repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/repositories/photo-repository')>()),
  getPhoto: vi.fn(),
  listPendingPhotos: vi.fn(),
  markPhotoUploaded: vi.fn(async () => undefined),
  putPhoto: vi.fn(async () => undefined),
}));

vi.mock('@/lib/photos/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/photos/storage')>()),
  uploadPhoto: vi.fn(async () => undefined),
  downloadPhoto: vi.fn(),
}));

const CLIENT = {} as TypedSupabaseClient;

function row(tripId: string, id: string, type = 'image/webp'): PhotoRow {
  return { tripId, id, blob: new Blob(['x'], { type }), pending: 1, createdAt: 1 };
}

async function addTrip(id: string, extra: Partial<Trip> = {}): Promise<void> {
  await db.trips.add({
    id: id as TripId,
    name: id,
    startDate: '2026-07-01',
    endDate: '2026-07-02',
    shareId: `${id}-share`,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  } as Trip);
}

beforeEach(async () => {
  vi.clearAllMocks();
  await addTrip('member', { remoteTripId: 'remote-member' });
  await addTrip('local');
  await addTrip('viewer', { remoteTripId: 'remote-viewer', viewerToken: 'token' });
});

// ============================================================================
// Upload
// ============================================================================

describe('uploadPendingPhotos', () => {
  it('sends a member trip photo to its trip prefix and marks it uploaded', async () => {
    vi.mocked(listPendingPhotos).mockResolvedValue([row('member', 'photoAAAA0001')]);

    const result = await uploadPendingPhotos(CLIENT);

    expect(result).toEqual({ uploaded: 1, failed: 0 });
    expect(uploadPhoto).toHaveBeenCalledWith(
      CLIENT,
      'trips/remote-member/photoAAAA0001',
      expect.any(Blob),
    );
    expect(markPhotoUploaded).toHaveBeenCalledWith('member', 'photoAAAA0001');
  });

  it('leaves a local-only trip, a viewer trip and a drawing waiting', async () => {
    vi.mocked(listPendingPhotos).mockResolvedValue([
      row('local', 'photoAAAA0001'),
      row('viewer', 'photoAAAA0002'),
      row('member', 'photoAAAA0003', 'image/svg+xml'),
      row('gone', 'photoAAAA0004'),
    ]);

    const result = await uploadPendingPhotos(CLIENT);

    expect(result).toEqual({ uploaded: 0, failed: 0 });
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it('counts a refusal, keeps the row pending, and goes on to the next', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(listPendingPhotos).mockResolvedValue([
      row('member', 'photoAAAA0001'),
      row('member', 'photoAAAA0002'),
    ]);
    vi.mocked(uploadPhoto).mockRejectedValueOnce(new Error('denied'));

    const result = await uploadPendingPhotos(CLIENT);

    expect(result).toEqual({ uploaded: 1, failed: 1 });
    expect(markPhotoUploaded).toHaveBeenCalledTimes(1);
    expect(markPhotoUploaded).toHaveBeenCalledWith('member', 'photoAAAA0002');
  });
});

describe('readUploadablePhotoKey', () => {
  it('names only what a pass would send, sorted', async () => {
    vi.mocked(listPendingPhotos).mockResolvedValue([
      row('member', 'photoZZZZ0001'),
      row('local', 'photoAAAA0001'),
      row('member', 'photoAAAA0002'),
      row('member', 'photoAAAA0003', 'image/svg+xml'),
      row('viewer', 'photoAAAA0004'),
    ]);

    await expect(readUploadablePhotoKey()).resolves.toBe(
      'member:photoAAAA0002,member:photoZZZZ0001',
    );
  });

  it('is empty when nothing waits', async () => {
    vi.mocked(listPendingPhotos).mockResolvedValue([]);

    await expect(readUploadablePhotoKey()).resolves.toBe('');
  });
});

// ============================================================================
// Download
// ============================================================================

describe('fetchTripPhoto', () => {
  const PHOTO = 'photoAAAA0001' as PhotoId;

  it('downloads from the trip prefix and caches under the local trip', async () => {
    const blob = new Blob(['x'], { type: 'image/webp' });
    vi.mocked(getPhoto).mockResolvedValue(undefined);
    vi.mocked(downloadPhoto).mockResolvedValue(blob);

    await expect(fetchTripPhoto(CLIENT, 'member' as TripId, 'remote-member', PHOTO)).resolves.toBe(
      true,
    );

    expect(downloadPhoto).toHaveBeenCalledWith(CLIENT, 'trips/remote-member/photoAAAA0001');
    expect(putPhoto).toHaveBeenCalledWith('member', PHOTO, blob, false);
  });

  it('asks nothing when the cache already holds it', async () => {
    vi.mocked(getPhoto).mockResolvedValue(row('member', PHOTO));

    await expect(fetchTripPhoto(CLIENT, 'member' as TripId, 'remote-member', PHOTO)).resolves.toBe(
      true,
    );
    expect(downloadPhoto).not.toHaveBeenCalled();
  });

  it('makes one request for many callers at once', async () => {
    vi.mocked(getPhoto).mockResolvedValue(undefined);
    vi.mocked(downloadPhoto).mockResolvedValue(new Blob(['x'], { type: 'image/webp' }));

    await Promise.all(
      Array.from({ length: 5 }, () =>
        fetchTripPhoto(CLIENT, 'member' as TripId, 'remote-member', PHOTO),
      ),
    );

    expect(downloadPhoto).toHaveBeenCalledTimes(1);
  });

  it('reports false when the photo is not there, and asks again next time', async () => {
    vi.mocked(getPhoto).mockResolvedValue(undefined);
    vi.mocked(downloadPhoto).mockResolvedValue(null);

    await expect(fetchTripPhoto(CLIENT, 'member' as TripId, 'remote-member', PHOTO)).resolves.toBe(
      false,
    );
    await fetchTripPhoto(CLIENT, 'member' as TripId, 'remote-member', PHOTO);

    expect(downloadPhoto).toHaveBeenCalledTimes(2);
    expect(putPhoto).not.toHaveBeenCalled();
  });

  it('reports false rather than throwing when the read fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(getPhoto).mockRejectedValue(new Error('IndexedDB is unavailable'));

    await expect(fetchTripPhoto(CLIENT, 'member' as TripId, 'remote-member', PHOTO)).resolves.toBe(
      false,
    );
  });
});
