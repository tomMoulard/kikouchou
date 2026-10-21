/**
 * @fileoverview The read-only card: explanation signed out, redemption signed in.
 *
 * @module components/shared/__tests__/ViewerUnlockCard.test
 */

import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ViewerUnlockCard } from '../ViewerUnlockCard';
import { useTripContext } from '@/contexts/TripContext';
import { useAuth } from '@/features/auth/AuthContext';
import { captureEvent } from '@/lib/posthog';
import { getSupabaseClient } from '@/lib/supabase/client';
import { upgradeViewerTrip } from '@/lib/sync/viewer';

// ============================================================================
// Test doubles
// ============================================================================

/**
 * Prints the English fallback, and records the key it was asked for, so a test
 * can tell which string was meant.
 */
const { translate } = vi.hoisted(() => ({
  translate: vi.fn((key: string, fallback?: string | Record<string, unknown>) =>
    typeof fallback === 'string' ? fallback : key,
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock('@/lib/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/posthog')>()),
  captureEvent: vi.fn(),
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

const mockedCapture = vi.mocked(captureEvent);
const mockedClient = vi.mocked(getSupabaseClient);

beforeEach(() => {
  mockedUpgrade.mockReset();
  mockedCapture.mockClear();
  translate.mockClear();
  mockedClient.mockImplementation(async () => ({}) as never);
});

/** Lets the deferred redeem and its promises run. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
  });
}

function signedInAs(id: string): void {
  mockedUseAuth.mockReturnValue({ isAvailable: true, isResolved: true, user: { id } } as never);
}

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

  it('still redeems when the trip is published again before the redeem has started', async () => {
    // The live query hands down a fresh trip object whenever the row is
    // written, and sign-in is exactly when the account sweep writes rows. The
    // new object re-runs the effect, whose cleanup cancelled the pending
    // redeem, and the once-per-trip guard then refused to schedule it again.
    withTrip(VIEWER_TRIP);
    signedIn();
    mockedUpgrade.mockResolvedValue({ status: 'upgraded' });

    const { rerender } = render(<ViewerUnlockCard />);
    withTrip({ ...VIEWER_TRIP });
    // A new prop as well: the card is memoised, and the mocked context alone
    // does not make it render.
    rerender(<ViewerUnlockCard className="mb-4" />);
    await settle();

    expect(mockedUpgrade).toHaveBeenCalledTimes(1);
  });

  it('still redeems under StrictMode, which runs every effect twice in development', async () => {
    withTrip(VIEWER_TRIP);
    signedIn();
    mockedUpgrade.mockResolvedValue({ status: 'upgraded' });

    render(
      <StrictMode>
        <ViewerUnlockCard />
      </StrictMode>,
    );
    await settle();

    expect(mockedUpgrade).toHaveBeenCalledTimes(1);
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

describe('ViewerUnlockCard signed out', () => {
  it('keeps the dialog shut until asked, and counts the ask', async () => {
    withTrip(VIEWER_TRIP);
    signedOut();
    const user = userEvent.setup();

    render(<ViewerUnlockCard className="extra" />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const region = screen.getByRole('region', { name: 'Read-only' });
    expect(region).toHaveClass('border-primary/20', 'extra');
    expect(region.querySelector('[data-slot="card-title"]')).toHaveTextContent('Read-only');
    expect(screen.getByText(/You opened this trip from an invite link/)).toBeInTheDocument();
    expect(translate).toHaveBeenCalledWith('viewer.title', 'Read-only');
    expect(translate).toHaveBeenCalledWith('viewer.description', expect.stringContaining('invite link'));
    expect(translate).toHaveBeenCalledWith('viewer.signIn', 'Sign in to edit');
    expect(translate).toHaveBeenCalledWith('viewer.signInReason', expect.stringContaining('Sign in to edit'));

    await user.click(screen.getByRole('button', { name: 'Sign in to edit' }));

    expect(mockedCapture).toHaveBeenCalledWith('viewer_sign_in_clicked');
  });

  it('renders nothing with no trip open', () => {
    withTrip(null);
    signedIn();

    const { container } = render(<ViewerUnlockCard />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('ViewerUnlockCard signed in', () => {
  it('waits with a spinner while the invitation is accepted', async () => {
    withTrip(VIEWER_TRIP);
    signedIn();
    mockedUpgrade.mockReturnValue(new Promise(() => undefined));

    render(<ViewerUnlockCard />);

    const waiting = screen.getByText('Accepting your invitation…');
    expect(waiting.querySelector('svg')).toHaveClass('size-4', 'animate-spin');
    expect(translate).toHaveBeenCalledWith('viewer.accepting', 'Accepting your invitation…');
  });

  it('does not redeem a member trip', async () => {
    withTrip({ id: 'trip-1', remoteTripId: 'remote-1' });
    signedIn();

    render(<ViewerUnlockCard />);
    await settle();

    expect(mockedUpgrade).not.toHaveBeenCalled();
  });

  it('does not redeem when the card is gone before the deferred start', async () => {
    withTrip(VIEWER_TRIP);
    signedIn();

    const { unmount } = render(<ViewerUnlockCard />);
    unmount();
    await settle();

    expect(mockedUpgrade).not.toHaveBeenCalled();
  });

  it('does not redeem when the card is gone before the client arrives', async () => {
    withTrip(VIEWER_TRIP);
    signedIn();
    let giveClient: (client: unknown) => void = () => undefined;
    mockedClient.mockImplementationOnce(
      () => new Promise((resolve) => {
        giveClient = resolve;
      }) as never,
    );

    const { unmount } = render(<ViewerUnlockCard />);
    await settle();
    unmount();
    await act(async () => {
      giveClient({});
    });

    expect(mockedUpgrade).not.toHaveBeenCalled();
  });

  it('reports nothing about a refusal that arrives after the card is gone', async () => {
    withTrip(VIEWER_TRIP);
    signedIn();
    let answer: (result: { status: 'expired' }) => void = () => undefined;
    mockedUpgrade.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );

    const { unmount } = render(<ViewerUnlockCard />);
    await waitFor(() => {
      expect(mockedUpgrade).toHaveBeenCalledTimes(1);
    });
    unmount();
    await act(async () => {
      answer({ status: 'expired' });
    });

    expect(mockedCapture).not.toHaveBeenCalledWith('trip_join_failed', expect.anything());
  });

  it('says the server could not be reached when there is no backend', async () => {
    withTrip(VIEWER_TRIP);
    signedIn();
    mockedClient.mockResolvedValueOnce(null as never);

    render(<ViewerUnlockCard />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('no backend');
    });
    expect(mockedUpgrade).not.toHaveBeenCalled();
  });

  it('treats an account that is already a member as done', async () => {
    withTrip(VIEWER_TRIP);
    signedIn();
    mockedUpgrade.mockResolvedValue({ status: 'already-member' } as never);

    render(<ViewerUnlockCard />);
    await waitFor(() => {
      expect(mockedUpgrade).toHaveBeenCalledTimes(1);
    });
    await settle();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mockedCapture).not.toHaveBeenCalledWith('trip_join_failed', expect.anything());
  });

  it('frames a refusal as one sentence, counts it, and styles it as an alert', async () => {
    withTrip(VIEWER_TRIP);
    signedIn();
    mockedUpgrade.mockResolvedValue({ status: 'expired' });

    render(<ViewerUnlockCard />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'Your invitation could not be accepted. This invite link has expired. This copy stays read-only until it is.',
    );
    expect(alert).toHaveClass('mt-1', 'flex', 'items-start', 'gap-2', 'text-sm', 'text-destructive');
    expect(alert.querySelector('svg')).toHaveClass('mt-0.5', 'size-4', 'shrink-0');
    expect(mockedCapture).toHaveBeenCalledWith('trip_join_failed', { reason: 'expired', mode: 'upgrade' });
    expect(translate).toHaveBeenCalledWith('viewer.acceptFailed', 'Your invitation could not be accepted.');
    expect(translate).toHaveBeenCalledWith('viewer.stillReadOnly', 'This copy stays read-only until it is.');
    expect(translate).toHaveBeenCalledWith('sharing.join.expired', 'This invite link has expired.');
    expect(translate).toHaveBeenCalledWith('common.retry', 'Retry');
  });

  const REFUSALS = [
    ['not-found', 'sharing.join.notFound', "This invite link isn't valid."],
    ['revoked', 'sharing.join.revoked', 'This invite link has been withdrawn.'],
    ['exhausted', 'sharing.join.exhausted', 'This invite link has been used up.'],
    ['unauthenticated', 'sharing.join.signInReason', 'Sign in to join this trip and edit it with the others.'],
  ] as const;

  for (const [status, key, text] of REFUSALS) {
    it(`explains "${status}"`, async () => {
      withTrip(VIEWER_TRIP);
      signedIn();
      mockedUpgrade.mockResolvedValue({ status } as never);

      render(<ViewerUnlockCard />);

      await expect(screen.findByRole('alert')).resolves.toHaveTextContent(text);
      expect(translate).toHaveBeenCalledWith(key, text);
    });
  }

  it('prints the message of an error it has no words for', async () => {
    withTrip(VIEWER_TRIP);
    signedIn();
    mockedUpgrade.mockResolvedValue({ status: 'error', message: 'socket closed' } as never);

    render(<ViewerUnlockCard />);

    await expect(screen.findByRole('alert')).resolves.toHaveTextContent('socket closed');
  });

  it('shows the spinner again while a retry is in flight', async () => {
    withTrip(VIEWER_TRIP);
    signedIn();
    mockedUpgrade.mockResolvedValueOnce({ status: 'expired' });
    const user = userEvent.setup();
    render(<ViewerUnlockCard />);
    await screen.findByRole('alert');

    mockedUpgrade.mockReturnValueOnce(new Promise(() => undefined));
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Accepting your invitation…')).toBeInTheDocument();
  });

  it('does not redeem again for the same trip and account when the trip row is refreshed', async () => {
    withTrip(VIEWER_TRIP);
    signedIn();
    mockedUpgrade.mockResolvedValue({ status: 'not-found' });
    const { rerender } = render(<ViewerUnlockCard />);
    await waitFor(() => {
      expect(mockedUpgrade).toHaveBeenCalledTimes(1);
    });

    // A new className as well, because the card is memoised on its props and
    // the contexts are mocked: without it the rerender never reaches the hooks.
    withTrip({ ...VIEWER_TRIP });
    rerender(<ViewerUnlockCard className="refreshed" />);
    await settle();

    expect(mockedUpgrade).toHaveBeenCalledTimes(1);
  });

  it('redeems again for another trip, and for another account, each time as it is now', async () => {
    withTrip(VIEWER_TRIP);
    signedInAs('user-1');
    mockedUpgrade.mockResolvedValue({ status: 'not-found' });
    const user = userEvent.setup();
    const { rerender } = render(<ViewerUnlockCard />);
    await waitFor(() => {
      expect(mockedUpgrade).toHaveBeenCalledTimes(1);
    });

    const otherTrip = { id: 'trip-2', name: 'Alps', viewerToken: 'tokentokentoken2' };
    withTrip(otherTrip);
    rerender(<ViewerUnlockCard className="other-trip" />);
    await waitFor(() => {
      expect(mockedUpgrade).toHaveBeenLastCalledWith(expect.anything(), 'user-1', otherTrip);
    });

    signedInAs('user-2');
    rerender(<ViewerUnlockCard className="other-account" />);
    await waitFor(() => {
      expect(mockedUpgrade).toHaveBeenLastCalledWith(expect.anything(), 'user-2', otherTrip);
    });
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(mockedUpgrade).toHaveBeenCalledTimes(4);
    });
    expect(mockedUpgrade).toHaveBeenLastCalledWith(expect.anything(), 'user-2', otherTrip);
  });
});
