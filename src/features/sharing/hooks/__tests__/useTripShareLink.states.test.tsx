/**
 * @fileoverview Every state `useTripShareLink` can settle in other than success.
 *
 * The sibling file pins the happy path and the identity-churn bug behind it.
 * This one walks the refusals: no backend, no account, a session still
 * resolving, and each way the server can decline between "make the trip remote"
 * and "hand me a token".
 *
 * The auth value lives in a mutable holder rather than a frozen literal so a
 * test can pick the signed-out or unresolved state, but each state keeps one
 * object identity — a fresh object per render restarts the effect forever.
 *
 * @module features/sharing/hooks/__tests__/useTripShareLink.states.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

import { captureEvent } from '@/lib/posthog';
import { getSupabaseClient } from '@/lib/supabase/client';
import { createInvite, listInvites } from '@/lib/sync/invites';
import { ensureRemoteTrip } from '@/lib/sync/remote-trip';
import { uploadTripDocument } from '@/lib/sync/upload-document';
import type { ISODateString, ShareId, Trip, TripId } from '@/types';

import { useTripShareLink } from '../useTripShareLink';

// ============================================================================
// Test doubles
// ============================================================================

const signedIn = { user: { id: 'user-1' }, isAvailable: true, isResolved: true };
const signedOut = { user: null, isAvailable: true, isResolved: true };
const unresolved = { user: null, isAvailable: true, isResolved: false };
const noBackend = { user: null, isAvailable: false, isResolved: true };

let auth: typeof signedIn | typeof signedOut = signedIn;

vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => auth }));

vi.mock('@/lib/posthog', () => ({
  captureEvent: vi.fn(),
  captureUsage: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: vi.fn(async () => ({}) as never),
  isSupabaseConfigured: vi.fn(() => true),
}));

vi.mock('@/lib/sync/remote-trip', () => ({
  ensureRemoteTrip: vi.fn(async () => ({
    status: 'ready' as const,
    remoteTripId: 'remote-1',
  })),
}));

vi.mock('@/lib/sync/upload-document', () => ({
  uploadTripDocument: vi.fn(async () => ({ status: 'ok' as const })),
}));

vi.mock('@/lib/sync/invites', () => ({
  listInvites: vi.fn(async () => []),
  createInvite: vi.fn(async () => ({
    status: 'created' as const,
    invite: { token: 'tokentokent1' },
  })),
  isInviteUsable: vi.fn(() => true),
  inviteOutlastsTrip: vi.fn(() => true),
  inviteExpiryForTrip: vi.fn(() => new Date('2026-07-29T23:59:59.999Z')),
  buildInviteUrl: (origin: string, base: string, token: string) => `${origin}${base}join/${token}`,
}));

const mockedCaptureEvent = vi.mocked(captureEvent);
const mockedGetClient = vi.mocked(getSupabaseClient);
const mockedEnsure = vi.mocked(ensureRemoteTrip);
const mockedUpload = vi.mocked(uploadTripDocument);
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
  vi.clearAllMocks();
  auth = signedIn;
  mockedGetClient.mockResolvedValue({} as never);
  mockedEnsure.mockResolvedValue({ status: 'ready', remoteTripId: 'remote-1' } as never);
  mockedUpload.mockResolvedValue({ status: 'ok' } as never);
  mockedList.mockResolvedValue([] as never);
  mockedCreate.mockResolvedValue({
    status: 'created',
    invite: { token: 'tokentokent1' },
  } as never);
});

// ============================================================================
// Tests
// ============================================================================

describe('useTripShareLink — before anything is asked of the server', () => {
  it('does nothing at all while the dialog is closed', async () => {
    const trip = tripObject();
    const { result } = renderHook(() => useTripShareLink(trip, false));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.state.kind).toBe('loading');
    expect(mockedGetClient).not.toHaveBeenCalled();
    expect(mockedEnsure).not.toHaveBeenCalled();
  });

  it('does nothing when there is no trip to share', async () => {
    const { result } = renderHook(() => useTripShareLink(undefined, true));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.state.kind).toBe('loading');
    expect(mockedEnsure).not.toHaveBeenCalled();
  });

  it('says sharing is unavailable with no backend configured', async () => {
    auth = noBackend;
    const trip = tripObject();
    const { result } = renderHook(() => useTripShareLink(trip, true));

    await waitFor(() => {
      expect(result.current.state.kind).toBe('unavailable');
    });
    expect(mockedCaptureEvent).toHaveBeenCalledWith('trip_share_blocked', {
      reason: 'no-backend',
    });
  });

  it('waits rather than calling the reader signed out while the session resolves', async () => {
    auth = unresolved;
    const trip = tripObject();
    const { result } = renderHook(() => useTripShareLink(trip, true));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.state.kind).toBe('loading');
    expect(mockedEnsure).not.toHaveBeenCalled();
  });

  it('asks a signed-out reader for an account', async () => {
    auth = signedOut;
    const trip = tripObject();
    const { result } = renderHook(() => useTripShareLink(trip, true));

    await waitFor(() => {
      expect(result.current.state.kind).toBe('needs-account');
    });
    expect(mockedCaptureEvent).toHaveBeenCalledWith('trip_share_blocked', {
      reason: 'needs-account',
    });
  });
});

describe('useTripShareLink — the server declines', () => {
  it('says unavailable when the client cannot be built', async () => {
    mockedGetClient.mockResolvedValue(null as never);
    const trip = tripObject();
    const { result } = renderHook(() => useTripShareLink(trip, true));

    await waitFor(() => {
      expect(result.current.state.kind).toBe('unavailable');
    });
    expect(mockedEnsure).not.toHaveBeenCalled();
  });

  it('asks for an account when the server rejects the session', async () => {
    mockedEnsure.mockResolvedValue({ status: 'unauthenticated' } as never);
    const trip = tripObject();
    const { result } = renderHook(() => useTripShareLink(trip, true));

    await waitFor(() => {
      expect(result.current.state.kind).toBe('needs-account');
    });
  });

  it('says the trip is gone from this device when there is nothing to upload', async () => {
    mockedEnsure.mockResolvedValue({ status: 'missing' } as never);
    const trip = tripObject();
    const { result } = renderHook(() => useTripShareLink(trip, true));

    await waitFor(() => {
      expect(result.current.state).toEqual({
        kind: 'error',
        message: 'This trip is no longer on this device.',
      });
    });
  });

  it('passes the server’s own message through when the trip cannot be made remote', async () => {
    mockedEnsure.mockResolvedValue({ status: 'error', message: 'row level security' } as never);
    const trip = tripObject();
    const { result } = renderHook(() => useTripShareLink(trip, true));

    await waitFor(() => {
      expect(result.current.state).toEqual({
        kind: 'error',
        message: 'row level security',
      });
    });
  });

  it('refuses to hand out a link to a trip whose contents failed to upload', async () => {
    mockedUpload.mockResolvedValue({ status: 'error', message: 'upload failed' } as never);
    const trip = tripObject();
    const { result } = renderHook(() => useTripShareLink(trip, true));

    await waitFor(() => {
      expect(result.current.state).toEqual({ kind: 'error', message: 'upload failed' });
    });
    expect(mockedCaptureEvent).toHaveBeenCalledWith('trip_share_blocked', {
      reason: 'upload-failed',
    });
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('reports a link that could not be minted', async () => {
    mockedCreate.mockResolvedValue({ status: 'error', message: 'nope' } as never);
    const trip = tripObject();
    const { result } = renderHook(() => useTripShareLink(trip, true));

    await waitFor(() => {
      expect(result.current.state).toEqual({
        kind: 'error',
        message: 'Could not create a share link.',
      });
    });
  });

  it('reports a thrown Error by its message', async () => {
    mockedEnsure.mockRejectedValue(new Error('the network went away'));
    const trip = tripObject();
    const { result } = renderHook(() => useTripShareLink(trip, true));

    await waitFor(() => {
      expect(result.current.state).toEqual({
        kind: 'error',
        message: 'the network went away',
      });
    });
  });

  it('reports a thrown non-Error by its text', async () => {
    mockedEnsure.mockRejectedValue('just a string');
    const trip = tripObject();
    const { result } = renderHook(() => useTripShareLink(trip, true));

    await waitFor(() => {
      expect(result.current.state).toEqual({ kind: 'error', message: 'just a string' });
    });
  });
});

describe('useTripShareLink — reusing and retrying', () => {
  it('reuses a live invite rather than minting a second one', async () => {
    mockedList.mockResolvedValue([{ token: 'existingtoken' }] as never);
    const trip = tripObject();
    const { result } = renderHook(() => useTripShareLink(trip, true));

    await waitFor(() => {
      expect(result.current.state.kind).toBe('invite');
    });
    expect(result.current.state).toMatchObject({ token: 'existingtoken' });
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockedCaptureEvent).toHaveBeenCalledWith('trip_invite_ready', { reused: true });
  });

  it('runs the whole pipeline again on refresh', async () => {
    const trip = tripObject();
    const { result } = renderHook(() => useTripShareLink(trip, true));

    await waitFor(() => {
      expect(result.current.state.kind).toBe('invite');
    });
    expect(mockedEnsure).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(mockedEnsure).toHaveBeenCalledTimes(2);
    });
  });
});
