/**
 * @fileoverview Tests for useTripSync.
 *
 * The hook decides one thing: whether this trip syncs at all, and if it does,
 * it owns the provider's whole life — built once the Supabase client resolves,
 * torn down on unmount or on a switch to another trip. Getting that wrong
 * leaves a provider holding a document and a Realtime channel after the page
 * has moved on, which is invisible until a second trip starts reporting the
 * first one's status.
 *
 * The provider is a fake class here: what is under test is the wiring, not the
 * replication.
 *
 * @module lib/sync/__tests__/useTripSync.test
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import type { SyncState } from '@/lib/sync/SupabaseYjsProvider';
import type { TripId } from '@/types';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: vi.fn() }));

interface ProviderOptions {
  readonly doc: Y.Doc;
  readonly tripId: TripId;
  readonly remoteTripId: string;
  readonly userId?: string;
  readonly onStateChange: (state: SyncState) => void;
}

/** Every provider the hook has built, in order. */
const providers: FakeProvider[] = [];

class FakeProvider {
  readonly start = vi.fn().mockResolvedValue(undefined);
  readonly destroy = vi.fn();
  readonly syncNow = vi.fn().mockResolvedValue(undefined);

  readonly options: ProviderOptions;

  constructor(options: ProviderOptions) {
    this.options = options;
    providers.push(this);
  }

  /** Reports a status the way the real provider does. */
  report(state: SyncState): void {
    this.options.onStateChange(state);
  }
}

// Resolved lazily: the factory is hoisted above the class declaration.
vi.mock('@/lib/sync/SupabaseYjsProvider', () => ({
  SupabaseYjsProvider: class {
    constructor(options: ProviderOptions) {
      return new FakeProvider(options);
    }
  },
}));

import { getSupabaseClient } from '@/lib/supabase/client';
import { useTripSync } from '../useTripSync';

const mockedGetClient = vi.mocked(getSupabaseClient);

// ============================================================================
// Helpers
// ============================================================================

const TRIP_ID = 'trip-1' as TripId;

const SYNCED: SyncState = { status: 'synced', pendingCount: 0, onlineCount: null };

function renderSync(overrides: Record<string, unknown> = {}) {
  const doc = new Y.Doc();
  return {
    doc,
    ...renderHook(
      (props: Record<string, unknown>) =>
        useTripSync({
          doc,
          tripId: TRIP_ID,
          remoteTripId: 'remote-1',
          isSignedIn: true,
          userId: 'user-1',
          ...props,
        } as never),
      { initialProps: overrides },
    ),
  };
}

beforeEach(() => {
  providers.length = 0;
  vi.clearAllMocks();
  mockedGetClient.mockResolvedValue({} as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('useTripSync — trips that do not sync', () => {
  it('reports local when the trip has no remote copy', async () => {
    const { result } = renderSync({ remoteTripId: null });

    expect(result.current.state.status).toBe('local');
    await waitFor(() => {
      expect(mockedGetClient).not.toHaveBeenCalled();
    });
    expect(providers).toHaveLength(0);
  });

  it('reports local while nobody is signed in', async () => {
    const { result } = renderSync({ isSignedIn: false });

    expect(result.current.state.status).toBe('local');
    await waitFor(() => {
      expect(providers).toHaveLength(0);
    });
  });

  it('builds nothing when there is no backend to talk to', async () => {
    mockedGetClient.mockResolvedValue(null as never);

    const { result } = renderSync();

    await waitFor(() => {
      expect(mockedGetClient).toHaveBeenCalled();
    });
    expect(providers).toHaveLength(0);
    // Still the starting state: it is trying, not local.
    expect(result.current.state.status).not.toBe('local');
  });
});

describe('useTripSync — a trip that syncs', () => {
  it('builds the provider with the trip it was given and starts it', async () => {
    const { result, doc } = renderSync();

    await waitFor(() => {
      expect(providers).toHaveLength(1);
    });
    expect(providers[0]!.options).toMatchObject({
      doc,
      tripId: TRIP_ID,
      remoteTripId: 'remote-1',
      userId: 'user-1',
    });
    expect(providers[0]!.start).toHaveBeenCalled();
    expect(result.current.state.status).not.toBe('local');
  });

  it('leaves the user out rather than passing an empty one', async () => {
    renderSync({ userId: null });

    await waitFor(() => {
      expect(providers).toHaveLength(1);
    });
    expect(providers[0]!.options).not.toHaveProperty('userId');
  });

  it('reports what the provider reports', async () => {
    const { result } = renderSync();

    await waitFor(() => {
      expect(providers).toHaveLength(1);
    });

    act(() => {
      providers[0]!.report(SYNCED);
    });

    expect(result.current.state).toEqual(SYNCED);
  });

  it('tears the provider down on unmount', async () => {
    const { unmount } = renderSync();

    await waitFor(() => {
      expect(providers).toHaveLength(1);
    });

    unmount();

    expect(providers[0]!.destroy).toHaveBeenCalled();
  });

  it('says nothing about the old trip once another one is opened', async () => {
    const { result, rerender } = renderSync();

    await waitFor(() => {
      expect(providers).toHaveLength(1);
    });
    act(() => {
      providers[0]!.report({ status: 'offline', pendingCount: 3, onlineCount: null });
    });
    expect(result.current.state.status).toBe('offline');

    rerender({ remoteTripId: 'remote-2' });

    // A stale "offline" from the previous trip would be worse than no answer.
    await waitFor(() => {
      expect(providers).toHaveLength(2);
    });
    expect(result.current.state.status).not.toBe('offline');
    expect(providers[0]!.destroy).toHaveBeenCalled();
  });

  it('reports a provider that would not start rather than throwing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedGetClient.mockRejectedValue(new Error('no client'));

    renderSync();

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        '[sync] failed to start the provider:',
        expect.any(Error),
      );
    });
    consoleError.mockRestore();
  });
});

describe('useTripSync — asking for a sync', () => {
  it('passes syncNow through to the provider', async () => {
    const { result } = renderSync();

    await waitFor(() => {
      expect(providers).toHaveLength(1);
    });

    act(() => {
      result.current.syncNow();
    });

    expect(providers[0]!.syncNow).toHaveBeenCalled();
  });

  it('syncs again when the tab comes back to the front', async () => {
    renderSync();

    await waitFor(() => {
      expect(providers).toHaveLength(1);
    });

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // jsdom reports the document as visible, which is the case under test.
    expect(providers[0]!.syncNow).toHaveBeenCalled();
  });

  it('does not sync while the tab is hidden', async () => {
    renderSync();

    await waitFor(() => {
      expect(providers).toHaveLength(1);
    });

    const visibility = vi
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('hidden');

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(providers[0]!.syncNow).not.toHaveBeenCalled();
    visibility.mockRestore();
  });
});
