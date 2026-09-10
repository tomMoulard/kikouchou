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
import { materialiseViewerTrip } from '@/lib/sync/viewer';
import { useJoinTrip } from '../useJoinTrip';
import type { TripId } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('@/features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: vi.fn() }));
vi.mock('@/lib/sync/invites', () => ({ redeemInvite: vi.fn() }));
vi.mock('@/lib/sync/join-trip', () => ({ materialiseJoinedTrip: vi.fn() }));
vi.mock('@/lib/sync/viewer', () => ({ materialiseViewerTrip: vi.fn() }));
vi.mock('@/lib/posthog', () => ({
  default: { capture: vi.fn() },
  captureUsage: vi.fn(),
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedGetClient = vi.mocked(getSupabaseClient);
const mockedRedeem = vi.mocked(redeemInvite);
const mockedMaterialise = vi.mocked(materialiseJoinedTrip);
const mockedView = vi.mocked(materialiseViewerTrip);

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
  mockedView.mockReset();
  mockedGetClient.mockResolvedValue({} as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// Preconditions
// ============================================================================

describe('useJoinTrip — signed out', () => {
  it('reads the trip through the token instead of asking for an account', async () => {
    signedOut();
    mockedView.mockResolvedValue({ status: 'viewing', tripId: 'local-1' as TripId });

    const { result } = renderHook(() => useJoinTrip(TOKEN));

    // The wall that used to stand here — "Create an account so the others can
    // see your room" — lost three invitees out of four. Reading needs no
    // account; only the first edit does.
    await waitFor(() => {
      expect(result.current.phase).toEqual({ kind: 'viewing', tripId: 'local-1' });
    });
    expect(mockedView).toHaveBeenCalledWith(expect.anything(), TOKEN);
    // And nothing is redeemed: reading is not joining, and burns no use.
    expect(mockedRedeem).not.toHaveBeenCalled();
    expect(mockedMaterialise).not.toHaveBeenCalled();
  });

  it('opens a trip this device already holds as a member', async () => {
    signedOut();
    mockedView.mockResolvedValue({ status: 'member', tripId: 'local-1' as TripId });

    const { result } = renderHook(() => useJoinTrip(TOKEN));

    // Joined earlier with an account, signed out since: the trip is here, so it
    // opens rather than being read a second time as a viewer.
    await waitFor(() => {
      expect(result.current.phase).toEqual({ kind: 'joined', tripId: 'local-1' });
    });
  });

  it.each(['not-found', 'revoked', 'expired', 'exhausted'] as const)(
    'surfaces %s as its own reason for a reader too',
    async (status) => {
      signedOut();
      mockedView.mockResolvedValue({ status });

      const { result } = renderHook(() => useJoinTrip(TOKEN));

      // A dead link is dead for readers as well: the same four reasons, the
      // same copy, whichever door the person came through.
      await waitFor(() => {
        expect(result.current.phase).toEqual({ kind: 'rejected', reason: status });
      });
    },
  );

  it('reports a read failure with its message', async () => {
    signedOut();
    mockedView.mockResolvedValue({ status: 'error', message: 'Failed to fetch' });

    const { result } = renderHook(() => useJoinTrip(TOKEN));

    await waitFor(() => {
      expect(result.current.phase).toEqual({ kind: 'failed', message: 'Failed to fetch' });
    });
  });
});

describe('useJoinTrip — before redeeming', () => {

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

  it('reports a session that lapsed mid-join as a failure to retry', async () => {
    signedIn();
    // The session expired between the page loading and the call. There is no
    // sign-in screen to route back to any more — a signed-out visitor reads the
    // trip instead — so this says what happened and offers the retry.
    mockedRedeem.mockResolvedValue({ status: 'unauthenticated' });

    const { result } = renderHook(() => useJoinTrip(TOKEN));

    await waitFor(() => {
      expect(result.current.phase).toMatchObject({ kind: 'failed' });
    });
    expect(mockedMaterialise).not.toHaveBeenCalled();
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
