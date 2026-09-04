/**
 * @fileoverview Tests for when the account sweep runs, and when it must not.
 *
 * The sweep itself is covered by `account-sync.test`. What is left here is
 * scheduling, and scheduling is where this component can go wrong in ways that
 * cost real money and real data: a sweep per token refresh is a sweep an hour;
 * a sweep per Dexie write is a sweep per keystroke in the trip form; two sweeps
 * at once is one server trip materialised twice on the device.
 *
 * @module lib/sync/__tests__/AccountTripSync.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';

import { useAuth } from '@/features/auth/AuthContext';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { db } from '@/lib/db/database';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { syncAccountTrips } from '@/lib/sync/account-sync';
import { getSupabaseClient } from '@/lib/supabase/client';
import { isoDate } from '@/test/utils';
import { AccountTripSync } from '../AccountTripSync';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('@/features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: vi.fn() }));
vi.mock('@/lib/sync/account-sync', () => ({ syncAccountTrips: vi.fn() }));

const mockedUseAuth = vi.mocked(useAuth);
const mockedOnlineStatus = vi.mocked(useOnlineStatus);
const mockedGetClient = vi.mocked(getSupabaseClient);
const mockedSweep = vi.mocked(syncAccountTrips);

const CLIENT = { from: vi.fn() } as never;

function signedInAs(userId: string): void {
  mockedUseAuth.mockReturnValue({
    // A fresh session object each call, as `AuthProvider` produces on every
    // token refresh — the component must key on the id inside it.
    session: { access_token: `tok-${Math.random()}`, user: { id: userId } },
    user: { id: userId },
    isResolved: true,
    isAvailable: true,
    isSigningIn: false,
  } as never);
}

function signedOut(): void {
  mockedUseAuth.mockReturnValue({
    session: null,
    user: null,
    isResolved: true,
    isAvailable: true,
    isSigningIn: false,
  } as never);
}

/**
 * Lets the live query and the sweep chain settle.
 *
 * Wrapped in `act` because the Dexie live query resolves into React state after
 * the render returns, and the assertions below are all about something *not*
 * happening — which needs the quiet moment after everything that was going to
 * happen has.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function makeLocalTrip(name: string): Promise<void> {
  await createTrip({
    name,
    startDate: isoDate('2026-07-15'),
    endDate: isoDate('2026-07-22'),
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('AccountTripSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedOnlineStatus.mockReturnValue({ isOnline: true, hasRecentlyChanged: false });
    mockedGetClient.mockResolvedValue(CLIENT);
    mockedSweep.mockResolvedValue({ uploaded: 0, downloaded: 0, failed: 0 });
  });

  it('renders nothing', () => {
    signedOut();
    const { container } = render(<AccountTripSync />);

    expect(container).toBeEmptyDOMElement();
  });

  it('sweeps the account once a session appears', async () => {
    signedInAs('user-1');
    render(<AccountTripSync />);

    await waitFor(() => {
      expect(mockedSweep).toHaveBeenCalledWith(CLIENT, 'user-1');
    });
  });

  it('does not sweep while signed out', async () => {
    signedOut();
    render(<AccountTripSync />);

    // Nothing to sync to, and the whole app works this way — the ordinary
    // local-only mode must make no request at all.
    await settle();
    expect(mockedSweep).not.toHaveBeenCalled();
    expect(mockedGetClient).not.toHaveBeenCalled();
  });

  it('does not sweep while offline', async () => {
    signedInAs('user-1');
    mockedOnlineStatus.mockReturnValue({ isOnline: false, hasRecentlyChanged: false });
    render(<AccountTripSync />);

    await settle();
    expect(mockedSweep).not.toHaveBeenCalled();
  });

  it('sweeps again when the network comes back', async () => {
    signedInAs('user-1');
    mockedOnlineStatus.mockReturnValue({ isOnline: false, hasRecentlyChanged: false });
    const { rerender } = render(<AccountTripSync />);

    expect(mockedSweep).not.toHaveBeenCalled();

    mockedOnlineStatus.mockReturnValue({ isOnline: true, hasRecentlyChanged: true });
    rerender(<AccountTripSync />);

    await waitFor(() => {
      expect(mockedSweep).toHaveBeenCalledTimes(1);
    });
  });

  it('does not sweep again on a token refresh', async () => {
    signedInAs('user-1');
    const { rerender } = render(<AccountTripSync />);
    await waitFor(() => {
      expect(mockedSweep).toHaveBeenCalledTimes(1);
    });

    // A new session object for the same account, which is what arrives roughly
    // hourly. Keyed on the object rather than the id, this would be a full
    // sweep of every trip, forever, once an hour.
    signedInAs('user-1');
    rerender(<AccountTripSync />);

    await settle();
    expect(mockedSweep).toHaveBeenCalledTimes(1);
  });

  it('sweeps for the new account when somebody else signs in', async () => {
    signedInAs('user-1');
    const { rerender } = render(<AccountTripSync />);
    await waitFor(() => {
      expect(mockedSweep).toHaveBeenCalledTimes(1);
    });

    signedInAs('user-2');
    rerender(<AccountTripSync />);

    await waitFor(() => {
      expect(mockedSweep).toHaveBeenLastCalledWith(CLIENT, 'user-2');
    });
  });

  it('sweeps again when the same account signs back in', async () => {
    signedInAs('user-1');
    const { rerender } = render(<AccountTripSync />);
    await waitFor(() => {
      expect(mockedSweep).toHaveBeenCalledTimes(1);
    });

    signedOut();
    rerender(<AccountTripSync />);
    await settle();

    // The earlier pass says nothing about what the account holds now — the other
    // device may have added a trip while this one was signed out, and signing
    // back in is exactly when somebody expects to find it.
    signedInAs('user-1');
    rerender(<AccountTripSync />);

    await waitFor(() => {
      expect(mockedSweep).toHaveBeenCalledTimes(2);
    });
  });

  it('sweeps again when a trip is created after signing in', async () => {
    signedInAs('user-1');
    render(<AccountTripSync />);
    await waitFor(() => {
      expect(mockedSweep).toHaveBeenCalledTimes(1);
    });

    // Making a trip *after* signing in is at least as common as the other
    // order, and it must not wait for the next launch to reach the other device.
    await act(async () => {
      await makeLocalTrip('Brittany');
    });

    await waitFor(() => {
      expect(mockedSweep).toHaveBeenCalledTimes(2);
    });
  });

  it('does not sweep again when an already-queued trip lands on the server', async () => {
    await makeLocalTrip('Brittany');
    signedInAs('user-1');
    render(<AccountTripSync />);
    await waitFor(() => {
      expect(mockedSweep).toHaveBeenCalledTimes(1);
    });

    // What a successful upload looks like from Dexie's side. The trip leaves the
    // pending set, which is a change — but it is the change the running sweep
    // was queued to make, so re-queuing on it would mean a pass per trip.
    const trip = (await db.trips.toArray())[0];
    await act(async () => {
      await db.trips.update(trip!.id, { remoteTripId: 'remote-1' });
    });

    await settle();
    expect(mockedSweep).toHaveBeenCalledTimes(1);
  });

  it('runs sweeps one at a time', async () => {
    let running = 0;
    let overlapped = false;
    mockedSweep.mockImplementation(async () => {
      running += 1;
      overlapped ||= running > 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      running -= 1;
      return { uploaded: 0, downloaded: 0, failed: 0 };
    });

    signedInAs('user-1');
    render(<AccountTripSync />);
    await waitFor(() => {
      expect(mockedSweep).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await makeLocalTrip('Brittany');
      await makeLocalTrip('Corsica');
    });

    await waitFor(() => {
      expect(mockedSweep.mock.calls.length).toBeGreaterThan(1);
    });
    await waitFor(() => {
      expect(running).toBe(0);
    });

    // The pull half looks a trip up and then creates it. Two passes interleaved
    // between those two steps would each find nothing and each add a row.
    expect(overlapped).toBe(false);
  });

  it('keeps sweeping after one fails to get a client', async () => {
    // The chain is the only sweep queue in the app, and a rejected promise stays
    // rejected: without the catch, one failure here refuses every sweep for the
    // rest of the session.
    mockedGetClient.mockRejectedValueOnce(new Error('chunk load failed'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    signedInAs('user-1');
    render(<AccountTripSync />);
    await waitFor(() => {
      expect(mockedGetClient).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await makeLocalTrip('Brittany');
    });

    await waitFor(() => {
      expect(mockedSweep).toHaveBeenCalledWith(CLIENT, 'user-1');
    });
  });
});
