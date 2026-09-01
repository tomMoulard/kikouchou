/**
 * @fileoverview Tests for JoinTripPage.
 *
 * The identity step used to render an unconditional spinner whenever the trip had
 * no participants, with no timeout and no terminal state. That is correct for the
 * second or two while the document arrives and permanently wrong afterwards: a
 * trip that genuinely has nobody on it left the invitee watching "Getting the
 * trip…" forever, waiting for participants that did not exist. Reported from a
 * real trip whose document had already downloaded — cursor well past every row —
 * and simply had no guests in it.
 *
 * So the property here is that this screen always reaches an end: it either
 * offers participants, or says there are none and lets the person in.
 *
 * @module features/sharing/pages/__tests__/JoinTripPage.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { JoinTripPage } from '../JoinTripPage';
import { useJoinTrip } from '../../hooks/useJoinTrip';
import { usePersonContext } from '@/contexts/PersonContext';
import { useTripContext } from '@/contexts/TripContext';
import { useSyncStatus } from '@/lib/sync/SupabaseTripSync';
import { fetchClaimedParticipants } from '@/lib/sync/join-trip';
import type { SyncState } from '@/lib/sync/SupabaseYjsProvider';
import type { Person, PersonId, TripId } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _key,
  }),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useParams: () => ({ token: 'tokentokent1' }),
}));

vi.mock('../../hooks/useJoinTrip', () => ({ useJoinTrip: vi.fn() }));
vi.mock('@/contexts/PersonContext', () => ({ usePersonContext: vi.fn() }));
vi.mock('@/lib/sync/SupabaseTripSync', () => ({ useSyncStatus: vi.fn() }));

vi.mock('@/contexts/TripContext', () => ({ useTripContext: vi.fn() }));

vi.mock('@/features/auth/AuthContext', () => {
  const auth = { user: { id: 'user-1' }, session: {}, isAvailable: true, isResolved: true };
  return { useAuth: () => auth };
});

vi.mock('@/features/auth/components/SignInDialog', () => ({
  SignInDialog: () => null,
}));

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: vi.fn(async () => ({}) as never),
}));

vi.mock('@/lib/sync/join-trip', () => ({
  claimParticipant: vi.fn(async () => ({ status: 'claimed' as const })),
  fetchClaimedParticipants: vi.fn(async () => new Set<string>()),
}));

const mockedUseJoinTrip = vi.mocked(useJoinTrip);
const mockedUsePersons = vi.mocked(usePersonContext);
const mockedUseSyncStatus = vi.mocked(useSyncStatus);
const mockedFetchClaimed = vi.mocked(fetchClaimedParticipants);
const mockedUseTripContext = vi.mocked(useTripContext);

const TRIP_ID = 'trip-local-1' as TripId;

function joined(): void {
  mockedUseJoinTrip.mockReturnValue({
    phase: { kind: 'joined', tripId: TRIP_ID, remoteTripId: 'remote-1' },
    retry: vi.fn(),
  } as never);
}

function withPersons(names: string[]): void {
  mockedUsePersons.mockReturnValue({
    persons: names.map((name, index) => ({
      id: `person-${index}` as PersonId,
      tripId: TRIP_ID,
      name,
      color: '#ff0000' as Person['color'],
    })),
  } as never);
}

function withSync(state: Partial<SyncState>): void {
  mockedUseSyncStatus.mockReturnValue({
    state: { status: 'synced', pendingCount: 0, onlineCount: null, ...state },
    syncNow: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedFetchClaimed.mockResolvedValue(new Set<string>());
  joined();
  withSync({});
  // The joined trip has to be *in* the trip list with a `remoteTripId`, or the
  // page renders its "You're in" fallback instead of the identity step — which
  // is how the first draft of these tests passed without exercising anything.
  mockedUseTripContext.mockReturnValue({
    setCurrentTrip: vi.fn(),
    trips: [{ id: TRIP_ID, name: '#1', remoteTripId: 'remote-1' }],
  } as never);
});

// ============================================================================
// Tests
// ============================================================================

describe('JoinTripPage identity step', () => {
  it('offers the participants once they have arrived', async () => {
    withPersons(['Alice', 'Bob']);

    render(<JoinTripPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /alice/i })).toBeInTheDocument();
    });
  });

  it('spins while the document is still on its way', () => {
    withPersons([]);
    withSync({ status: 'syncing' });

    render(<JoinTripPage />);

    // Correct for the second or two it takes; the bug was that it never ended.
    expect(screen.getByText(/getting the trip/i)).toBeInTheDocument();
  });

  it('says the trip has nobody on it once sync has settled', async () => {
    withPersons([]);
    withSync({ status: 'synced' });

    render(<JoinTripPage />);

    // A trip with no guests is an ordinary trip, not a pending download. Waiting
    // for participants that do not exist is what left the invitee stuck.
    await waitFor(() => {
      expect(screen.queryByText(/getting the trip/i)).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /open the trip/i })).toBeInTheDocument();
  });

  it('lets an invitee in when the trip is empty and the server is unreachable', async () => {
    withPersons([]);
    withSync({ status: 'offline' });

    render(<JoinTripPage />);

    // Offline is settled too: nothing more is coming until the network does, and
    // trapping somebody behind a spinner does not help them.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /open the trip/i })).toBeInTheDocument();
    });
  });

  it('gives up waiting even if sync never reports itself settled', async () => {
    vi.useFakeTimers();
    try {
      withPersons([]);
      withSync({ status: 'syncing' });

      render(<JoinTripPage />);
      expect(screen.getByText(/getting the trip/i)).toBeInTheDocument();

      // The backstop. Whatever sync says, this screen must reach an end — three
      // separate bugs in this flow have been a spinner with no terminal state.
      await vi.advanceTimersByTimeAsync(20_000);

      expect(screen.queryByText(/getting the trip/i)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
