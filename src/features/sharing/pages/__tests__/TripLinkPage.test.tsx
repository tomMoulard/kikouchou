/**
 * @fileoverview A trip's stable link, opened on every kind of device.
 *
 * @module features/sharing/pages/__tests__/TripLinkPage.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TripLinkPage } from '../TripLinkPage';
import { db } from '@/lib/db/database';
import { useAuth } from '@/features/auth/AuthContext';
import { useInstallPromptState } from '@/contexts/InstallPromptContext';
import { useTripContext } from '@/contexts/TripContext';
import { useHereManifest } from '@/lib/pwa/use-here-manifest';
import { materialiseJoinedTrip } from '@/lib/sync/join-trip';
import posthog from '@/lib/posthog';
import type { ShareId, Trip, TripId } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : key,
  }),
}));

const navigate = vi.fn();
let routeId: string | undefined = 'remote-trip-1';
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useParams: () => ({ remoteTripId: routeId }),
}));

vi.mock('@/contexts/TripContext', () => ({ useTripContext: vi.fn() }));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/contexts/InstallPromptContext', () => ({ useInstallPromptState: vi.fn() }));
vi.mock('@/lib/pwa/use-here-manifest', () => ({ useHereManifest: vi.fn() }));
vi.mock('@/features/auth/components/SignInDialog', () => ({
  SignInDialog: ({ open, reason }: { open: boolean; reason?: string }) =>
    open ? <div role="dialog">{reason}</div> : null,
}));
vi.mock('../../components/ImportTripQrDialog', () => ({
  ImportTripQrDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="import-qr-dialog" /> : null,
}));
vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: vi.fn(async () => ({}) as never),
}));
vi.mock('@/lib/sync/join-trip', () => ({ materialiseJoinedTrip: vi.fn() }));
vi.mock('@/lib/posthog', () => ({
  // Named export used by every catch block that reports; a mock
  // without it makes the reporter itself the error under test.
  reportError: vi.fn(), default: { capture: vi.fn() } }));

const mockedUseTripContext = vi.mocked(useTripContext);
const mockedUseAuth = vi.mocked(useAuth);
const mockedInstallState = vi.mocked(useInstallPromptState);
const mockedMaterialise = vi.mocked(materialiseJoinedTrip);
const capture = vi.mocked(posthog!.capture);
const setCurrentTrip = vi.fn(async () => {});

const TRIP_ID = 'trip-local-1' as TripId;

function installState(overrides: { installIntent?: boolean; isInstalled?: boolean } = {}): void {
  mockedInstallState.mockReturnValue({
    canInstall: false,
    isInstalled: false,
    isInstalling: false,
    installIntent: false,
    manualInstallPlatform: 'ios',
    install: vi.fn(async () => false),
    requestInstall: vi.fn(),
    ...overrides,
  });
}

function signedOut(): void {
  mockedUseAuth.mockReturnValue({ isAvailable: true, isResolved: true, user: null } as never);
}

function signedIn(): void {
  mockedUseAuth.mockReturnValue({
    isAvailable: true,
    isResolved: true,
    user: { id: 'user-1' },
  } as never);
}

function unresolved(): void {
  mockedUseAuth.mockReturnValue({ isAvailable: true, isResolved: false, user: null } as never);
}

async function seedLocalTrip(): Promise<void> {
  await db.trips.add({
    id: TRIP_ID,
    shareId: 'share-abc1' as ShareId,
    name: 'Brittany',
    startDate: '2026-07-10',
    endDate: '2026-07-17',
    remoteTripId: 'remote-trip-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Trip);
}

beforeEach(async () => {
  await db.trips.clear();
  vi.clearAllMocks();
  routeId = 'remote-trip-1';
  installState();
  mockedUseTripContext.mockReturnValue({ setCurrentTrip } as never);
  mockedMaterialise.mockReset();
});

// ============================================================================
// Tests
// ============================================================================

describe('TripLinkPage', () => {
  it('opens a trip this device already holds', async () => {
    await seedLocalTrip();
    signedOut();

    render(<TripLinkPage />);

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(`/trips/${TRIP_ID}/calendar`, { replace: true });
    });
    expect(setCurrentTrip).toHaveBeenCalledWith(TRIP_ID);
    // No account is needed for a trip that is already here.
    expect(mockedMaterialise).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledWith('trip_link_opened', { outcome: 'local' });
  });

  it('downloads the trip for a member on a new device', async () => {
    signedIn();
    mockedMaterialise.mockImplementation(async () => {
      await seedLocalTrip();
      return { status: 'joined', tripId: TRIP_ID };
    });

    render(<TripLinkPage />);

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(`/trips/${TRIP_ID}/calendar`, { replace: true });
    });
    expect(mockedMaterialise).toHaveBeenCalledWith(expect.anything(), 'remote-trip-1');
    expect(capture).toHaveBeenCalledWith('trip_link_opened', { outcome: 'downloaded' });
  });

  it('asks a signed-out visitor to sign in, or to use their invite', async () => {
    signedOut();
    const user = userEvent.setup();

    render(<TripLinkPage />);

    await expect(screen.findByText('A trip shared with you')).resolves.toBeInTheDocument();
    expect(mockedMaterialise).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/sign in to open the trip/i);

    await user.click(screen.getByRole('button', { name: 'Scan or paste an invite' }));
    expect(screen.getByTestId('import-qr-dialog')).toBeInTheDocument();
    expect(capture).toHaveBeenCalledWith('trip_link_opened', { outcome: 'sign_in_needed' });
  });

  it('waits for the stored session before deciding anything', async () => {
    unresolved();

    render(<TripLinkPage />);

    // Flashing "Sign in" at somebody whose session is still being read would
    // be wrong half the time.
    await expect(screen.findByText('Opening the trip…')).resolves.toBeInTheDocument();
    expect(screen.queryByText('A trip shared with you')).not.toBeInTheDocument();
    expect(mockedMaterialise).not.toHaveBeenCalled();
  });

  it('says why the download failed and offers a retry', async () => {
    signedIn();
    mockedMaterialise.mockResolvedValueOnce({ status: 'error', message: 'Not a member' });
    mockedMaterialise.mockImplementationOnce(async () => {
      await seedLocalTrip();
      return { status: 'joined', tripId: TRIP_ID };
    });
    const user = userEvent.setup();

    render(<TripLinkPage />);

    await expect(screen.findByRole('alert')).resolves.toHaveTextContent('Not a member');
    expect(capture).toHaveBeenCalledWith('trip_link_opened', { outcome: 'error' });

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(`/trips/${TRIP_ID}/calendar`, { replace: true });
    });
    expect(mockedMaterialise).toHaveBeenCalledTimes(2);
  });

  it('refuses a mangled id without asking the server', async () => {
    routeId = 'no';
    signedIn();

    render(<TripLinkPage />);

    await expect(screen.findByRole('alert')).resolves.toHaveTextContent(/isn't valid/);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(mockedMaterialise).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledWith('trip_link_opened', { outcome: 'invalid' });
  });

  it('stays put for an install, and lets the visitor open the trip by hand', async () => {
    await seedLocalTrip();
    signedOut();
    installState({ installIntent: true });
    const user = userEvent.setup();

    render(<TripLinkPage />);

    // An iPhone installing from here must stay here: a Home Screen app added
    // from this page opens on this page, and only if the page is still up.
    await expect(
      screen.findByText(/add kikouchou to your home screen from this page/i),
    ).resolves.toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Open the trip' }));
    expect(navigate).toHaveBeenCalledWith(`/trips/${TRIP_ID}/calendar`, { replace: true });
  });

  it('treats the same URL as a plain address inside the installed app', async () => {
    await seedLocalTrip();
    signedOut();
    installState({ installIntent: true, isInstalled: true });

    render(<TripLinkPage />);

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(`/trips/${TRIP_ID}/calendar`, { replace: true });
    });
  });

  it('points the document at the manifest that installs this page', () => {
    signedOut();

    render(<TripLinkPage />);

    expect(vi.mocked(useHereManifest)).toHaveBeenCalled();
  });
});
