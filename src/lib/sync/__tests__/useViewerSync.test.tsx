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

// ============================================================================
// Edges the mutation run found unpinned
// ============================================================================

interface ViewerProps {
  readonly doc: Y.Doc;
  readonly tripId: TripId;
  readonly viewerToken: string | null;
  readonly enabled: boolean;
}

function renderViewer(initial: Partial<ViewerProps> = {}) {
  const doc = initial.doc ?? new Y.Doc();
  return renderHook((props: ViewerProps) => useViewerSync(props), {
    initialProps: { doc, tripId: TRIP_ID, viewerToken: TOKEN, enabled: true, ...initial },
  });
}

/** A refresh that answers only when told to. */
function deferredRefresh() {
  let release: (value: { status: 'current' }) => void = () => {};
  mockedRefresh.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve as typeof release;
      }) as never,
  );
  return { release: () => release({ status: 'current' }) };
}

describe('useViewerSync, edges', () => {
  it('stays local, and pulls nothing, without a token even when enabled', async () => {
    const { result } = renderViewer({ viewerToken: null });

    expect(result.current.state.status).toBe('local');
    act(() => {
      result.current.syncNow();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it.each([
    ['no document yet', { doc: null }],
    ['no trip', { tripId: null }],
  ])('stays local, and pulls nothing, with %s', async (_label, missing) => {
    const { result } = renderHook(() =>
      useViewerSync({
        doc: new Y.Doc(),
        tripId: TRIP_ID,
        viewerToken: TOKEN,
        enabled: true,
        ...missing,
      }),
    );

    expect(result.current.state.status).toBe('local');
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it('pulls nothing on a manual retry for a member trip', async () => {
    const { result } = renderViewer({ enabled: false });

    act(() => {
      result.current.syncNow();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockedGetClient).not.toHaveBeenCalled();
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it('reads as local again once the trip is no longer a viewer trip', async () => {
    mockedRefresh.mockResolvedValue({ status: 'current' });
    const { result, rerender } = renderViewer();
    await waitFor(() => {
      expect(result.current.state.status).toBe('synced');
    });

    rerender({ doc: new Y.Doc(), tripId: TRIP_ID, viewerToken: TOKEN, enabled: false });

    expect(result.current.state.status).toBe('local');
  });

  it('reports a build with no backend as offline, and says why', async () => {
    mockedGetClient.mockResolvedValue(null as never);

    const { result } = renderViewer();

    await waitFor(() => {
      expect(result.current.state).toMatchObject({
        status: 'offline',
        readOnly: true,
        lastError: 'no backend',
      });
    });
  });

  it('reports the message of a failed refresh', async () => {
    mockedRefresh.mockResolvedValue({ status: 'error', message: 'Failed to fetch' });

    const { result } = renderViewer();

    await waitFor(() => {
      expect(result.current.state).toMatchObject({
        status: 'offline',
        lastError: 'Failed to fetch',
      });
    });
  });

  it('does not start a second refresh while one is running', async () => {
    const pending = deferredRefresh();
    const { result } = renderViewer();
    await waitFor(() => {
      expect(mockedRefresh).toHaveBeenCalledTimes(1);
    });

    act(() => {
      result.current.syncNow();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockedRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.release();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.state.status).toBe('synced');
    });
    act(() => {
      result.current.syncNow();
    });
    await waitFor(() => {
      expect(mockedRefresh).toHaveBeenCalledTimes(2);
    });
  });

  it('pulls the new trip, and shows nothing of the old one, after a switch', async () => {
    mockedRefresh.mockResolvedValue({ status: 'current' });
    const doc = new Y.Doc();
    const { result, rerender } = renderViewer({ doc });
    await waitFor(() => {
      expect(result.current.state.status).toBe('synced');
    });

    deferredRefresh();
    const next = new Y.Doc();
    rerender({ doc: next, tripId: 'trip-2' as TripId, viewerToken: TOKEN, enabled: true });

    expect(result.current.state.status).toBe('syncing');
    await waitFor(() => {
      expect(mockedRefresh).toHaveBeenLastCalledWith(expect.anything(), next, 'trip-2', TOKEN);
    });
  });

  it('does not pull when the tab goes to the background', async () => {
    mockedRefresh.mockResolvedValue({ status: 'current' });
    const { result } = renderViewer();
    await waitFor(() => {
      expect(result.current.state.status).toBe('synced');
    });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockedRefresh).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });

  it('pulls again when the network comes back', async () => {
    mockedRefresh.mockResolvedValue({ status: 'current' });
    const { result } = renderViewer();
    await waitFor(() => {
      expect(result.current.state.status).toBe('synced');
    });

    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() => {
      expect(mockedRefresh).toHaveBeenCalledTimes(2);
    });
  });

  it('stops pulling once unmounted', async () => {
    mockedRefresh.mockResolvedValue({ status: 'current' });
    const { result, unmount } = renderViewer();
    await waitFor(() => {
      expect(result.current.state.status).toBe('synced');
    });

    unmount();
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    await Promise.resolve();
    await Promise.resolve();

    expect(mockedRefresh).toHaveBeenCalledTimes(1);
  });
});
