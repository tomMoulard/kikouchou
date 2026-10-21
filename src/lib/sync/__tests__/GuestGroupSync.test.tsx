/**
 * @fileoverview What the guest group sync provider sends to error tracking.
 *
 * PostHog issue `01a0e1ad-2d06-7d10-8c22-b4288011254e` held a sync whose
 * request never reached the server: "TypeError: Failed to fetch". The rest of
 * lib/sync treats a lost connection as a warning. This provider reported it as
 * an error, so every dropped connection looked like a broken sync.
 *
 * @module lib/sync/__tests__/GuestGroupSync.test
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GuestGroupSync, useGuestGroupSync } from '@/lib/sync/GuestGroupSync';
import { syncGuestGroups } from '@/lib/sync/guest-groups';
import { reportError } from '@/lib/posthog';

// ============================================================================
// Mocks
// ============================================================================

const env = vi.hoisted(() => ({
  session: { user: { id: 'user-1' } } as { user: { id: string } } | null,
  isOnline: true,
}));

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ session: env.session }),
}));

vi.mock('@/hooks', () => ({
  useOnlineStatus: () => ({ isOnline: env.isOnline }),
}));

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: vi.fn(async () => ({})),
}));

vi.mock('@/lib/sync/guest-groups', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sync/guest-groups')>()),
  syncGuestGroups: vi.fn(),
}));

vi.mock('@/lib/posthog', () => ({
  reportError: vi.fn(),
}));

const mockedSync = vi.mocked(syncGuestGroups),
  mockedReport = vi.mocked(reportError);

// ============================================================================
// Tests
// ============================================================================

describe('GuestGroupSync', () => {
  beforeEach(() => {
    mockedSync.mockReset();
    mockedReport.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('warns, and reports nothing, when the request never reached the server', async () => {
    mockedSync.mockResolvedValue({
      status: 'error',
      message: 'TypeError: Failed to fetch',
      reason: 'network',
    });

    render(<GuestGroupSync>{null}</GuestGroupSync>);

    await waitFor(() => {
      expect(console.warn).toHaveBeenCalledWith(
        '[guest-groups] sync failed:',
        'TypeError: Failed to fetch',
      );
    });
    expect(mockedReport).not.toHaveBeenCalled();
  });

  it('warns, and reports nothing, when the device clock is ahead of the server', async () => {
    mockedSync.mockResolvedValue({
      status: 'error',
      message: 'JWT issued at future',
      reason: 'clock',
    });

    render(<GuestGroupSync>{null}</GuestGroupSync>);

    await waitFor(() => {
      expect(console.warn).toHaveBeenCalledWith(
        '[guest-groups] sync failed:',
        'JWT issued at future',
      );
    });
    expect(mockedReport).not.toHaveBeenCalled();
  });

  it('reports a sync that the server refused', async () => {
    mockedSync.mockResolvedValue({
      status: 'error',
      message: 'permission denied for table guest_groups',
      reason: 'server',
    });

    render(<GuestGroupSync>{null}</GuestGroupSync>);

    await waitFor(() => {
      expect(mockedReport).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'permission denied for table guest_groups' }),
        { source: 'GuestGroupSync.sync' },
      );
    });
  });

  it('reports a server refusal that carries no message under a fixed one', async () => {
    mockedSync.mockResolvedValue({
      status: 'error',
      message: undefined as unknown as string,
      reason: 'server',
    });

    render(<GuestGroupSync>{null}</GuestGroupSync>);

    await waitFor(() => {
      expect(mockedReport).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'guest group sync failed' }),
        { source: 'GuestGroupSync.sync' },
      );
    });
  });
});

// ============================================================================
// What the provider hands its children
// ============================================================================

const SYNCED = { status: 'synced', pulled: 1, pushed: 2, pruned: 0 } as const;

/** Shows the context, and offers its trigger as a button. */
function Probe() {
  const { lastResult, isSyncing, syncNow } = useGuestGroupSync();
  return (
    <div>
      <output data-testid="syncing">{String(isSyncing)}</output>
      <output data-testid="result">{lastResult === null ? 'none' : lastResult.status}</output>
      <button type="button" onClick={syncNow}>
        sync
      </button>
    </div>
  );
}

describe('GuestGroupSync, context', () => {
  beforeEach(() => {
    mockedSync.mockReset();
    mockedReport.mockReset();
    env.session = { user: { id: 'user-1' } };
    env.isOnline = true;
  });

  it('is not syncing, and syncs nothing, while signed out', async () => {
    env.session = null;

    render(
      <GuestGroupSync>
        <Probe />
      </GuestGroupSync>,
    );
    expect(screen.getByTestId('syncing')).toHaveTextContent('false');
    fireEvent.click(screen.getByRole('button', { name: 'sync' }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockedSync).not.toHaveBeenCalled();
    expect(screen.getByTestId('syncing')).toHaveTextContent('false');
  });

  it('waits for the network, and syncs when it comes back', async () => {
    mockedSync.mockResolvedValue(SYNCED);
    env.isOnline = false;

    const view = render(
      <GuestGroupSync>
        <Probe />
      </GuestGroupSync>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockedSync).not.toHaveBeenCalled();

    env.isOnline = true;
    view.rerender(
      <GuestGroupSync>
        <Probe />
      </GuestGroupSync>,
    );

    await waitFor(() => {
      expect(mockedSync).toHaveBeenCalledTimes(1);
    });
  });

  it('syncs for the account that is signed in now, on its own and when asked', async () => {
    mockedSync.mockResolvedValue(SYNCED);
    const view = render(
      <GuestGroupSync>
        <Probe />
      </GuestGroupSync>,
    );
    await waitFor(() => {
      expect(mockedSync).toHaveBeenLastCalledWith(expect.anything(), 'user-1');
    });

    env.session = { user: { id: 'user-2' } };
    view.rerender(
      <GuestGroupSync>
        <Probe />
      </GuestGroupSync>,
    );
    await waitFor(() => {
      expect(mockedSync).toHaveBeenLastCalledWith(expect.anything(), 'user-2');
    });
    await waitFor(() => {
      expect(screen.getByTestId('syncing')).toHaveTextContent('false');
    });
    mockedSync.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'sync' }));

    await waitFor(() => {
      expect(mockedSync).toHaveBeenCalledWith(expect.anything(), 'user-2');
    });
  });

  it('says it is syncing while an attempt runs, and shows the outcome after', async () => {
    let release: (value: typeof SYNCED) => void = () => {};
    mockedSync.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }) as never,
    );

    render(
      <GuestGroupSync>
        <Probe />
      </GuestGroupSync>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('syncing')).toHaveTextContent('true');
    });
    expect(screen.getByTestId('result')).toHaveTextContent('none');

    await act(async () => {
      release(SYNCED);
    });

    await waitFor(() => {
      expect(screen.getByTestId('syncing')).toHaveTextContent('false');
    });
    expect(screen.getByTestId('result')).toHaveTextContent('synced');
  });

  it('warns about nothing after a sync that worked', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedSync.mockResolvedValue(SYNCED);

    render(
      <GuestGroupSync>
        <Probe />
      </GuestGroupSync>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('synced');
    });
    expect(warn).not.toHaveBeenCalled();
    expect(mockedReport).not.toHaveBeenCalled();
  });

  it('runs one attempt at a time, and the next once the first is done', async () => {
    let release: (value: typeof SYNCED) => void = () => {};
    mockedSync.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }) as never,
    );

    render(
      <GuestGroupSync>
        <Probe />
      </GuestGroupSync>,
    );
    await waitFor(() => {
      expect(mockedSync).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'sync' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockedSync).toHaveBeenCalledTimes(1);

    mockedSync.mockResolvedValue(SYNCED);
    await act(async () => {
      release(SYNCED);
    });
    await waitFor(() => {
      expect(screen.getByTestId('syncing')).toHaveTextContent('false');
    });

    fireEvent.click(screen.getByRole('button', { name: 'sync' }));

    await waitFor(() => {
      expect(mockedSync).toHaveBeenCalledTimes(2);
    });
  });
});
