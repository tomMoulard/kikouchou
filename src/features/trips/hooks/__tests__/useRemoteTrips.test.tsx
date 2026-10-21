/**
 * useRemoteTrips Tests
 *
 * The hook answers one question — which trips this account belongs to that are
 * not on this device — and downloads one on demand. What is covered here is the
 * three states it can be asked in (signed out, offline, signed in and online)
 * and what `download` returns when the server cannot give it the trip.
 *
 * Every dependency is mocked: the hook's whole job is the orchestration, and
 * the Supabase client is not something jsdom can hold.
 *
 * @module features/trips/hooks/__tests__/useRemoteTrips.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useAuth } from '@/features/auth/AuthContext';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { getSupabaseClient } from '@/lib/supabase/client';
import { downloadTripDocument } from '@/lib/sync/download-document';
import { materialiseJoinedTrip } from '@/lib/sync/join-trip';
import { listRemoteTripsMissingLocally } from '@/lib/sync/remote-trip';
import type { TripId } from '@/types';

import { useRemoteTrips } from '../useRemoteTrips';

vi.mock('@/features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: vi.fn() }));
vi.mock('@/lib/sync/join-trip', () => ({ materialiseJoinedTrip: vi.fn() }));
vi.mock('@/lib/sync/remote-trip', () => ({ listRemoteTripsMissingLocally: vi.fn() }));
vi.mock('@/lib/sync/download-document', () => ({ downloadTripDocument: vi.fn() }));

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseOnlineStatus = vi.mocked(useOnlineStatus);
const mockedGetClient = vi.mocked(getSupabaseClient);
const mockedMaterialise = vi.mocked(materialiseJoinedTrip);
const mockedListMissing = vi.mocked(listRemoteTripsMissingLocally);
const mockedDownloadDocument = vi.mocked(downloadTripDocument);

/** A stand-in for the Supabase client; nothing here calls through it. */
const client = { from: vi.fn() } as never;

/** The auth value must keep its identity across renders or the effect restarts. */
const signedIn = { session: { access_token: 'token' }, user: { id: 'user-1' } } as never;
const signedOut = { session: null, user: null } as never;

const elsewhere = [
  { id: 'remote-1', name: 'Summer house' },
  { id: 'remote-2', name: 'Ski trip' },
];

describe('useRemoteTrips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseAuth.mockReturnValue(signedIn);
    mockedUseOnlineStatus.mockReturnValue({ isOnline: true, hasRecentlyChanged: false });
    mockedGetClient.mockResolvedValue(client);
    mockedListMissing.mockResolvedValue(elsewhere);
    mockedDownloadDocument.mockResolvedValue({ status: 'hydrated' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists the trips the account has elsewhere', async () => {
    const { result } = renderHook(() => useRemoteTrips(0));

    await waitFor(() => {
      expect(result.current.remoteOnly).toEqual(elsewhere);
    });
    expect(result.current.isDownloading).toBeNull();
  });

  it('asks for nothing while signed out', async () => {
    mockedUseAuth.mockReturnValue(signedOut);

    const { result } = renderHook(() => useRemoteTrips(0));

    await waitFor(() => {
      expect(result.current.remoteOnly).toEqual([]);
    });
    expect(mockedListMissing).not.toHaveBeenCalled();
  });

  it('asks for nothing while offline', async () => {
    mockedUseOnlineStatus.mockReturnValue({ isOnline: false, hasRecentlyChanged: false });

    const { result } = renderHook(() => useRemoteTrips(0));

    await waitFor(() => {
      expect(result.current.remoteOnly).toEqual([]);
    });
    expect(mockedListMissing).not.toHaveBeenCalled();
  });

  it('stays empty when there is no backend to ask', async () => {
    mockedGetClient.mockResolvedValue(null);

    const { result } = renderHook(() => useRemoteTrips(0));

    await waitFor(() => {
      expect(mockedGetClient).toHaveBeenCalled();
    });
    expect(result.current.remoteOnly).toEqual([]);
    expect(mockedListMissing).not.toHaveBeenCalled();
  });

  it('is done checking straight away while signed out', async () => {
    mockedUseAuth.mockReturnValue(signedOut);

    const { result } = renderHook(() => useRemoteTrips(0));

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });
    expect(result.current.remoteOnly).toEqual([]);
  });

  it('is still checking until the lookup answers', async () => {
    let release: (value: typeof elsewhere) => void = () => {};
    mockedListMissing.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }) as never,
    );

    const { result } = renderHook(() => useRemoteTrips(0));

    await waitFor(() => {
      expect(mockedListMissing).toHaveBeenCalled();
    });
    // The empty list here is "not known yet", not "nothing elsewhere" — which
    // is the distinction `isChecking` exists to make.
    expect(result.current.remoteOnly).toEqual([]);
    expect(result.current.isChecking).toBe(true);

    await act(async () => {
      release(elsewhere);
    });

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });
    expect(result.current.remoteOnly).toEqual(elsewhere);
  });

  it('ends the wait when the lookup throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedListMissing.mockRejectedValue(new Error('server said no'));

    const { result } = renderHook(() => useRemoteTrips(0));

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });
    expect(result.current.remoteOnly).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(
      '[trips] failed to list the trips this account has elsewhere:',
      expect.any(Error),
    );
  });

  it('asks again when the local trip list changes', async () => {
    const { rerender } = renderHook(({ count }) => useRemoteTrips(count), {
      initialProps: { count: 0 },
    });

    await waitFor(() => {
      expect(mockedListMissing).toHaveBeenCalledTimes(1);
    });

    rerender({ count: 1 });

    await waitFor(() => {
      expect(mockedListMissing).toHaveBeenCalledTimes(2);
    });
  });

  it('downloads a trip and takes it off the elsewhere list', async () => {
    mockedMaterialise.mockResolvedValue({ status: 'joined', tripId: 'local-1' as TripId });
    const { result } = renderHook(() => useRemoteTrips(0));

    await waitFor(() => {
      expect(result.current.remoteOnly).toHaveLength(2);
    });

    let downloaded: TripId | null = null;
    await act(async () => {
      downloaded = await result.current.download('remote-1');
    });

    expect(downloaded).toBe('local-1');
    expect(result.current.remoteOnly.map((trip) => trip.id)).toEqual(['remote-2']);
    expect(result.current.isDownloading).toBeNull();
  });

  it('names the trip it is downloading while the download runs', async () => {
    let release: (value: { status: 'joined'; tripId: TripId }) => void = () => {};
    mockedMaterialise.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }) as never,
    );
    const { result } = renderHook(() => useRemoteTrips(0));

    await waitFor(() => {
      expect(result.current.remoteOnly).toHaveLength(2);
    });

    let pending: Promise<TripId | null> | undefined;
    await act(async () => {
      pending = result.current.download('remote-1');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.isDownloading).toBe('remote-1');
    });

    await act(async () => {
      release({ status: 'joined', tripId: 'local-1' as TripId });
      await pending;
    });

    expect(result.current.isDownloading).toBeNull();
  });

  it('returns nothing when there is no backend to download from', async () => {
    const { result } = renderHook(() => useRemoteTrips(0));

    await waitFor(() => {
      expect(result.current.remoteOnly).toHaveLength(2);
    });

    mockedGetClient.mockResolvedValue(null);

    let downloaded: TripId | null = 'unset' as TripId;
    await act(async () => {
      downloaded = await result.current.download('remote-1');
    });

    expect(downloaded).toBeNull();
    expect(mockedMaterialise).not.toHaveBeenCalled();
    expect(result.current.remoteOnly).toHaveLength(2);
  });

  it('keeps the trip listed when the download fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedMaterialise.mockResolvedValue({ status: 'error', message: 'network down' });
    const { result } = renderHook(() => useRemoteTrips(0));

    await waitFor(() => {
      expect(result.current.remoteOnly).toHaveLength(2);
    });

    let downloaded: TripId | null = 'unset' as TripId;
    await act(async () => {
      downloaded = await result.current.download('remote-1');
    });

    expect(downloaded).toBeNull();
    expect(result.current.remoteOnly).toHaveLength(2);
    expect(consoleError).toHaveBeenCalledWith(
      '[trips] failed to download a joined trip:',
      'network down',
    );
    expect(result.current.isDownloading).toBeNull();
  });

  it('returns the local id of a trip that was already downloaded', async () => {
    mockedMaterialise.mockResolvedValue({
      status: 'already-local',
      tripId: 'local-9' as TripId,
    });
    const { result } = renderHook(() => useRemoteTrips(0));

    await waitFor(() => {
      expect(result.current.remoteOnly).toHaveLength(2);
    });

    let downloaded: TripId | null = null;
    await act(async () => {
      downloaded = await result.current.download('remote-2');
    });

    expect(downloaded).toBe('local-9');
    expect(result.current.remoteOnly.map((trip) => trip.id)).toEqual(['remote-1']);
  });

  it('says it is checking from the very first render', () => {
    const seen: boolean[] = [];
    renderHook(() => {
      const value = useRemoteTrips(0);
      seen.push(value.isChecking);
      return value;
    });

    expect(seen[0]).toBe(true);
  });

  it('keeps the answer of the newest lookup when an older one lands late', async () => {
    let releaseFirst: (value: typeof elsewhere) => void = () => {};
    let releaseSecond: (value: typeof elsewhere) => void = () => {};
    mockedListMissing
      .mockReturnValueOnce(
        new Promise((resolve) => {
          releaseFirst = resolve;
        }) as never,
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          releaseSecond = resolve;
        }) as never,
      );
    const { result, rerender } = renderHook(({ count }) => useRemoteTrips(count), {
      initialProps: { count: 0 },
    });
    await waitFor(() => {
      expect(mockedListMissing).toHaveBeenCalledTimes(1);
    });

    rerender({ count: 1 });
    await waitFor(() => {
      expect(mockedListMissing).toHaveBeenCalledTimes(2);
    });

    // The overtaken lookup ends first: it must neither fill the list nor
    // end the wait for the newer one.
    await act(async () => {
      releaseFirst(elsewhere);
    });
    expect(result.current.remoteOnly).toEqual([]);
    expect(result.current.isChecking).toBe(true);

    await act(async () => {
      releaseSecond([{ id: 'remote-3', name: 'Lake' }]);
    });
    expect(result.current.remoteOnly).toEqual([{ id: 'remote-3', name: 'Lake' }]);
    expect(result.current.isChecking).toBe(false);
  });

  it('says when a downloaded trip came without its document, and only then', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedMaterialise.mockResolvedValue({ status: 'joined', tripId: 'local-1' as TripId });
    const { result } = renderHook(() => useRemoteTrips(0));
    await waitFor(() => {
      expect(result.current.remoteOnly).toHaveLength(2);
    });

    await act(async () => {
      await result.current.download('remote-1');
    });
    expect(mockedDownloadDocument).toHaveBeenCalledWith(client, 'local-1', 'remote-1');
    expect(consoleWarn).not.toHaveBeenCalled();

    mockedDownloadDocument.mockResolvedValue({ status: 'error', message: 'no document' });
    let downloaded: TripId | null = null;
    await act(async () => {
      downloaded = await result.current.download('remote-2');
    });

    // Still a download: the trip is on the device.
    expect(downloaded).toBe('local-1');
    expect(consoleWarn).toHaveBeenCalledWith(
      '[trips] downloaded a trip without its document:',
      'no document',
    );
  });
});
