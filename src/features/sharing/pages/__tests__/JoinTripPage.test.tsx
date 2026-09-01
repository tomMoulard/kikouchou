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
import { act, render, screen, waitFor } from '@testing-library/react';

import { JoinTripPage } from '../JoinTripPage';
import { useJoinTrip } from '../../hooks/useJoinTrip';
import { db } from '@/lib/db/database';
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
const mockedUseSyncStatus = vi.mocked(useSyncStatus);
const mockedFetchClaimed = vi.mocked(fetchClaimedParticipants);
const mockedUseTripContext = vi.mocked(useTripContext);

const TRIP_ID = 'trip-local-1' as TripId;
/** A trip the invitee already had open before following the invite link. */
const OTHER_TRIP_ID = 'trip-local-other' as TripId;

function joined(): void {
  mockedUseJoinTrip.mockReturnValue({
    phase: { kind: 'joined', tripId: TRIP_ID, remoteTripId: 'remote-1' },
    retry: vi.fn(),
  } as never);
}

/**
 * Puts participants in Dexie, which is where the projection puts them and now
 * where the identity step reads them.
 */
async function seedPersons(tripId: TripId, names: string[]): Promise<void> {
  await db.persons.bulkAdd(
    names.map((name) => ({
      id: `person-${name.toLowerCase()}` as PersonId,
      tripId,
      name,
      color: '#ff0000' as Person['color'],
    })),
  );
}

function withSync(state: Partial<SyncState>): void {
  mockedUseSyncStatus.mockReturnValue({
    state: { status: 'synced', pendingCount: 0, onlineCount: null, ...state },
    syncNow: vi.fn(),
  });
}

beforeEach(async () => {
  await db.persons.clear();
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
    await seedPersons(TRIP_ID, ['Alice', 'Bob']);

    render(<JoinTripPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /alice/i })).toBeInTheDocument();
    });
  });

  it('offers the joined trip\'s participants, not the previously open trip\'s', async () => {
    // The trip being joined, in Dexie where the projection puts it.
    await db.persons.bulkAdd([
      {
        id: 'person-alice' as PersonId,
        tripId: TRIP_ID,
        name: 'Alice',
        color: '#ff0000' as Person['color'],
      },
      {
        id: 'person-bob' as PersonId,
        tripId: TRIP_ID,
        name: 'Bob',
        color: '#00ff00' as Person['color'],
      },
    ]);
    // And somebody from an unrelated trip this device already had.
    await db.persons.add({
      id: 'person-zoe' as PersonId,
      tripId: OTHER_TRIP_ID,
      name: 'Zoe',
      color: '#0000ff' as Person['color'],
    });

    render(<JoinTripPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /alice/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /bob/i })).toBeInTheDocument();
    // Claiming Zoe would write a person id from another trip into this trip's
    // roster — and `unique (trip_id, person_id)` cannot catch that, because the
    // trip differs. Silent cross-trip corruption.
    expect(screen.queryByRole('button', { name: /zoe/i })).not.toBeInTheDocument();
  });

  it('shows nothing to pick when the joined trip has nobody, whatever is selected', async () => {
    await db.persons.add({
      id: 'person-zoe' as PersonId,
      tripId: OTHER_TRIP_ID,
      name: 'Zoe',
      color: '#0000ff' as Person['color'],
    });
    withSync({ status: 'synced' });

    render(<JoinTripPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /open the trip/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /zoe/i })).not.toBeInTheDocument();
  });

  it('spins while the document is still on its way', () => {
    withSync({ status: 'syncing' });

    render(<JoinTripPage />);

    // Correct for the second or two it takes; the bug was that it never ended.
    expect(screen.getByText(/getting the trip/i)).toBeInTheDocument();
  });

  it('says the trip has nobody on it once sync has settled', async () => {
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
    withSync({ status: 'offline' });

    render(<JoinTripPage />);

    // Offline is settled too: nothing more is coming until the network does, and
    // trapping somebody behind a spinner does not help them.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /open the trip/i })).toBeInTheDocument();
    });
  });

  it('gives up waiting even if sync never reports itself settled', async () => {
    // `shouldAdvanceTime` so the Dexie live query behind the participant list can
    // still resolve: frozen timers stall it, and the component then never leaves
    // its first render for reasons that have nothing to do with the backstop
    // being tested.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
        withSync({ status: 'syncing' });

      render(<JoinTripPage />);
      expect(screen.getByText(/getting the trip/i)).toBeInTheDocument();

      // The backstop. Whatever sync says, this screen must reach an end — three
      // separate bugs in this flow have been a spinner with no terminal state.
      // Wrapped in `act`: the grace period ends in a `setTimeout` whose
      // `setState` React otherwise leaves unflushed, so the screen still showed
      // the spinner while the state behind it had already changed.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });

      expect(screen.queryByText(/getting the trip/i)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
