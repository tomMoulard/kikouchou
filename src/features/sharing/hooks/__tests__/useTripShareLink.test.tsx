/**
 * @fileoverview Tests for useTripShareLink.
 *
 * The property under defence is that resolving a share link settles and stays
 * settled. The trip it is given comes from a Dexie live query, and the sync
 * provider writes to the `trips` table whenever a remote update arrives — so the
 * object identity changes for reasons that have nothing to do with which trip is
 * being shared. An effect keyed on that identity restarts, and every restart
 * puts the dialog back to `loading`: a spinner that never finishes while sync is
 * doing its job.
 *
 * @module features/sharing/hooks/__tests__/useTripShareLink.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { useTripShareLink } from '../useTripShareLink';
import { ensureRemoteTrip } from '@/lib/sync/remote-trip';
import { createInvite, listInvites } from '@/lib/sync/invites';
import type { ISODateString, ShareId, Trip, TripId } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: vi.fn(async () => ({}) as never),
  isSupabaseConfigured: vi.fn(() => true),
}));

vi.mock('@/features/auth/AuthContext', () => {
  // Stable identities, because the real `AuthProvider` memoises its value. A
  // fresh object per call would make every render look like a sign-in.
  const auth = {
    user: { id: 'user-1' },
    isAvailable: true,
    isResolved: true,
  };
  return { useAuth: () => auth };
});

vi.mock('@/lib/sync/remote-trip', () => ({
  ensureRemoteTrip: vi.fn(async () => ({
    status: 'ready' as const,
    remoteTripId: 'remote-1',
  })),
}));

vi.mock('@/lib/sync/invites', () => ({
  listInvites: vi.fn(async () => []),
  createInvite: vi.fn(async () => ({
    status: 'created' as const,
    invite: { token: 'tokentokent1' },
  })),
  isInviteUsable: vi.fn(() => true),
  buildInviteUrl: (origin: string, base: string, token: string) =>
    `${origin}${base}join/${token}`,
}));

const mockedEnsure = vi.mocked(ensureRemoteTrip);
const mockedList = vi.mocked(listInvites);
const mockedCreate = vi.mocked(createInvite);

/** A fresh object every call, as a live query hands back. */
function tripObject(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1' as TripId,
    name: 'Brittany',
    shareId: 'share-1234' as ShareId,
    startDate: '2026-07-15' as ISODateString,
    endDate: '2026-07-22' as ISODateString,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  mockedEnsure.mockClear();
  mockedList.mockClear();
  mockedCreate.mockClear();
});

// ============================================================================
// Tests
// ============================================================================

describe('useTripShareLink', () => {
  it('resolves an invite link', async () => {
    // Hoisted deliberately. Passing `tripObject()` inline gives the hook a new
    // object on every render, which is not a contrived setup — it is what a
    // live query does — and with the effect keyed on the object it spins until
    // the worker runs out of memory. That is the bug; the tests below pin it
    // without taking the suite down.
    const trip = tripObject();
    const { result } = renderHook(() => useTripShareLink(trip, true));

    await waitFor(() => {
      expect(result.current.state.kind).toBe('invite');
    });
    expect(result.current.state).toMatchObject({ token: 'tokentokent1' });
  });

  it('stays settled when the trip object identity changes', async () => {
    const { result, rerender } = renderHook(
      ({ trip }: { trip: Trip }) => useTripShareLink(trip, true),
      { initialProps: { trip: tripObject() } },
    );

    await waitFor(() => {
      expect(result.current.state.kind).toBe('invite');
    });

    // What a Dexie live query does after the sync provider projects a remote
    // update: same trip, different object, and a bumped `updatedAt`.
    rerender({ trip: tripObject({ updatedAt: 2 }) });
    rerender({ trip: tripObject({ updatedAt: 3 }) });

    // Re-entering `loading` here is the bug: the dialog shows a spinner again,
    // and while updates keep arriving it never stops.
    expect(result.current.state.kind).toBe('invite');
  });

  it('does not re-run the server work for the same trip', async () => {
    const { result, rerender } = renderHook(
      ({ trip }: { trip: Trip }) => useTripShareLink(trip, true),
      { initialProps: { trip: tripObject() } },
    );

    await waitFor(() => {
      expect(result.current.state.kind).toBe('invite');
    });
    const callsAfterFirstResolve = mockedEnsure.mock.calls.length;

    rerender({ trip: tripObject({ updatedAt: 2 }) });
    rerender({ trip: tripObject({ updatedAt: 3 }) });
    await waitFor(() => {
      expect(result.current.state.kind).toBe('invite');
    });

    // Each restart is a round trip to the server, and `listInvites` plus a mint
    // per re-render is how a trip ends up littered with links.
    expect(mockedEnsure.mock.calls.length).toBe(callsAfterFirstResolve);
  });

  it('does re-run when a different trip is shared', async () => {
    const { result, rerender } = renderHook(
      ({ trip }: { trip: Trip }) => useTripShareLink(trip, true),
      { initialProps: { trip: tripObject() } },
    );

    await waitFor(() => {
      expect(result.current.state.kind).toBe('invite');
    });
    mockedEnsure.mockClear();

    rerender({ trip: tripObject({ id: 'trip-2' as TripId }) });

    await waitFor(() => {
      expect(mockedEnsure).toHaveBeenCalledWith(
        expect.anything(),
        'user-1',
        'trip-2',
      );
    });
  });
});
