/**
 * @fileoverview Tests for the component that decides when the archive sync runs.
 *
 * @module lib/sync/__tests__/TripArchiveSync.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';

import { useAuth } from '@/features/auth/AuthContext';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { db } from '@/lib/db/database';
import { createTrip, setTripArchived } from '@/lib/db/repositories/trip-repository';
import { reportError } from '@/lib/posthog';
import { getSupabaseClient } from '@/lib/supabase/client';
import { syncTripArchives } from '@/lib/sync/trip-archives';
import { TripArchiveSync } from '../TripArchiveSync';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('@/lib/posthog', () => ({ reportError: vi.fn(), default: undefined }));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: vi.fn() }));
vi.mock('@/lib/sync/trip-archives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sync/trip-archives')>();
  return { ...actual, syncTripArchives: vi.fn() };
});

const mockedUseAuth = vi.mocked(useAuth);
const mockedOnlineStatus = vi.mocked(useOnlineStatus);
const mockedGetClient = vi.mocked(getSupabaseClient);
const mockedSync = vi.mocked(syncTripArchives);
const mockedReportError = vi.mocked(reportError);

const CLIENT = { from: vi.fn() } as never;
const SYNCED = { status: 'synced', pulled: 0, pushed: 0, failed: 0 } as const;

function signedInAs(userId: string | null): void {
  mockedUseAuth.mockReturnValue({
    session: userId ? { access_token: 'tok', user: { id: userId } } : null,
    user: userId ? { id: userId } : null,
    isResolved: true,
    isAvailable: true,
    isSigningIn: false,
  } as never);
}

function online(isOnline: boolean): void {
  mockedOnlineStatus.mockReturnValue({ isOnline, hasRecentlyChanged: false });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

// ============================================================================
// Tests
// ============================================================================

describe('TripArchiveSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetClient.mockResolvedValue(CLIENT);
    mockedSync.mockResolvedValue(SYNCED);
    online(true);
  });

  it('syncs once a session appears', async () => {
    signedInAs('user-1');

    render(<TripArchiveSync />);

    await waitFor(() => {
      expect(mockedSync).toHaveBeenCalledWith(CLIENT, 'user-1');
    });
  });

  it('does nothing signed out or offline', async () => {
    signedInAs(null);
    const { rerender } = render(<TripArchiveSync />);
    await settle();

    signedInAs('user-1');
    online(false);
    rerender(<TripArchiveSync />);
    await settle();

    expect(mockedSync).not.toHaveBeenCalled();
  });

  it('syncs again when a member trip is archived here', async () => {
    signedInAs('user-1');
    const trip = await createTrip({ name: 'Brittany' });
    await db.trips.update(trip.id, { remoteTripId: 'remote-1' });
    render(<TripArchiveSync />);
    await waitFor(() => {
      expect(mockedSync).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await setTripArchived(trip.id, true);
    });

    await waitFor(() => {
      expect(mockedSync).toHaveBeenCalledTimes(2);
    });
  });

  it('does not sync again for an edit that leaves the archive alone', async () => {
    signedInAs('user-1');
    const trip = await createTrip({ name: 'Brittany' });
    await db.trips.update(trip.id, { remoteTripId: 'remote-1' });
    render(<TripArchiveSync />);
    await waitFor(() => {
      expect(mockedSync).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await db.trips.update(trip.id, { name: 'Brittany 2026' });
    });
    await settle();

    expect(mockedSync).toHaveBeenCalledTimes(1);
  });

  it('syncs when the tab comes back into view', async () => {
    signedInAs('user-1');
    render(<TripArchiveSync />);
    await waitFor(() => {
      expect(mockedSync).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      setVisibility('hidden');
    });
    await settle();
    expect(mockedSync).toHaveBeenCalledTimes(1);

    await act(async () => {
      setVisibility('visible');
    });
    await waitFor(() => {
      expect(mockedSync).toHaveBeenCalledTimes(2);
    });
  });

  it('runs a request that arrives mid-pass once more, after the pass', async () => {
    signedInAs('user-1');
    let release: () => void = () => undefined;
    mockedSync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(SYNCED);
        }),
    );
    render(<TripArchiveSync />);
    await waitFor(() => {
      expect(mockedSync).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      setVisibility('visible');
      setVisibility('visible');
    });
    expect(mockedSync).toHaveBeenCalledTimes(1);

    await act(async () => {
      release();
    });
    await waitFor(() => {
      expect(mockedSync).toHaveBeenCalledTimes(2);
    });
    await settle();
    expect(mockedSync).toHaveBeenCalledTimes(2);
  });

  it('reports a server failure and keeps a lost connection out of error tracking', async () => {
    signedInAs('user-1');
    mockedSync.mockResolvedValueOnce({
      status: 'error',
      message: 'permission denied for table trip_archives',
      reason: 'server',
    });
    render(<TripArchiveSync />);
    await waitFor(() => {
      expect(mockedReportError).toHaveBeenCalledTimes(1);
    });

    mockedSync.mockResolvedValueOnce({
      status: 'error',
      message: 'TypeError: Failed to fetch',
      reason: 'network',
    });
    await act(async () => {
      setVisibility('visible');
    });
    await waitFor(() => {
      expect(mockedSync).toHaveBeenCalledTimes(2);
    });
    await settle();
    expect(mockedReportError).toHaveBeenCalledTimes(1);
  });

  // PostHog issue 01a1e38b: the hosted project had no trip_archives table yet,
  // and every archive change, return to the tab and reconnect reported it.
  it('stops for the session, without reporting, when the server has no archive table', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    signedInAs('user-1');
    mockedSync.mockResolvedValue({
      status: 'error',
      message: "Could not find the table 'public.trip_archives' in the schema cache",
      reason: 'unavailable',
    });
    render(<TripArchiveSync />);
    await waitFor(() => {
      expect(mockedSync).toHaveBeenCalledTimes(1);
    });
    await settle();

    await act(async () => {
      setVisibility('visible');
    });
    await settle();

    expect(mockedSync).toHaveBeenCalledTimes(1);
    expect(mockedReportError).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('survives a client that fails to load', async () => {
    signedInAs('user-1');
    mockedGetClient.mockRejectedValueOnce(new Error('chunk failed'));
    render(<TripArchiveSync />);
    await settle();

    await act(async () => {
      setVisibility('visible');
    });

    await waitFor(() => {
      expect(mockedSync).toHaveBeenCalledWith(CLIENT, 'user-1');
    });
  });
});
