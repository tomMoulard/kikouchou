/**
 * useJoinTrip tests.
 *
 * The sequence has more failure modes than happy paths, and each one reaches a
 * different screen: a signed-out visitor, four ways an invite can be unusable,
 * and a network failure that should offer a retry rather than a dead end.
 *
 * @module features/sharing/hooks/__tests__/useJoinTrip.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { useAuth } from '@/features/auth/AuthContext';
import { getSupabaseClient } from '@/lib/supabase/client';
import { redeemInvite } from '@/lib/sync/invites';
import { materialiseJoinedTrip } from '@/lib/sync/join-trip';
import { useJoinTrip } from '../useJoinTrip';
import type { TripId } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('@/features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: vi.fn() }));
vi.mock('@/lib/sync/invites', () => ({ redeemInvite: vi.fn() }));
vi.mock('@/lib/sync/join-trip', () => ({ materialiseJoinedTrip: vi.fn() }));

const mockedUseAuth = vi.mocked(useAuth);
const mockedGetClient = vi.mocked(getSupabaseClient);
const mockedRedeem = vi.mocked(redeemInvite);
const mockedMaterialise = vi.mocked(materialiseJoinedTrip);

const TOKEN = 'aBcDeFgHiJkL3456';
const REMOTE_TRIP_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

function signedIn(): void {
  mockedUseAuth.mockReturnValue({
    session: { access_token: 'tok' },
    user: { id: 'user-1' },
    isResolved: true,
    isAvailable: true,
    isSigningIn: false,
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
  } as never);
}

function signedOut(): void {
  mockedUseAuth.mockReturnValue({
    session: null,
    user: null,
    isResolved: true,
    isAvailable: true,
    isSigningIn: false,
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
  } as never);
}

function unresolved(): void {
  mockedUseAuth.mockReturnValue({
    session: null,
    user: null,
    isResolved: false,
    isAvailable: true,
    isSigningIn: false,
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
  } as never);
}

beforeEach(() => {
  mockedUseAuth.mockReset();
  mockedGetClient.mockReset();
  mockedRedeem.mockReset();
  mockedMaterialise.mockReset();
  mockedGetClient.mockResolvedValue({} as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// Preconditions
// ============================================================================

describe('useJoinTrip — before redeeming', () => {
  it('asks for an account when signed out', async () => {
    signedOut();

    const { result } = renderHook(() => useJoinTrip(TOKEN));

    await waitFor(() => {
      expect(result.current.phase).toEqual({ kind: 'needs-account' });
    });
    // And does not burn a use on the invite before there is an account to join.
    expect(mockedRedeem).not.toHaveBeenCalled();
  });

  it('waits rather than concluding while the session is unresolved', () => {
    unresolved();

    const { result } = renderHook(() => useJoinTrip(TOKEN));

    // Acting on the not-yet-resolved null would flash "sign in" at somebody who
    // is already signed in.
    expect(result.current.phase).toEqual({ kind: 'joining' });
    expect(mockedRedeem).not.toHaveBeenCalled();
  });

  it('rejects a route with no token', async () => {
    signedIn();

    const { result } = renderHook(() => useJoinTrip(null));

    await waitFor(() => {
      expect(result.current.phase).toEqual({ kind: 'rejected', reason: 'not-found' });
    });
  });
});

// ============================================================================
// Success
// ============================================================================

describe('useJoinTrip — joining', () => {
  it('redeems then materialises the local trip', async () => {
    signedIn();
    mockedRedeem.mockResolvedValue({ status: 'joined', remoteTripId: REMOTE_TRIP_ID });
    mockedMaterialise.mockResolvedValue({
      status: 'joined',
      tripId: 'local-1' as TripId,
    });

    const { result } = renderHook(() => useJoinTrip(TOKEN));

    await waitFor(() => {
      expect(result.current.phase).toEqual({ kind: 'joined', tripId: 'local-1' });
    });
    expect(mockedRedeem).toHaveBeenCalledWith(expect.anything(), TOKEN);
    expect(mockedMaterialise).toHaveBeenCalledWith(expect.anything(), REMOTE_TRIP_ID);
  });

  it('treats an already-local trip as joined', async () => {
    signedIn();
    mockedRedeem.mockResolvedValue({ status: 'joined', remoteTripId: REMOTE_TRIP_ID });
    mockedMaterialise.mockResolvedValue({
      status: 'already-local',
      tripId: 'local-1' as TripId,
    });

    const { result } = renderHook(() => useJoinTrip(TOKEN));

    // Opening the same link twice must land on the trip, not on an error.
    await waitFor(() => {
      expect(result.current.phase).toEqual({ kind: 'joined', tripId: 'local-1' });
    });
  });
});

// ============================================================================
// Rejections
// ============================================================================

describe('useJoinTrip — unusable invites', () => {
  it.each(['not-found', 'revoked', 'expired', 'exhausted'] as const)(
    'surfaces %s as its own reason',
    async (status) => {
      signedIn();
      mockedRedeem.mockResolvedValue({ status } as never);

      const { result } = renderHook(() => useJoinTrip(TOKEN));

      // Each reason gets different copy: "expired" and "withdrawn" call for
      // different responses from the person holding the link.
      await waitFor(() => {
        expect(result.current.phase).toEqual({ kind: 'rejected', reason: status });
      });
      expect(mockedMaterialise).not.toHaveBeenCalled();
    },
  );

  it('routes an unauthenticated RPC back to the sign-in screen', async () => {
    signedIn();
    // The session expired between the page loading and the call.
    mockedRedeem.mockResolvedValue({ status: 'unauthenticated' });

    const { result } = renderHook(() => useJoinTrip(TOKEN));

    await waitFor(() => {
      expect(result.current.phase).toEqual({ kind: 'needs-account' });
    });
  });
});

// ============================================================================
// Failures
// ============================================================================

describe('useJoinTrip — failures', () => {
  it('reports a redeem error with its message', async () => {
    signedIn();
    mockedRedeem.mockResolvedValue({ status: 'error', message: 'Failed to fetch' });

    const { result } = renderHook(() => useJoinTrip(TOKEN));

    await waitFor(() => {
      expect(result.current.phase).toEqual({
        kind: 'failed',
        message: 'Failed to fetch',
      });
    });
  });

  it('reports a failure to create the local trip', async () => {
    signedIn();
    mockedRedeem.mockResolvedValue({ status: 'joined', remoteTripId: REMOTE_TRIP_ID });
    mockedMaterialise.mockResolvedValue({ status: 'error', message: 'quota exceeded' });

    const { result } = renderHook(() => useJoinTrip(TOKEN));

    await waitFor(() => {
      expect(result.current.phase).toEqual({
        kind: 'failed',
        message: 'quota exceeded',
      });
    });
  });

  it('explains a build with no backend rather than hanging', async () => {
    signedIn();
    mockedGetClient.mockResolvedValue(null);

    const { result } = renderHook(() => useJoinTrip(TOKEN));

    await waitFor(() => {
      expect(result.current.phase).toMatchObject({ kind: 'failed' });
    });
  });

  it('retries from the beginning', async () => {
    signedIn();
    mockedRedeem.mockResolvedValue({ status: 'error', message: 'Failed to fetch' });

    const { result } = renderHook(() => useJoinTrip(TOKEN));
    await waitFor(() => {
      expect(result.current.phase).toMatchObject({ kind: 'failed' });
    });

    mockedRedeem.mockResolvedValue({ status: 'joined', remoteTripId: REMOTE_TRIP_ID });
    mockedMaterialise.mockResolvedValue({
      status: 'joined',
      tripId: 'local-1' as TripId,
    });
    result.current.retry();

    await waitFor(() => {
      expect(result.current.phase).toEqual({ kind: 'joined', tripId: 'local-1' });
    });
  });
});
