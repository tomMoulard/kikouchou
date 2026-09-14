/**
 * @fileoverview Tests for useTripTemplateLink.
 *
 * The property under defence is that the link is stable. An enterprise puts it
 * on its own web page, so a second publish that minted a second token would
 * quietly kill the copy already out in the world. Taking the template down and
 * putting it back has to return the same link.
 *
 * The rest is the shape a publisher screen needs: an account is required and is
 * said so rather than discovered by a failing button, and a publish writes what
 * the trip says now.
 *
 * @module features/sharing/hooks/__tests__/useTripTemplateLink.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useTripTemplateLink } from '../useTripTemplateLink';
import { getRoomsByTripId } from '@/lib/db';
import { captureEvent } from '@/lib/posthog';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { ensureRemoteTrip } from '@/lib/sync/remote-trip';
import { publishTemplate, readTemplateState, unpublishTemplate } from '@/lib/sync/templates';
import type { ISODateString, ShareId, Trip, TripId } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: vi.fn(async () => ({}) as never),
  isSupabaseConfigured: vi.fn(() => true),
}));

/**
 * The session, as the tests set it.
 *
 * One object, mutated in place rather than replaced: the real provider
 * memoises its value, and a fresh object per render would read as a sign-in
 * every time.
 */
const auth: { user: { id: string } | null; isAvailable: boolean; isResolved: boolean } = {
  user: { id: 'user-1' },
  isAvailable: true,
  isResolved: true,
};

vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => auth }));

vi.mock('@/lib/sync/remote-trip', () => ({
  ensureRemoteTrip: vi.fn(async () => ({
    status: 'ready' as const,
    remoteTripId: 'remote-1',
  })),
}));

vi.mock('@/lib/db', () => ({
  getRoomsByTripId: vi.fn(async () => []),
}));

vi.mock('@/lib/posthog', () => ({ captureEvent: vi.fn() }));

vi.mock('@/lib/i18n', () => ({ getCurrentLanguage: () => 'fr' }));

vi.mock('@/lib/sync/templates', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sync/templates')>(
    '@/lib/sync/templates',
  );
  return {
    // The URL builder is the real one: a test that faked it would not notice
    // the hook dropping the share origin or the language.
    buildTemplateUrl: actual.buildTemplateUrl,
    readTemplateState: vi.fn(),
    publishTemplate: vi.fn(),
    unpublishTemplate: vi.fn(),
  };
});

const TRIP: Trip = {
  id: 'trip-1' as TripId,
  name: 'Chalet Marmotte',
  location: 'Chamonix',
  description: 'Check-in after 3pm.',
  currency: 'EUR',
  startDate: '2026-07-15' as ISODateString,
  endDate: '2026-07-22' as ISODateString,
  shareId: 'share-1' as ShareId,
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_SHARE_ORIGIN', 'https://share.kikouchou.app');
  auth.user = { id: 'user-1' };
  auth.isResolved = true;
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
  // `clearAllMocks` clears the calls, not the implementations, so a test that
  // took the client away does not take it away from the next one.
  vi.mocked(getSupabaseClient).mockResolvedValue({} as never);
  vi.mocked(ensureRemoteTrip).mockResolvedValue({ status: 'ready', remoteTripId: 'remote-1' });
  vi.mocked(getRoomsByTripId).mockResolvedValue([]);
  vi.mocked(readTemplateState).mockResolvedValue({
    status: 'ok',
    state: { isTemplate: false, token: null },
  });
  vi.mocked(publishTemplate).mockResolvedValue({
    status: 'published',
    token: 'tokentokentoken1',
  });
  vi.mocked(unpublishTemplate).mockResolvedValue({ status: 'unpublished' });
});

// ============================================================================
// Tests
// ============================================================================

describe('useTripTemplateLink', () => {
  it('stays idle behind a flag that is off', async () => {
    const { result } = renderHook(() => useTripTemplateLink(TRIP, false));

    await waitFor(() => {
      expect(result.current.state.kind).toBe('loading');
    });
    expect(vi.mocked(ensureRemoteTrip)).not.toHaveBeenCalled();
  });

  it('reports a trip that is not published', async () => {
    const { result } = renderHook(() => useTripTemplateLink(TRIP, true));

    await waitFor(() => {
      expect(result.current.state.kind).toBe('unpublished');
    });
  });

  it('builds the preview link for a trip that is published', async () => {
    vi.mocked(readTemplateState).mockResolvedValue({
      status: 'ok',
      state: { isTemplate: true, token: 'tokentokentoken1' },
    });

    const { result } = renderHook(() => useTripTemplateLink(TRIP, true));

    await waitFor(() => {
      expect(result.current.state).toEqual({
        kind: 'published',
        token: 'tokentokentoken1',
        url: 'https://share.kikouchou.app/fr/t/tokentokentoken1',
      });
    });
  });

  it('says a template needs an account rather than offering a button that fails', async () => {
    auth.user = null;

    const { result } = renderHook(() => useTripTemplateLink(TRIP, true));

    await waitFor(() => {
      expect(result.current.state.kind).toBe('needs-account');
    });
    expect(vi.mocked(ensureRemoteTrip)).not.toHaveBeenCalled();
  });

  it('waits rather than guessing while the session is still resolving', async () => {
    auth.isResolved = false;

    const { result } = renderHook(() => useTripTemplateLink(TRIP, true));

    await waitFor(() => {
      expect(result.current.state.kind).toBe('loading');
    });
    expect(vi.mocked(ensureRemoteTrip)).not.toHaveBeenCalled();
  });

  it('reads a trip the server does not have yet as not published', async () => {
    vi.mocked(ensureRemoteTrip).mockResolvedValue({ status: 'missing' });

    const { result } = renderHook(() => useTripTemplateLink(TRIP, true));

    await waitFor(() => {
      expect(result.current.state.kind).toBe('unpublished');
    });
  });

  it('does nothing at all without a trip', async () => {
    const { result } = renderHook(() => useTripTemplateLink(undefined, true));

    await act(async () => {
      await result.current.publish();
      await result.current.unpublish();
    });

    expect(vi.mocked(publishTemplate)).not.toHaveBeenCalled();
    expect(vi.mocked(unpublishTemplate)).not.toHaveBeenCalled();
  });

  it('says so when this build has no server', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);

    const { result } = renderHook(() => useTripTemplateLink(TRIP, true));

    await waitFor(() => {
      expect(result.current.state.kind).toBe('unavailable');
    });
  });

  it('reports a failed read', async () => {
    vi.mocked(readTemplateState).mockResolvedValue({ status: 'error', message: 'rls' });

    const { result } = renderHook(() => useTripTemplateLink(TRIP, true));

    await waitFor(() => {
      expect(result.current.state).toEqual({ kind: 'error', message: 'rls' });
    });
  });

  it('publishes what the trip says now, rooms included', async () => {
    vi.mocked(getRoomsByTripId).mockResolvedValue([
      { id: 'r1', tripId: TRIP.id, name: 'Attic', capacity: 4, order: 0, icon: 'bunk-bed' },
    ] as never);

    const { result } = renderHook(() => useTripTemplateLink(TRIP, true));
    await waitFor(() => {
      expect(result.current.state.kind).toBe('unpublished');
    });

    await act(async () => {
      await result.current.publish();
    });

    expect(vi.mocked(publishTemplate)).toHaveBeenCalledWith(
      {},
      'remote-1',
      {
        name: 'Chalet Marmotte',
        description: 'Check-in after 3pm.',
        location: 'Chamonix',
        coordinates: null,
        currency: 'EUR',
        rooms: [{ name: 'Attic', capacity: 4, icon: 'bunk-bed' }],
      },
      null,
    );
    await waitFor(() => {
      expect(result.current.state.kind).toBe('published');
    });
  });

  it('republishes under the token the trip already has', async () => {
    vi.mocked(readTemplateState).mockResolvedValue({
      status: 'ok',
      state: { isTemplate: true, token: 'alreadyhanded001' },
    });
    vi.mocked(publishTemplate).mockResolvedValue({
      status: 'published',
      token: 'alreadyhanded001',
    });

    const { result } = renderHook(() => useTripTemplateLink(TRIP, true));
    await waitFor(() => {
      expect(result.current.state.kind).toBe('published');
    });

    await act(async () => {
      await result.current.publish();
    });

    expect(vi.mocked(publishTemplate)).toHaveBeenCalledWith(
      {},
      'remote-1',
      expect.anything(),
      'alreadyhanded001',
    );
    expect(vi.mocked(captureEvent)).toHaveBeenCalledWith(
      'trip_template_published',
      expect.objectContaining({ republished: true }),
    );
  });

  it('reports a publish the server refused', async () => {
    vi.mocked(publishTemplate).mockResolvedValue({ status: 'error', message: 'denied' });

    const { result } = renderHook(() => useTripTemplateLink(TRIP, true));
    await waitFor(() => {
      expect(result.current.state.kind).toBe('unpublished');
    });

    await act(async () => {
      await result.current.publish();
    });

    expect(result.current.state).toEqual({ kind: 'error', message: 'denied' });
    expect(vi.mocked(captureEvent)).toHaveBeenCalledWith('trip_template_publish_failed', {
      reason: 'write',
    });
  });

  it('reports a trip that never reached the server', async () => {
    vi.mocked(ensureRemoteTrip).mockResolvedValue({ status: 'error', message: 'offline' });

    const { result } = renderHook(() => useTripTemplateLink(TRIP, true));
    await waitFor(() => {
      expect(result.current.state.kind).toBe('error');
    });

    await act(async () => {
      await result.current.publish();
    });

    expect(result.current.state).toEqual({ kind: 'error', message: 'offline' });
  });

  it('takes a template down', async () => {
    vi.mocked(readTemplateState).mockResolvedValue({
      status: 'ok',
      state: { isTemplate: true, token: 'tokentokentoken1' },
    });

    const { result } = renderHook(() => useTripTemplateLink(TRIP, true));
    await waitFor(() => {
      expect(result.current.state.kind).toBe('published');
    });

    await act(async () => {
      await result.current.unpublish();
    });

    expect(result.current.state.kind).toBe('unpublished');
    expect(vi.mocked(captureEvent)).toHaveBeenCalledWith('trip_template_unpublished');
  });

  it('reports a take-down the server refused', async () => {
    vi.mocked(readTemplateState).mockResolvedValue({
      status: 'ok',
      state: { isTemplate: true, token: 'tokentokentoken1' },
    });
    vi.mocked(unpublishTemplate).mockResolvedValue({ status: 'error', message: 'rls' });

    const { result } = renderHook(() => useTripTemplateLink(TRIP, true));
    await waitFor(() => {
      expect(result.current.state.kind).toBe('published');
    });

    await act(async () => {
      await result.current.unpublish();
    });

    expect(result.current.state).toEqual({ kind: 'error', message: 'rls' });
  });

  it('survives a take-down that throws', async () => {
    vi.mocked(readTemplateState).mockResolvedValue({
      status: 'ok',
      state: { isTemplate: true, token: 'tokentokentoken1' },
    });
    vi.mocked(unpublishTemplate).mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { result } = renderHook(() => useTripTemplateLink(TRIP, true));
    await waitFor(() => {
      expect(result.current.state.kind).toBe('published');
    });

    await act(async () => {
      await result.current.unpublish();
    });

    expect(result.current.state).toEqual({ kind: 'error', message: 'boom' });
    expect(result.current.isBusy).toBe(false);
  });

  it('does nothing when the take-down finds no server row', async () => {
    vi.mocked(readTemplateState).mockResolvedValue({
      status: 'ok',
      state: { isTemplate: true, token: 'tokentokentoken1' },
    });

    const { result } = renderHook(() => useTripTemplateLink(TRIP, true));
    await waitFor(() => {
      expect(result.current.state.kind).toBe('published');
    });

    vi.mocked(ensureRemoteTrip).mockResolvedValue({ status: 'missing' });
    await act(async () => {
      await result.current.unpublish();
    });

    expect(vi.mocked(unpublishTemplate)).not.toHaveBeenCalled();
  });

  it('reports a build whose client disappeared under it', async () => {
    const { result } = renderHook(() => useTripTemplateLink(TRIP, true));
    await waitFor(() => {
      expect(result.current.state.kind).toBe('unpublished');
    });

    vi.mocked(getSupabaseClient).mockResolvedValue(null);
    await act(async () => {
      await result.current.publish();
    });
    expect(result.current.state.kind).toBe('unavailable');

    await act(async () => {
      await result.current.unpublish();
    });
    expect(result.current.state.kind).toBe('unavailable');
    expect(vi.mocked(publishTemplate)).not.toHaveBeenCalled();
  });

  it('survives a publish that throws', async () => {
    vi.mocked(publishTemplate).mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { result } = renderHook(() => useTripTemplateLink(TRIP, true));
    await waitFor(() => {
      expect(result.current.state.kind).toBe('unpublished');
    });

    await act(async () => {
      await result.current.publish();
    });

    expect(result.current.state).toEqual({ kind: 'error', message: 'boom' });
    expect(result.current.isBusy).toBe(false);
  });
});
