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
import type { ShareId, Trip, TripId, UnixTimestamp } from '@/types';
import { AccountTripSync } from '../AccountTripSync';

// ============================================================================
// Test doubles
// ============================================================================

const mockedCapture = vi.hoisted(() => vi.fn());

vi.mock('@/lib/posthog', () => ({
  captureEvent: (...args: unknown[]) => mockedCapture(...args),
  reportError: vi.fn(),
  default: undefined,
}));
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
    mockedSweep.mockResolvedValue({ uploaded: 0, downloaded: 0, upgraded: 0, failed: 0 });
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
      return { uploaded: 0, downloaded: 0, upgraded: 0, failed: 0 };
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

// ============================================================================
// Edges the mutation run found unpinned
// ============================================================================

/** A local trip under an id the test chooses, so the pending key is known. */
async function addTrip(id: string, fields: Partial<Trip> = {}): Promise<void> {
  const now = Date.now() as UnixTimestamp;
  await db.trips.add({
    id: id as TripId,
    name: id,
    startDate: isoDate('2026-07-15'),
    endDate: isoDate('2026-07-22'),
    shareId: `share-${id}` as ShareId,
    createdAt: now,
    updatedAt: now,
    ...fields,
  });
}

describe('AccountTripSync, edges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedOnlineStatus.mockReturnValue({ isOnline: true, hasRecentlyChanged: false });
    mockedGetClient.mockResolvedValue(CLIENT);
    mockedSweep.mockResolvedValue({ uploaded: 0, downloaded: 0, upgraded: 0, failed: 0 });
  });

  it('does not sweep while signed out, even with trips waiting', async () => {
    await addTrip('local-1');
    signedOut();
    render(<AccountTripSync />);

    await settle();
    expect(mockedGetClient).not.toHaveBeenCalled();
    expect(mockedSweep).not.toHaveBeenCalled();
  });

  it('does not sweep again when one queued trip lands and another is still waiting', async () => {
    await addTrip('trip-x');
    await addTrip('trip-y');
    signedInAs('user-1');
    render(<AccountTripSync />);
    await waitFor(() => {
      expect(mockedSweep).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await db.trips.update('trip-x', { remoteTripId: 'remote-x' });
    });

    await settle();
    expect(mockedSweep).toHaveBeenCalledTimes(1);
  });

  it('sweeps for a trip whose id is new, whatever characters it shares with the others', async () => {
    await addTrip('ab');
    await addTrip('ba');
    signedInAs('user-1');
    render(<AccountTripSync />);
    await waitFor(() => {
      expect(mockedSweep).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await addTrip('aab');
    });

    await waitFor(() => {
      expect(mockedSweep).toHaveBeenCalledTimes(2);
    });
  });

  it('does not sweep again for a member trip that arrives already on the server', async () => {
    signedInAs('user-1');
    render(<AccountTripSync />);
    await waitFor(() => {
      expect(mockedSweep).toHaveBeenCalledTimes(1);
    });

    // What the pull half writes: a trip with a server row and nothing to do.
    await act(async () => {
      await addTrip('joined-1', { remoteTripId: 'remote-j' });
    });

    await settle();
    expect(mockedSweep).toHaveBeenCalledTimes(1);
  });

  it('counts a viewer trip as waiting, so a new one pulls the sweep back', async () => {
    signedInAs('user-1');
    render(<AccountTripSync />);
    await waitFor(() => {
      expect(mockedSweep).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await addTrip('viewer-1', { remoteTripId: 'remote-v', viewerToken: 'tok1234567890abc' });
    });

    await waitFor(() => {
      expect(mockedSweep).toHaveBeenCalledTimes(2);
    });
  });

  it('forgets what the last account queued once another account is swept', async () => {
    await addTrip('trip-x');
    signedInAs('user-1');
    const { rerender } = render(<AccountTripSync />);
    await waitFor(() => {
      expect(mockedSweep).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await db.trips.update('trip-x', { remoteTripId: 'remote-x' });
    });
    // The live query re-emits after the write settles, not inside it. Switching
    // accounts before that leaves the second sweep queued with trip-x still
    // pending, which is a different test from the one below.
    await settle();

    signedInAs('user-2');
    rerender(<AccountTripSync />);
    await waitFor(() => {
      expect(mockedSweep).toHaveBeenCalledTimes(2);
    });

    // The trip comes back as waiting. Queued under the other account, it was
    // never part of this account's sweep.
    await act(async () => {
      await db.trips.update('trip-x', { remoteTripId: undefined });
    });

    await waitFor(() => {
      expect(mockedSweep).toHaveBeenCalledTimes(3);
    });
  });

  it('keeps what this account queued when a new trip pulls the sweep back', async () => {
    await addTrip('trip-x');
    signedInAs('user-1');
    render(<AccountTripSync />);
    await waitFor(() => {
      expect(mockedSweep).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await db.trips.update('trip-x', { remoteTripId: 'remote-x' });
    });
    await act(async () => {
      await addTrip('trip-y');
    });
    await waitFor(() => {
      expect(mockedSweep).toHaveBeenCalledTimes(2);
    });

    // Already handed to a sweep for this account: waiting again is not new work.
    await act(async () => {
      await db.trips.update('trip-x', { remoteTripId: undefined });
    });

    await settle();
    expect(mockedSweep).toHaveBeenCalledTimes(2);
  });

  it('sweeps nothing with no backend', async () => {
    mockedGetClient.mockResolvedValue(null as never);
    signedInAs('user-1');
    render(<AccountTripSync />);

    await waitFor(() => {
      expect(mockedGetClient).toHaveBeenCalled();
    });
    await settle();
    expect(mockedSweep).not.toHaveBeenCalled();
  });

  it('reports nothing for a sweep that moved nothing', async () => {
    signedInAs('user-1');
    render(<AccountTripSync />);

    await waitFor(() => {
      expect(mockedSweep).toHaveBeenCalledTimes(1);
    });
    await settle();
    expect(mockedCapture).not.toHaveBeenCalled();
  });

  it.each([
    ['uploaded', { uploaded: 2, downloaded: 0, upgraded: 0, failed: 0 }],
    ['downloaded', { uploaded: 0, downloaded: 3, upgraded: 0, failed: 0 }],
    ['upgraded', { uploaded: 0, downloaded: 0, upgraded: 1, failed: 0 }],
    ['failed', { uploaded: 0, downloaded: 0, upgraded: 0, failed: 4 }],
  ])('reports a sweep that %s something, with every count', async (_label, result) => {
    mockedSweep.mockResolvedValue(result);
    signedInAs('user-1');
    render(<AccountTripSync />);

    await waitFor(() => {
      expect(mockedCapture).toHaveBeenCalledWith('account_trip_sync', result);
    });
  });

  it.each([
    ['an Error', new Error('chunk load failed'), 'chunk load failed'],
    ['a plain value', 'offline', 'offline'],
  ])('warns with the reason when loading the client throws %s', async (_label, thrown, text) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockedGetClient.mockRejectedValueOnce(thrown);
    signedInAs('user-1');
    render(<AccountTripSync />);

    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith('[sync] could not run the account sweep:', text);
    });
  });
});
