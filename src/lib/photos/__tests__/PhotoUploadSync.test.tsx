/**
 * @fileoverview Tests for the background photo upload.
 *
 * It must run once there is an account, a network and something to send, and
 * at no other time: a pass per render would be a request per render.
 *
 * @module lib/photos/__tests__/PhotoUploadSync.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

import { useAuth } from '@/features/auth/AuthContext';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { readUploadablePhotoKey, uploadPendingPhotos } from '@/lib/photos/photo-sync';
import { getSupabaseClient } from '@/lib/supabase/client';

import { PhotoUploadSync } from '../PhotoUploadSync';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('@/features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: vi.fn() }));
vi.mock('@/lib/photos/photo-sync', () => ({
  readUploadablePhotoKey: vi.fn(),
  uploadPendingPhotos: vi.fn(),
}));

const CLIENT = { storage: {} } as never;

function signedIn(signedInNow: boolean): void {
  vi.mocked(useAuth).mockReturnValue({
    session: signedInNow ? { user: { id: 'user-1' } } : null,
  } as never);
}

function online(isOnline: boolean): void {
  vi.mocked(useOnlineStatus).mockReturnValue({ isOnline, hasRecentlyChanged: false });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  signedIn(true);
  online(true);
  vi.mocked(getSupabaseClient).mockResolvedValue(CLIENT);
  vi.mocked(readUploadablePhotoKey).mockResolvedValue('trip:photo0000001');
  vi.mocked(uploadPendingPhotos).mockResolvedValue({ uploaded: 1, failed: 0 });
});

// ============================================================================
// Tests
// ============================================================================

describe('PhotoUploadSync', () => {
  it('renders nothing', () => {
    const { container } = render(<PhotoUploadSync />);

    expect(container).toBeEmptyDOMElement();
  });

  it('uploads when signed in, online, with a photo waiting', async () => {
    render(<PhotoUploadSync />);
    await settle();

    expect(uploadPendingPhotos).toHaveBeenCalledWith(CLIENT);
  });

  it.each([
    ['signed out', () => signedIn(false)],
    ['offline', () => online(false)],
    ['with nothing waiting', () => vi.mocked(readUploadablePhotoKey).mockResolvedValue('')],
  ])('does nothing %s', async (_label, arrange) => {
    arrange();

    render(<PhotoUploadSync />);
    await settle();

    expect(uploadPendingPhotos).not.toHaveBeenCalled();
  });

  it('does nothing without a configured backend', async () => {
    vi.mocked(getSupabaseClient).mockResolvedValue(null);

    render(<PhotoUploadSync />);
    await settle();

    expect(uploadPendingPhotos).not.toHaveBeenCalled();
  });

  it('does not run again on a re-render that changes nothing', async () => {
    const { rerender } = render(<PhotoUploadSync />);
    await settle();
    rerender(<PhotoUploadSync />);
    await settle();

    expect(uploadPendingPhotos).toHaveBeenCalledTimes(1);
  });

  it('survives a failed pass and runs the next one', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(uploadPendingPhotos).mockRejectedValueOnce(new Error('offline'));
    online(false);
    const { rerender } = render(<PhotoUploadSync />);
    await settle();

    online(true);
    rerender(<PhotoUploadSync />);
    await settle();
    online(false);
    rerender(<PhotoUploadSync />);
    await settle();
    online(true);
    rerender(<PhotoUploadSync />);
    await settle();

    expect(uploadPendingPhotos).toHaveBeenCalledTimes(2);
  });
});
