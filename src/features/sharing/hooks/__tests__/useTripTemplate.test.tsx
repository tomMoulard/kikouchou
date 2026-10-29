/**
 * @fileoverview Tests for useTripTemplate.
 *
 * The property under defence is that a visitor with no account, no app and no
 * idea what this is gets one of four clear answers, and never a spinner that
 * runs forever. A token that is not shaped like one must not become a request
 * at all: the link is public, so the path is whatever anybody types.
 *
 * @module features/sharing/hooks/__tests__/useTripTemplate.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useTripTemplate } from '../useTripTemplate';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { downloadPhoto } from '@/lib/photos/storage';
import { readTripTemplate } from '@/lib/sync/templates';
import type { PhotoId } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: vi.fn(async () => ({}) as never),
  isSupabaseConfigured: vi.fn(() => true),
}));

vi.mock('@/lib/sync/templates', async (importOriginal) => ({
  // The real `templatePhotoIds`: it reads the payload and touches nothing.
  ...(await importOriginal<typeof import('@/lib/sync/templates')>()),
  readTripTemplate: vi.fn(),
}));

vi.mock('@/lib/photos/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/photos/storage')>()),
  downloadPhoto: vi.fn(),
}));

const TEMPLATE = {
  name: 'Chalet Marmotte',
  description: null,
  location: null,
  coordinates: null,
  currency: null,
  photoId: null,
  rooms: [],
};

const TOKEN = 'tokentokentoken1';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
  vi.mocked(getSupabaseClient).mockResolvedValue({} as never);
  // `clearAllMocks` clears the calls, not the implementations, so the default
  // is restated here rather than left to whichever test ran last.
  vi.mocked(readTripTemplate).mockResolvedValue({ status: 'ok', template: TEMPLATE });
  vi.mocked(downloadPhoto).mockResolvedValue(null);
});

// ============================================================================
// Tests
// ============================================================================

describe('useTripTemplate', () => {
  it('reads the template behind a live token', async () => {
    const { result } = renderHook(() => useTripTemplate(TOKEN));

    await waitFor(() => {
      expect(result.current.phase.kind).toBe('ready');
    });
    expect(vi.mocked(readTripTemplate)).toHaveBeenCalledWith({}, TOKEN);
  });

  it('downloads the photos the template names, from its own prefix, and skips one that fails', async () => {
    const cover = new Blob(['cover'], { type: 'image/webp' });
    vi.mocked(readTripTemplate).mockResolvedValue({
      status: 'ok',
      template: {
        ...TEMPLATE,
        photoId: 'coverPhoto0001' as PhotoId,
        rooms: [
          { name: 'Red room', capacity: 2, icon: 'bed-double', photoId: 'roomPhoto0001' as PhotoId },
        ],
      },
    });
    vi.mocked(downloadPhoto).mockImplementation(async (_client, path) =>
      path === `templates/${TOKEN}/coverPhoto0001` ? cover : null,
    );

    const { result } = renderHook(() => useTripTemplate(TOKEN));

    await waitFor(() => {
      expect(result.current.phase.kind).toBe('ready');
    });
    const { phase } = result.current;
    expect(phase.kind === 'ready' && [...phase.photos.entries()]).toEqual([
      ['coverPhoto0001', cover],
    ]);
    expect(vi.mocked(downloadPhoto)).toHaveBeenCalledWith({}, `templates/${TOKEN}/roomPhoto0001`);
  });

  it('refuses a token that is not shaped like one, without asking the server', async () => {
    const { result } = renderHook(() => useTripTemplate('short'));

    await waitFor(() => {
      expect(result.current.phase.kind).toBe('not-found');
    });
    expect(vi.mocked(readTripTemplate)).not.toHaveBeenCalled();
  });

  it('refuses a route that carried no token at all', async () => {
    const { result } = renderHook(() => useTripTemplate(null));

    await waitFor(() => {
      expect(result.current.phase.kind).toBe('not-found');
    });
  });

  it('says so when this build has no server to ask', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);

    const { result } = renderHook(() => useTripTemplate(TOKEN));

    await waitFor(() => {
      expect(result.current.phase.kind).toBe('unavailable');
    });
    expect(vi.mocked(readTripTemplate)).not.toHaveBeenCalled();
  });

  it('says so when the client cannot be built', async () => {
    vi.mocked(getSupabaseClient).mockResolvedValue(null);

    const { result } = renderHook(() => useTripTemplate(TOKEN));

    await waitFor(() => {
      expect(result.current.phase.kind).toBe('unavailable');
    });
  });

  it('reports a dead link as not found', async () => {
    vi.mocked(readTripTemplate).mockResolvedValue({ status: 'not-found' });

    const { result } = renderHook(() => useTripTemplate(TOKEN));

    await waitFor(() => {
      expect(result.current.phase.kind).toBe('not-found');
    });
  });

  it('keeps a failure retryable, with the reason', async () => {
    vi.mocked(readTripTemplate).mockResolvedValue({ status: 'error', message: 'offline' });

    const { result } = renderHook(() => useTripTemplate(TOKEN));

    await waitFor(() => {
      expect(result.current.phase).toEqual({ kind: 'failed', message: 'offline' });
    });
  });

  it('asks again on retry', async () => {
    vi.mocked(readTripTemplate).mockResolvedValueOnce({ status: 'error', message: 'offline' });

    const { result } = renderHook(() => useTripTemplate(TOKEN));
    await waitFor(() => {
      expect(result.current.phase.kind).toBe('failed');
    });

    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.phase.kind).toBe('ready');
    });
    expect(vi.mocked(readTripTemplate)).toHaveBeenCalledTimes(2);
  });
});
