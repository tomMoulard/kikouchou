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
import { isRunningStandalone } from '@/lib/pwa/display-mode';
import { useHereManifest } from '@/lib/pwa/use-here-manifest';
import type { Person, PersonId, TripId } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === 'string') {
        return fallback;
      }
      // `t(key, { tripName, defaultValue })`: interpolate the default, so the
      // welcome can be asserted by what it says rather than by its key.
      const options = fallback ?? {};
      const template = options.defaultValue;
      if (typeof template !== 'string') {
        return _key;
      }
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(options[name] ?? ''),
      );
    },
    i18n: { language: 'en' },
  }),
}));

// `lib/posthog` reads `readDisplayMode` from the same module at import time,
// so the mock has to carry the whole surface or the app's analytics module
// throws while this page is being imported.
vi.mock('@/lib/pwa/display-mode', () => ({
  STANDALONE_MEDIA_QUERY: '(display-mode: standalone)',
  readDisplayMode: vi.fn(() => 'browser'),
  isRunningStandalone: vi.fn(() => false),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useParams: () => ({ token: 'tokentokent1' }),
}));

vi.mock('../../hooks/useJoinTrip', () => ({ useJoinTrip: vi.fn() }));

// The install request the nudge raises, and the manifest swap it relies on.
const installState = {
  canInstall: false,
  isInstalled: false,
  isInstalling: false,
  installIntent: false,
  manualInstallPlatform: 'ios' as const,
  install: vi.fn(async () => false),
  requestInstall: vi.fn(),
};
vi.mock('@/contexts/InstallPromptContext', () => ({
  useInstallPromptState: () => installState,
}));
vi.mock('@/lib/pwa/use-here-manifest', () => ({ useHereManifest: vi.fn() }));
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

// A localStorage double: this environment ships none, and the viewer's answer
// to "which one are you" is written through `window.localStorage`.
const storedEntries = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: {
    get length(): number {
      return storedEntries.size;
    },
    clear: (): void => storedEntries.clear(),
    getItem: (key: string): string | null => storedEntries.get(key) ?? null,
    key: (index: number): string | null => [...storedEntries.keys()][index] ?? null,
    removeItem: (key: string): void => {
      storedEntries.delete(key);
    },
    setItem: (key: string, value: string): void => {
      storedEntries.set(key, value);
    },
  } satisfies Storage,
});

const mockedUseJoinTrip = vi.mocked(useJoinTrip);
const mockedUseSyncStatus = vi.mocked(useSyncStatus);
const mockedFetchClaimed = vi.mocked(fetchClaimedParticipants);
const mockedUseTripContext = vi.mocked(useTripContext);
const mockedStandalone = vi.mocked(isRunningStandalone);

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

// ============================================================================
// Viewer welcome
// ============================================================================

const VIEWER_TRIP = {
  id: TRIP_ID,
  name: 'Brittany',
  shareId: 'share-abc1',
  startDate: '2026-07-15',
  endDate: '2026-07-22',
  location: 'Carnac',
  remoteTripId: 'remote-1',
  viewerToken: 'tokentokentoken1',
};

function viewing(): void {
  mockedUseJoinTrip.mockReturnValue({
    phase: { kind: 'viewing', tripId: TRIP_ID },
    retry: vi.fn(),
  } as never);
  mockedUseTripContext.mockReturnValue({
    setCurrentTrip: vi.fn(),
    trips: [VIEWER_TRIP],
  } as never);
}

describe('JoinTripPage for a viewer', () => {
  beforeEach(() => {
    localStorage.clear();
    mockedStandalone.mockReturnValue(false);
    installState.installIntent = false;
    installState.isInstalled = false;
    viewing();
  });

  it('says whose trip this is, and offers the guests to pick from', async () => {
    await seedPersons(TRIP_ID, ['Alice', 'Bob']);

    render(<JoinTripPage />);

    expect(screen.getByText("You're invited to Brittany")).toBeInTheDocument();
    expect(screen.getByText('Carnac')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /alice/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /bob/i })).toBeInTheDocument();
    // No account is asked for anywhere on this screen.
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
  });

  it('introduces the app when it is not running as an installed app', () => {
    render(<JoinTripPage />);

    expect(screen.getByText(/welcome to kikouchou/i)).toBeInTheDocument();
  });

  it('skips the introduction inside the installed app', () => {
    mockedStandalone.mockReturnValue(true);

    render(<JoinTripPage />);

    // The icon on the Home Screen has already said what the app is.
    expect(screen.queryByText(/welcome to kikouchou/i)).not.toBeInTheDocument();
  });

  it('remembers the pick on this device and opens the calendar', async () => {
    await seedPersons(TRIP_ID, ['Alice', 'Bob']);
    render(<JoinTripPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /alice/i })).toBeInTheDocument();
    });

    screen.getByRole('button', { name: /alice/i }).click();

    // Device-local, through the same key the share wizard writes, so every
    // "my travel" view reads it back — and nothing goes to the server.
    expect(JSON.parse(localStorage.getItem('kikouchou_guest_share-abc1') ?? '{}')).toEqual({
      personId: 'person-alice',
      tripId: TRIP_ID,
    });
    expect(navigate).toHaveBeenCalledWith(`/trips/${TRIP_ID}/calendar`);
  });

  it('lets somebody not on the list in anyway', async () => {
    await seedPersons(TRIP_ID, ['Alice']);
    render(<JoinTripPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /alice/i })).toBeInTheDocument();
    });

    screen.getByRole('button', { name: /not on the list/i }).click();

    expect(localStorage.getItem('kikouchou_guest_share-abc1')).toBeNull();
    expect(navigate).toHaveBeenCalledWith(`/trips/${TRIP_ID}/calendar`);
  });

  it('sends a returning viewer straight to the calendar', async () => {
    localStorage.setItem(
      'kikouchou_guest_share-abc1',
      JSON.stringify({ personId: 'person-alice', tripId: TRIP_ID }),
    );

    render(<JoinTripPage />);

    // Asked once; the calendar is what a returning guest came back for.
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(`/trips/${TRIP_ID}/calendar`);
    });
  });

  it('offers a look around when the trip has nobody in it yet', async () => {
    render(<JoinTripPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /have a look around/i })).toBeInTheDocument();
    });
  });

  it('points the document at the manifest that installs this page', () => {
    render(<JoinTripPage />);

    // An iPhone that installs from here must open the installed app here.
    expect(vi.mocked(useHereManifest)).toHaveBeenCalled();
  });

  describe('when the visitor came to install', () => {
    beforeEach(() => {
      installState.installIntent = true;
    });

    it('keeps a returning viewer on the page and says where to install from', async () => {
      localStorage.setItem(
        'kikouchou_guest_share-abc1',
        JSON.stringify({ personId: 'person-alice', tripId: TRIP_ID }),
      );

      render(<JoinTripPage />);

      // The page has to stay under the share sheet: a Home Screen app added
      // from here opens here, and that is the whole point of the detour.
      expect(screen.getByTestId('install-here-hint')).toBeInTheDocument();
      expect(screen.queryByText('Which one are you?')).not.toBeInTheDocument();
      expect(navigate).not.toHaveBeenCalled();

      screen.getByRole('button', { name: /open the trip/i }).click();

      expect(navigate).toHaveBeenCalledWith(`/trips/${TRIP_ID}/calendar`);
    });

    it('still asks a first-time viewer who they are', async () => {
      await seedPersons(TRIP_ID, ['Alice']);

      render(<JoinTripPage />);

      expect(screen.getByTestId('install-here-hint')).toBeInTheDocument();
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /alice/i })).toBeInTheDocument();
      });
    });

    it('drops the hint inside the installed app', () => {
      installState.isInstalled = true;
      localStorage.setItem(
        'kikouchou_guest_share-abc1',
        JSON.stringify({ personId: 'person-alice', tripId: TRIP_ID }),
      );

      render(<JoinTripPage />);

      // The Home Screen app carries `?install=1` in its start URL; there is
      // nothing left to install, so the returning viewer goes on through.
      expect(screen.queryByTestId('install-here-hint')).not.toBeInTheDocument();
      expect(navigate).toHaveBeenCalledWith(`/trips/${TRIP_ID}/calendar`);
    });
  });
});
