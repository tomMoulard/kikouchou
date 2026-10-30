/**
 * @fileoverview Tests for SupabaseTripSync, the component that wires a trip's
 * document to the sync hooks.
 *
 * The hooks it composes have their own tests. What is left here is the wiring:
 * which hook a trip is handed to (a viewer trip never reaches the two-way
 * provider), when the server's preview is republished, what the template copy
 * is told about the connection, and which status transitions are reported.
 *
 * @module lib/sync/__tests__/SupabaseTripSync.test
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import type { SyncState } from '@/lib/sync/SupabaseYjsProvider';
import type { Trip, TripId } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  getClient: vi.fn(),
  syncPreview: vi.fn(),
  useTripSync: vi.fn(),
  useViewerSync: vi.fn(),
  useTemplateRefresh: vi.fn(),
  auth: { session: null as { user: { id: string } } | null },
  trip: { currentTrip: null as Trip | null },
  yjs: { value: null as { loaded: boolean; doc: Y.Doc } | null },
}));

vi.mock('@/lib/posthog', () => ({
  captureEvent: (...args: unknown[]) => mocks.capture(...args),
  reportError: vi.fn(),
  default: undefined,
}));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => mocks.getClient() }));
vi.mock('@/lib/sync/remote-trip', () => ({
  syncRemoteTripMetadata: (...args: unknown[]) => mocks.syncPreview(...args),
}));
vi.mock('@/lib/sync/useTripSync', () => ({
  useTripSync: (options: unknown) => mocks.useTripSync(options),
}));
vi.mock('@/lib/sync/useViewerSync', () => ({
  useViewerSync: (options: unknown) => mocks.useViewerSync(options),
}));
vi.mock('@/lib/sync/useTemplateRefresh', () => ({
  useTemplateRefresh: (options: unknown) => mocks.useTemplateRefresh(options),
}));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/contexts/TripContext', () => ({ useTripContext: () => mocks.trip }));
vi.mock('@/lib/yjs/YjsProvider', () => ({ useYjsContext: () => mocks.yjs.value }));

import { SupabaseTripSync, useSyncStatus } from '@/lib/sync/SupabaseTripSync';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_ID = 'trip-1' as TripId;
const CLIENT = { from: vi.fn() };

function state(status: SyncState['status'], pendingCount = 0): SyncState {
  return { status, pendingCount, onlineCount: null };
}

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: TRIP_ID,
    name: 'Brittany',
    startDate: '2026-07-15',
    endDate: '2026-07-22',
    remoteTripId: 'remote-1',
    ...overrides,
  } as Trip;
}

let memberState: SyncState;
let viewerState: SyncState;
const memberSyncNow = vi.fn();
const viewerSyncNow = vi.fn();

/** Shows what the context publishes. */
function Probe() {
  const { state: current, syncNow } = useSyncStatus();
  return (
    <button type="button" onClick={syncNow}>
      {current.status}
    </button>
  );
}

function ui(props: { remoteTripId?: string | undefined; viewerToken?: string } = {}) {
  return (
    <SupabaseTripSync
      tripId={TRIP_ID}
      remoteTripId={'remoteTripId' in props ? props.remoteTripId : 'remote-1'}
      {...(props.viewerToken === undefined ? {} : { viewerToken: props.viewerToken })}
    >
      <Probe />
    </SupabaseTripSync>
  );
}

function lastOptions(hook: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return hook.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  memberState = state('syncing');
  viewerState = { ...state('syncing'), readOnly: true };
  mocks.useTripSync.mockImplementation(() => ({ state: memberState, syncNow: memberSyncNow }));
  mocks.useViewerSync.mockImplementation(() => ({ state: viewerState, syncNow: viewerSyncNow }));
  mocks.getClient.mockResolvedValue(CLIENT);
  mocks.syncPreview.mockResolvedValue({ status: 'updated' });
  mocks.auth.session = { user: { id: 'user-1' } };
  mocks.trip.currentTrip = trip();
  mocks.yjs.value = { loaded: true, doc: new Y.Doc() };
});

// ============================================================================
// Which hook a trip goes to
// ============================================================================

describe('SupabaseTripSync, wiring', () => {
  it('hands a member trip to the two-way sync, signed in', () => {
    render(ui());

    expect(lastOptions(mocks.useTripSync)).toEqual({
      doc: mocks.yjs.value?.doc,
      tripId: TRIP_ID,
      remoteTripId: 'remote-1',
      isSignedIn: true,
      userId: 'user-1',
    });
    expect(lastOptions(mocks.useViewerSync)).toEqual({
      doc: mocks.yjs.value?.doc,
      tripId: TRIP_ID,
      viewerToken: null,
      enabled: false,
    });
  });

  it('does not count a signed-out member as signed in', () => {
    mocks.auth.session = null;

    render(ui());

    expect(lastOptions(mocks.useTripSync)).toMatchObject({ isSignedIn: false, userId: null });
  });

  it('never lets a viewer trip reach the two-way sync, even signed in', () => {
    render(ui({ viewerToken: 'tok1234567890abc' }));

    expect(lastOptions(mocks.useTripSync)).toMatchObject({ isSignedIn: false });
    expect(lastOptions(mocks.useViewerSync)).toEqual({
      doc: mocks.yjs.value?.doc,
      tripId: TRIP_ID,
      viewerToken: 'tok1234567890abc',
      enabled: true,
    });
  });

  it('hands no document over outside a document provider', () => {
    mocks.yjs.value = null;

    render(ui());

    expect(lastOptions(mocks.useTripSync)).toMatchObject({ doc: null });
  });

  it('hands no document over until it has replayed', () => {
    mocks.yjs.value = { loaded: false, doc: new Y.Doc() };

    render(ui());

    expect(lastOptions(mocks.useTripSync)).toMatchObject({ doc: null });
  });

  it('publishes the member state for a member trip and the viewer state for a viewer trip', () => {
    memberState = state('synced');
    viewerState = { ...state('offline'), readOnly: true };

    const { rerender } = render(ui());
    expect(screen.getByRole('button')).toHaveTextContent('synced');

    rerender(ui({ viewerToken: 'tok1234567890abc' }));
    expect(screen.getByRole('button')).toHaveTextContent('offline');
  });

  it('publishes a state that changes after mount', () => {
    const { rerender } = render(ui());
    expect(screen.getByRole('button')).toHaveTextContent('syncing');

    memberState = state('synced');
    rerender(ui());

    expect(screen.getByRole('button')).toHaveTextContent('synced');
  });

  it('passes the retry of the hook in charge', () => {
    render(ui());

    act(() => {
      screen.getByRole('button').click();
    });

    expect(memberSyncNow).toHaveBeenCalledTimes(1);
    expect(viewerSyncNow).not.toHaveBeenCalled();
  });
});

// ============================================================================
// The server's preview
// ============================================================================

describe('SupabaseTripSync, the preview row', () => {
  it('republishes the preview of the open trip', async () => {
    render(ui());

    await waitFor(() => {
      expect(mocks.syncPreview).toHaveBeenCalledWith(CLIENT, mocks.trip.currentTrip);
    });
  });

  it('republishes again when the name changes, and not for an unrelated edit', async () => {
    const { rerender } = render(ui());
    await waitFor(() => {
      expect(mocks.syncPreview).toHaveBeenCalledTimes(1);
    });

    mocks.trip.currentTrip = trip({ location: 'Somewhere else' });
    rerender(ui());
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.syncPreview).toHaveBeenCalledTimes(1);

    mocks.trip.currentTrip = trip({ name: 'Brittany 2' });
    rerender(ui());
    await waitFor(() => {
      expect(mocks.syncPreview).toHaveBeenCalledTimes(2);
    });
  });

  it.each([
    ['no trip is open', () => {
      mocks.trip.currentTrip = null;
    }, {}],
    ['another trip is open', () => {
      mocks.trip.currentTrip = trip({ id: 'trip-2' as TripId });
    }, {}],
    ['the trip was never shared', () => undefined, { remoteTripId: undefined }],
    ['the trip is a viewer trip', () => undefined, { viewerToken: 'tok1234567890abc' }],
  ])('does not republish when %s', async (_label, arrange, props) => {
    arrange();

    render(ui(props));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.syncPreview).not.toHaveBeenCalled();
  });

  it('drops the republish when the component goes before the client arrives', async () => {
    let release: (client: unknown) => void = () => {};
    mocks.getClient.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const { unmount } = render(ui());
    await waitFor(() => {
      expect(mocks.getClient).toHaveBeenCalled();
    });
    unmount();
    await act(async () => {
      release(CLIENT);
      await Promise.resolve();
    });

    expect(mocks.syncPreview).not.toHaveBeenCalled();
  });
});

// ============================================================================
// The template copy
// ============================================================================

describe('SupabaseTripSync, the template copy', () => {
  it('tells it the trip, the account and that the connection is up', () => {
    render(ui());

    expect(lastOptions(mocks.useTemplateRefresh)).toEqual({
      tripId: TRIP_ID,
      remoteTripId: 'remote-1',
      userId: 'user-1',
      online: true,
      ready: false,
    });
  });

  it('tells it the trip is ready once sync has caught up with the server', () => {
    memberState = state('synced');

    render(ui());

    expect(lastOptions(mocks.useTemplateRefresh)).toMatchObject({ online: true, ready: true });
  });

  it('tells it the connection is down while sync is offline', () => {
    memberState = state('offline');

    render(ui());

    expect(lastOptions(mocks.useTemplateRefresh)).toMatchObject({ online: false });
  });

  it('keeps it idle for a viewer trip and while signed out', () => {
    const { rerender } = render(ui({ viewerToken: 'tok1234567890abc' }));
    expect(lastOptions(mocks.useTemplateRefresh)).toMatchObject({ remoteTripId: null });

    mocks.auth.session = null;
    rerender(ui());
    expect(lastOptions(mocks.useTemplateRefresh)).toMatchObject({ userId: null });
  });
});

// ============================================================================
// Reported transitions
// ============================================================================

describe('SupabaseTripSync, reported transitions', () => {
  function events(): string[] {
    return mocks.capture.mock.calls.map(([name]) => name as string);
  }

  it('reports nothing for the first status', () => {
    memberState = state('offline', 2);

    render(ui());

    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('reports going offline, with what is waiting, once', () => {
    const { rerender } = render(ui());

    memberState = state('offline', 3);
    rerender(ui());
    rerender(ui());

    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(mocks.capture).toHaveBeenCalledWith('trip_sync_offline', { pending_count: 3 });
  });

  it('does not report offline again when only the waiting count moves', () => {
    const { rerender } = render(ui());
    memberState = state('offline', 3);
    rerender(ui());

    memberState = state('offline', 4);
    rerender(ui());

    expect(events()).toEqual(['trip_sync_offline']);
  });

  it('reports coming back from offline to synced', () => {
    memberState = state('offline', 3);
    const { rerender } = render(ui());

    memberState = state('synced', 0);
    rerender(ui());

    expect(mocks.capture).toHaveBeenCalledWith('trip_sync_recovered', { pending_count: 0 });
  });

  it('reports nothing for a transition that is neither', () => {
    memberState = state('offline', 3);
    const { rerender } = render(ui());

    // Offline to syncing is a retry, not a recovery yet.
    memberState = state('syncing', 3);
    rerender(ui());
    // Syncing to synced, never having been offline, is the ordinary start.
    memberState = state('synced', 0);
    rerender(ui());

    expect(events()).toEqual([]);
  });
});
