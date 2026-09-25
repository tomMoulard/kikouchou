/**
 * @fileoverview The read-only card: explanation signed out, redemption signed in.
 *
 * @module components/shared/__tests__/ViewerUnlockCard.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ViewerUnlockCard } from '../ViewerUnlockCard';
import { useTripContext } from '@/contexts/TripContext';
import { useAuth } from '@/features/auth/AuthContext';
import { upgradeViewerTrip } from '@/lib/sync/viewer';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : key,
  }),
}));

vi.mock('@/contexts/TripContext', () => ({ useTripContext: vi.fn() }));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/features/auth/components/SignInDialog', () => ({
  SignInDialog: ({ open, reason }: { open: boolean; reason?: string }) =>
    open ? <div role="dialog">{reason}</div> : null,
}));
vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: vi.fn(async () => ({}) as never),
}));
vi.mock('@/lib/sync/viewer', () => ({ upgradeViewerTrip: vi.fn() }));

const mockedUseTripContext = vi.mocked(useTripContext);
const mockedUseAuth = vi.mocked(useAuth);
const mockedUpgrade = vi.mocked(upgradeViewerTrip);

const VIEWER_TRIP = { id: 'trip-1', name: 'Brittany', viewerToken: 'tokentokentoken1' };

function withTrip(trip: Record<string, unknown> | null): void {
  mockedUseTripContext.mockReturnValue({ currentTrip: trip } as never);
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

beforeEach(() => {
  mockedUpgrade.mockReset();
});

// ============================================================================
// Tests
// ============================================================================

describe('ViewerUnlockCard', () => {
  it('renders nothing for a member trip', () => {
    withTrip({ id: 'trip-1', remoteTripId: 'remote-1' });
    signedOut();

    const { container } = render(<ViewerUnlockCard />);

    expect(container).toBeEmptyDOMElement();
  });

  it('explains read-only and offers the sign-in when signed out', async () => {
    withTrip(VIEWER_TRIP);
    signedOut();
    const user = userEvent.setup();

    render(<ViewerUnlockCard />);

    expect(screen.getByRole('region', { name: 'Read-only' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign in to edit' }));

    // The dialog leads with what the account is for, not with the provider.
    expect(screen.getByRole('dialog')).toHaveTextContent(/sign in to edit this trip/i);
    expect(mockedUpgrade).not.toHaveBeenCalled();
  });

  it('redeems the token by itself once signed in', async () => {
    withTrip(VIEWER_TRIP);
    signedIn();
    mockedUpgrade.mockResolvedValue({ status: 'upgraded' });

    render(<ViewerUnlockCard />);

    // The account sweep would get there too; waiting for it means a person who
    // just signed in to edit keeps looking at a read-only page.
    await waitFor(() => {
      expect(mockedUpgrade).toHaveBeenCalledWith(expect.anything(), 'user-1', VIEWER_TRIP);
    });
    expect(screen.getByText('Accepting your invitation…')).toBeInTheDocument();
  });

  it('says why the invitation was refused, and offers a retry', async () => {
    withTrip(VIEWER_TRIP);
    signedIn();
    mockedUpgrade.mockResolvedValue({ status: 'expired' });
    const user = userEvent.setup();

    render(<ViewerUnlockCard />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/this invite link has expired/i);
    });

    mockedUpgrade.mockResolvedValue({ status: 'upgraded' });
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(mockedUpgrade).toHaveBeenCalledTimes(2);
    });
  });

  it('redeems once per trip and account, not on every render', async () => {
    withTrip(VIEWER_TRIP);
    signedIn();
    mockedUpgrade.mockResolvedValue({ status: 'not-found' });

    const { rerender } = render(<ViewerUnlockCard />);
    await waitFor(() => {
      expect(mockedUpgrade).toHaveBeenCalledTimes(1);
    });

    rerender(<ViewerUnlockCard />);

    // A failure must not loop; the retry button is the second attempt.
    expect(mockedUpgrade).toHaveBeenCalledTimes(1);
  });
});
