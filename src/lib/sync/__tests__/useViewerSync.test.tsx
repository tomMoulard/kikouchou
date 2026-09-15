/**
 * @fileoverview `useViewerSync` — pull-only sync for a trip read through a link.
 *
 * @module lib/sync/__tests__/useViewerSync.test
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { getSupabaseClient } from '@/lib/supabase/client';
import { useViewerSync } from '@/lib/sync/useViewerSync';
import { refreshViewerTrip } from '@/lib/sync/viewer';
import type { TripId } from '@/types';

vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: vi.fn() }));
vi.mock('@/lib/sync/viewer', () => ({ refreshViewerTrip: vi.fn() }));

const mockedGetClient = vi.mocked(getSupabaseClient);
const mockedRefresh = vi.mocked(refreshViewerTrip);

const TRIP_ID = 'trip-1' as TripId;
const TOKEN = 'tokentokentoken1';

beforeEach(() => {
  mockedGetClient.mockReset();
  mockedRefresh.mockReset();
  mockedGetClient.mockResolvedValue({} as never);
});

describe('useViewerSync', () => {
  it('reports a local trip when it is not a viewer trip', () => {
    const doc = new Y.Doc();
    const { result } = renderHook(() =>
      useViewerSync({ doc, tripId: TRIP_ID, viewerToken: null, enabled: false }),
    );

    expect(result.current.state.status).toBe('local');
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it('pulls on mount and reports a current, read-only copy', async () => {
    mockedRefresh.mockResolvedValue({ status: 'current' });
    const doc = new Y.Doc();

    const { result } = renderHook(() =>
      useViewerSync({ doc, tripId: TRIP_ID, viewerToken: TOKEN, enabled: true }),
    );

    // Between mounting and the first answer, the honest state is "syncing".
    expect(result.current.state).toMatchObject({ status: 'syncing', readOnly: true });

    await waitFor(() => {
      expect(result.current.state.status).toBe('synced');
    });
    expect(result.current.state.readOnly).toBe(true);
    expect(mockedRefresh).toHaveBeenCalledWith(expect.anything(), doc, TRIP_ID, TOKEN);
  });

  it('says the copy is not being refreshed when the link is dead', async () => {
    mockedRefresh.mockResolvedValue({ status: 'expired' });
    // Hoisted, as `useTripDoc` hands the hook one document per trip: a fresh
    // document on every render would be a trip switch on every render.
    const doc = new Y.Doc();

    const { result } = renderHook(() =>
      useViewerSync({ doc, tripId: TRIP_ID, viewerToken: TOKEN, enabled: true }),
    );

    // The local copy stays readable; the badge must not claim it is current.
    await waitFor(() => {
      expect(result.current.state).toMatchObject({
        status: 'offline',
        readOnly: true,
        lastError: 'expired',
      });
    });
  });

  it('pulls again when the tab comes back', async () => {
    mockedRefresh.mockResolvedValue({ status: 'current' });
    const doc = new Y.Doc();

    const { result } = renderHook(() =>
      useViewerSync({ doc, tripId: TRIP_ID, viewerToken: TOKEN, enabled: true }),
    );
    await waitFor(() => {
      expect(result.current.state.status).toBe('synced');
    });

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // jsdom reports `visible`, so the event is a return to the tab.
    await waitFor(() => {
      expect(mockedRefresh).toHaveBeenCalledTimes(2);
    });
  });

  it('offers a manual retry', async () => {
    mockedRefresh.mockResolvedValue({ status: 'error', message: 'Failed to fetch' });
    const doc = new Y.Doc();

    const { result } = renderHook(() =>
      useViewerSync({ doc, tripId: TRIP_ID, viewerToken: TOKEN, enabled: true }),
    );
    await waitFor(() => {
      expect(result.current.state.status).toBe('offline');
    });

    mockedRefresh.mockResolvedValue({ status: 'updated' });
    act(() => {
      result.current.syncNow();
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('synced');
    });
  });
});
