/**
 * TripsEntryRedirect Tests
 *
 * The component makes one decision — the trip list or the create form — and the
 * whole risk is in what it does before the answer is in. So these cover the
 * waits as well as the outcomes: a device with trips, an account with trips it
 * has not downloaded, a lookup that never answers, and the second launch after
 * the first one was sent to the form.
 *
 * @module features/trips/pages/__tests__/TripsEntryRedirect.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';

import { render, screen, waitFor } from '@/test/utils';
import { installLocalStorageDouble } from '@/test/local-storage';

import { useTripContext } from '@/contexts/TripContext';
import { useAuth } from '@/features/auth/AuthContext';
import type { Trip } from '@/types';

import { useRemoteTrips } from '../../hooks/useRemoteTrips';
import { DECISION_TIMEOUT_MS, FIRST_RUN_STORAGE_KEY, TripsEntryRedirect } from '../TripsEntryRedirect';

/* jsdom here has no `localStorage`, and the component reads it during render. */
const storage = installLocalStorageDouble();

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/contexts/TripContext', () => ({ useTripContext: vi.fn() }));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../hooks/useRemoteTrips', () => ({ useRemoteTrips: vi.fn() }));

const mockedUseTripContext = vi.mocked(useTripContext);
const mockedUseAuth = vi.mocked(useAuth);
const mockedUseRemoteTrips = vi.mocked(useRemoteTrips);

const trip: Trip = {
  id: 'trip-1' as Trip['id'],
  shareId: 'share-1' as Trip['shareId'],
  name: 'Summer house',
  location: 'Biarritz',
  startDate: '2026-07-01' as Trip['startDate'],
  endDate: '2026-07-10' as Trip['endDate'],
  description: '',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

/**
 * Sets the trip list this device holds, and whether it is still loading.
 */
function givenLocalTrips(trips: Trip[], isLoading = false, error: Error | null = null): void {
  mockedUseTripContext.mockReturnValue({
    trips,
    isLoading,
    error,
    currentTrip: null,
    setCurrentTrip: vi.fn(),
    checkConnection: vi.fn(),
  } as never);
}

/**
 * Sets what the account holds elsewhere, and whether that is known yet.
 */
function givenRemoteTrips(
  remoteOnly: { id: string; name: string }[],
  isChecking = false,
): void {
  mockedUseRemoteTrips.mockReturnValue({
    remoteOnly,
    isChecking,
    download: vi.fn(),
    isDownloading: null,
  });
}

/**
 * Renders the component alone.
 *
 * `withProviders: false` because the two contexts it reads are mocked above:
 * `AppProviders` would mount the real `AuthProvider`, which this file has just
 * replaced with a bare `useAuth`.
 *
 * @returns Nothing the tests need; they assert on the navigation
 */
function renderRedirect(): void {
  render(<TripsEntryRedirect />, { withProviders: false });
}

describe('TripsEntryRedirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.clear();
    mockedUseAuth.mockReturnValue({ isResolved: true } as never);
    givenLocalTrips([]);
    givenRemoteTrips([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sends a first launch with nothing to open to the create form', async () => {
    renderRedirect();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/trips/new', { replace: true });
    });
  });

  it('sends a device that already holds a trip to the list', async () => {
    givenLocalTrips([trip]);

    renderRedirect();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/trips', { replace: true });
    });
  });

  it('sends an account with trips elsewhere to the list', async () => {
    givenRemoteTrips([{ id: 'remote-1', name: 'Ski trip' }]);

    renderRedirect();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/trips', { replace: true });
    });
  });

  it('sends the second launch to the list, form or not', async () => {
    window.localStorage.setItem(FIRST_RUN_STORAGE_KEY, '1');

    renderRedirect();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/trips', { replace: true });
    });
  });

  it('records the redirect so it happens once', async () => {
    renderRedirect();

    await waitFor(() => {
      expect(window.localStorage.getItem(FIRST_RUN_STORAGE_KEY)).not.toBeNull();
    });
  });

  it('waits rather than guessing while the trips are still loading', () => {
    givenLocalTrips([], true);

    renderRedirect();

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('waits rather than guessing while the session is unresolved', () => {
    mockedUseAuth.mockReturnValue({ isResolved: false } as never);

    renderRedirect();

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('waits rather than guessing while the remote lookup is open', () => {
    givenRemoteTrips([], true);

    renderRedirect();

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('falls through to the list when the lookup never answers', async () => {
    vi.useFakeTimers();
    givenRemoteTrips([], true);

    renderRedirect();
    expect(mockNavigate).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DECISION_TIMEOUT_MS);
    });

    expect(mockNavigate).toHaveBeenCalledWith('/trips', { replace: true });
  });

  it('sends a device whose trips could not be read to the list', async () => {
    givenLocalTrips([], false, new Error('IndexedDB is blocked'));

    renderRedirect();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/trips', { replace: true });
    });
  });
});
