/**
 * @fileoverview Tests for usePhotoUrl.
 *
 * A cached photo becomes an object URL, revoked when it goes. A missing one
 * is fetched for a member trip, and never for a viewer, a local-only trip or
 * an offline device.
 *
 * @module hooks/__tests__/usePhotoUrl.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { db } from '@/lib/db/database';
import { fetchTripPhoto } from '@/lib/photos/photo-sync';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { PhotoId, TripId } from '@/types';

import { usePhotoUrl, type PhotoTrip } from '../usePhotoUrl';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: vi.fn() }));
vi.mock('@/lib/photos/photo-sync', () => ({ fetchTripPhoto: vi.fn(async () => true) }));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: vi.fn() }));

const CLIENT = { storage: {} } as never;
const PHOTO = 'photoAAAA0001' as PhotoId;
const MEMBER: PhotoTrip = { id: 'trip-1' as TripId, remoteTripId: 'remote-1' };

const createObjectURL = vi.fn(() => 'blob:photo');
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useOnlineStatus).mockReturnValue({ isOnline: true, hasRecentlyChanged: false });
  vi.mocked(getSupabaseClient).mockResolvedValue(CLIENT);
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

function cached(blob: Blob | undefined): void {
  vi.spyOn(db.photos, 'get').mockResolvedValue(
    blob === undefined ? undefined : { tripId: 'trip-1', id: PHOTO, blob, pending: 0, createdAt: 1 },
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('usePhotoUrl', () => {
  it('turns the cached bytes into an object URL, and revokes it on unmount', async () => {
    const blob = new Blob(['x'], { type: 'image/webp' });
    cached(blob);

    const { result, unmount } = renderHook(() => usePhotoUrl(MEMBER, PHOTO));

    await waitFor(() => {
      expect(result.current).toBe('blob:photo');
    });
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(fetchTripPhoto).not.toHaveBeenCalled();

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:photo');
  });

  it('is undefined with no photo, and asks nothing', async () => {
    const get = vi.spyOn(db.photos, 'get');

    const { result } = renderHook(() => usePhotoUrl(MEMBER, undefined));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current).toBeUndefined();
    expect(get).not.toHaveBeenCalled();
    expect(fetchTripPhoto).not.toHaveBeenCalled();
  });

  it('fetches a member trip photo the cache lacks, by the local trip id', async () => {
    cached(undefined);

    renderHook(() => usePhotoUrl(MEMBER, PHOTO));

    await waitFor(() => {
      expect(fetchTripPhoto).toHaveBeenCalledWith(CLIENT, 'trip-1', 'remote-1', PHOTO);
    });
  });

  it.each([
    ['a local-only trip', { id: 'trip-1' as TripId }, true],
    ['a viewer trip', { ...MEMBER, viewerToken: 'token' }, true],
    ['an offline device', MEMBER, false],
  ])('does not fetch for %s', async (_label, trip: PhotoTrip, isOnline) => {
    vi.mocked(useOnlineStatus).mockReturnValue({ isOnline, hasRecentlyChanged: false });
    cached(undefined);

    renderHook(() => usePhotoUrl(trip, PHOTO));

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchTripPhoto).not.toHaveBeenCalled();
  });

  it('does not fetch without a configured backend', async () => {
    vi.mocked(getSupabaseClient).mockResolvedValue(null);
    cached(undefined);

    renderHook(() => usePhotoUrl(MEMBER, PHOTO));

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchTripPhoto).not.toHaveBeenCalled();
  });
});
