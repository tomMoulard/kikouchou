/**
 * @fileoverview Tests for the JoinTripPage states either side of the identity step.
 *
 * The sibling file covers the picker itself. This one covers the phases an
 * invitee reaches before it — the link still opening, the link refused, the
 * join failed — and what happens when they pick a name: the four answers the
 * server can give, and the two ways the claim can fail before it is even asked.
 *
 * @module features/sharing/pages/__tests__/JoinTripPage.phases.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { db } from '@/lib/db/database';
import { useTripContext } from '@/contexts/TripContext';
import { useSyncStatus } from '@/lib/sync/SupabaseTripSync';
import { claimParticipant, fetchClaimedParticipants } from '@/lib/sync/join-trip';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { SyncState } from '@/lib/sync/SupabaseYjsProvider';
import type { Person, PersonId, TripId } from '@/types';

import { JoinTripPage } from '../JoinTripPage';
import { useJoinTrip } from '../../hooks/useJoinTrip';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === 'string') {
        return fallback;
      }
      const options = fallback ?? {};
      const template = options.defaultValue;
      if (typeof template !== 'string') {
        return key;
      }
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(options[name] ?? ''),
      );
    },
    i18n: { language: 'en' },
  }),
}));

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

vi.mock('@/features/auth/components/SignInDialog', () => ({ SignInDialog: () => null }));

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: vi.fn(async () => ({}) as never),
}));

vi.mock('@/lib/sync/join-trip', () => ({
  claimParticipant: vi.fn(async () => ({ status: 'claimed' as const })),
  fetchClaimedParticipants: vi.fn(async () => new Set<string>()),
  cacheClaimedPersonId: vi.fn(async () => {}),
}));

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
const mockedClaim = vi.mocked(claimParticipant);
const mockedGetClient = vi.mocked(getSupabaseClient);
const mockedUseTripContext = vi.mocked(useTripContext);

const TRIP_ID = 'trip-local-1' as TripId;

const retry = vi.fn();

function phase(value: unknown): void {
  mockedUseJoinTrip.mockReturnValue({ phase: value, retry } as never);
}

function withSync(state: Partial<SyncState> = {}): void {
  mockedUseSyncStatus.mockReturnValue({
    state: { status: 'synced', pendingCount: 0, onlineCount: null, ...state },
    syncNow: vi.fn(),
  });
}

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

beforeEach(async () => {
  await db.persons.clear();
  vi.clearAllMocks();
  mockedFetchClaimed.mockResolvedValue(new Set<string>());
  mockedClaim.mockResolvedValue({ status: 'claimed' } as never);
  mockedGetClient.mockResolvedValue({} as never);
  phase({ kind: 'joined', tripId: TRIP_ID, remoteTripId: 'remote-1' });
  withSync();
  mockedUseTripContext.mockReturnValue({
    setCurrentTrip: vi.fn(),
    trips: [{ id: TRIP_ID, name: '#1', remoteTripId: 'remote-1' }],
  } as never);
});

// ============================================================================
// Tests
// ============================================================================

describe('JoinTripPage phases', () => {
  it('says the trip is opening while the link is being followed', () => {
    phase({ kind: 'joining' });

    render(<JoinTripPage />);

    expect(screen.getByText('Opening the trip…')).toBeInTheDocument();
  });

  it.each([
    ['not-found', "This invite link isn't valid."],
    ['revoked', 'This invite link has been withdrawn.'],
    ['expired', 'This invite link has expired.'],
    ['exhausted', 'This invite link has been used up.'],
  ])('explains a %s link in its own words', (reason, message) => {
    phase({ kind: 'rejected', reason });

    render(<JoinTripPage />);

    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByText('Ask whoever invited you for a fresh link.')).toBeInTheDocument();
  });

  it('sends a refused invitee back to their own trips', async () => {
    const user = userEvent.setup();
    phase({ kind: 'rejected', reason: 'expired' });

    render(<JoinTripPage />);
    await user.click(screen.getByRole('button', { name: 'My trips' }));

    expect(navigate).toHaveBeenCalledWith('/trips');
  });

  it('shows why the join failed and offers another go', async () => {
    const user = userEvent.setup();
    phase({ kind: 'failed', message: 'the network went away' });

    render(<JoinTripPage />);

    expect(screen.getByText("Couldn't join the trip")).toBeInTheDocument();
    expect(screen.getByText('the network went away')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalled();
  });

  it('waits for the trip row before welcoming a viewer', () => {
    phase({ kind: 'viewing', tripId: TRIP_ID });
    mockedUseTripContext.mockReturnValue({ setCurrentTrip: vi.fn(), trips: [] } as never);

    render(<JoinTripPage />);

    expect(screen.getByText('Opening the trip…')).toBeInTheDocument();
  });

  it('lets a member straight in when the trip is local only', async () => {
    const user = userEvent.setup();
    mockedUseTripContext.mockReturnValue({
      setCurrentTrip: vi.fn(),
      trips: [{ id: TRIP_ID, name: '#1' }],
    } as never);

    render(<JoinTripPage />);

    expect(screen.getByText("You're in")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open the trip' }));
    expect(navigate).toHaveBeenCalledWith(`/trips/${TRIP_ID}/calendar`);
  });
});

describe('JoinTripPage claiming a name', () => {
  it('opens the trip once the claim is confirmed', async () => {
    const user = userEvent.setup();
    await seedPersons(TRIP_ID, ['Alice', 'Bob']);

    render(<JoinTripPage />);
    await user.click(await screen.findByRole('button', { name: /alice/i }));

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(`/trips/${TRIP_ID}/calendar`);
    });
    expect(mockedClaim).toHaveBeenCalledWith({}, 'remote-1', 'user-1', 'person-alice');
  });

  it('takes a name off the list when somebody else got there first', async () => {
    const user = userEvent.setup();
    mockedClaim.mockResolvedValue({ status: 'taken' } as never);
    await seedPersons(TRIP_ID, ['Alice', 'Bob']);

    render(<JoinTripPage />);
    await user.click(await screen.findByRole('button', { name: /alice/i }));

    expect(await screen.findByText('Somebody else just took that name.')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /alice/i })).not.toBeInTheDocument();
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('says the invitation is not accepted yet when the server has no roster row', async () => {
    const user = userEvent.setup();
    mockedClaim.mockResolvedValue({ status: 'not-a-member' } as never);
    await seedPersons(TRIP_ID, ['Alice']);

    render(<JoinTripPage />);
    await user.click(await screen.findByRole('button', { name: /alice/i }));

    expect(
      await screen.findByText(
        'Your invitation has not been accepted yet. Open the invite link again.',
      ),
    ).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('passes the server’s own message through when the claim errors', async () => {
    const user = userEvent.setup();
    mockedClaim.mockResolvedValue({ status: 'error', message: 'row level security' } as never);
    await seedPersons(TRIP_ID, ['Alice']);

    render(<JoinTripPage />);
    await user.click(await screen.findByRole('button', { name: /alice/i }));

    expect(await screen.findByText('row level security')).toBeInTheDocument();
  });

  it('falls back to a generic message when the error carries none', async () => {
    const user = userEvent.setup();
    mockedClaim.mockResolvedValue({ status: 'error' } as never);
    await seedPersons(TRIP_ID, ['Alice']);

    render(<JoinTripPage />);
    await user.click(await screen.findByRole('button', { name: /alice/i }));

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
  });

  it('says so rather than looking dead when there is no backend', async () => {
    const user = userEvent.setup();
    mockedGetClient.mockResolvedValue(null as never);
    await seedPersons(TRIP_ID, ['Alice']);

    render(<JoinTripPage />);
    await user.click(await screen.findByRole('button', { name: /alice/i }));

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(mockedClaim).not.toHaveBeenCalled();
  });

  it('leaves the picker usable after the claim throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    mockedClaim.mockRejectedValue(new Error('offline'));
    await seedPersons(TRIP_ID, ['Alice', 'Bob']);

    render(<JoinTripPage />);
    await user.click(await screen.findByRole('button', { name: /alice/i }));

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    // The whole list is disabled while a claim is pending: if the reset in the
    // `finally` were missing, Bob would stay dead for good.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /bob/i })).toBeEnabled();
    });
    consoleError.mockRestore();
  });

  it('lets somebody who is not on the list carry on', async () => {
    const user = userEvent.setup();
    await seedPersons(TRIP_ID, ['Alice']);

    render(<JoinTripPage />);
    await user.click(await screen.findByRole('button', { name: "I'm not on the list" }));

    expect(navigate).toHaveBeenCalledWith(`/trips/${TRIP_ID}/calendar`);
    expect(mockedClaim).not.toHaveBeenCalled();
  });
});
