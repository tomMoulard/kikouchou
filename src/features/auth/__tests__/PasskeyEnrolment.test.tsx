/**
 * Adding a passkey from the account panel.
 *
 * This half of the feature is load-bearing: `signInWithPasskey` can only find a
 * passkey somebody enrolled, and there is nowhere else in the app to enrol one.
 * So the cases that matter are "is it offered at all" and "does a refused
 * ceremony say so" — a silent failure here leaves a sign-in button that will
 * never work with no explanation of why.
 *
 * @module features/auth/__tests__/PasskeyEnrolment.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, userEvent, waitFor } from '@/test/utils';
import { PasskeyEnrolment } from '@/features/auth/components/PasskeyEnrolment';
import type {
  AuthContextValue,
  PasskeyEnrolmentOutcome,
} from '@/features/auth/AuthContext';
import { useAuth } from '@/features/auth/AuthContext';
import { useAuthProviders } from '@/features/auth/hooks/useAuthProviders';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('@/features/auth/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/auth/AuthContext')>();
  return { ...actual, useAuth: vi.fn() };
});

vi.mock('@/features/auth/hooks/useAuthProviders', () => ({
  useAuthProviders: vi.fn(),
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseAuthProviders = vi.mocked(useAuthProviders);

function authState(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    session: null,
    user: null,
    isResolved: true,
    isAvailable: true,
    isSigningIn: false,
    signInWithProvider: vi.fn(async () => ({ status: 'redirecting' as const })),
    signInWithEmailLink: vi.fn(async () => ({ status: 'email-sent' as const })),
    signInWithWallet: vi.fn(async () => ({ status: 'signed-in' as const })),
    signInWithPasskey: vi.fn(async () => ({ status: 'signed-in' as const })),
    registerPasskey: vi.fn(async () => ({ status: 'enrolled' as const })),
    signOut: vi.fn(async () => undefined),
    lastAuthError: null,
    ...overrides,
  };
}

function withPasskeys(canUsePasskeys: boolean): void {
  mockedUseAuthProviders.mockReturnValue({
    settings: {
      oauth: ['google'],
      email: false,
      phone: false,
      passkeys: canUsePasskeys,
      signupDisabled: false,
    },
    isConfirmed: true,
    walletChains: [],
    canUsePasskeys,
  });
}

const ADD_BUTTON = { name: 'auth.account.passkeyAction' };

beforeEach(() => {
  mockedUseAuth.mockReset();
  mockedUseAuthProviders.mockReset();
  mockedUseAuth.mockReturnValue(authState());
});

// ============================================================================
// Whether it is offered
// ============================================================================

describe('the enrolment panel', () => {
  it('renders nothing when passkeys are unusable here', () => {
    withPasskeys(false);

    const { container } = render(<PasskeyEnrolment />, { withProviders: false });

    // Either the project does not accept them or the browser cannot make one.
    // An explanation of a feature nobody can use is just noise in Settings.
    expect(container).toBeEmptyDOMElement();
  });

  it('explains what a passkey buys before offering one', () => {
    withPasskeys(true);

    render(<PasskeyEnrolment />, { withProviders: false });

    expect(screen.getByText('auth.account.passkeyDescription')).toBeInTheDocument();
    expect(screen.getByRole('button', ADD_BUTTON)).toBeEnabled();
  });
});

// ============================================================================
// Enrolling
// ============================================================================

describe('enrolling', () => {
  it('confirms against this device rather than the account', async () => {
    const registerPasskey = vi.fn(async () => ({ status: 'enrolled' as const }));
    mockedUseAuth.mockReturnValue(authState({ registerPasskey }));
    withPasskeys(true);

    render(<PasskeyEnrolment />, { withProviders: false });
    await userEvent.click(screen.getByRole('button', ADD_BUTTON));

    expect(registerPasskey).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('auth.account.passkeyAdded');
    });
  });

  it('keeps the button after a success, for a second device', async () => {
    withPasskeys(true);

    render(<PasskeyEnrolment />, { withProviders: false });
    await userEvent.click(screen.getByRole('button', ADD_BUTTON));

    // A passkey is bound to one device and origin, so wanting another is
    // normal rather than a mistake.
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', ADD_BUTTON)).toBeEnabled();
  });

  it('reports a refused ceremony instead of failing quietly', async () => {
    mockedUseAuth.mockReturnValue(
      authState({
        registerPasskey: vi.fn(async () => ({
          status: 'error' as const,
          message: 'The operation either timed out or was not allowed',
        })),
      }),
    );
    withPasskeys(true);

    render(<PasskeyEnrolment />, { withProviders: false });
    await userEvent.click(screen.getByRole('button', ADD_BUTTON));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The operation either timed out or was not allowed',
      );
    });
    // Nothing was enrolled, so the success line must not be on screen too.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('replaces the last outcome rather than stacking a second one', async () => {
    const registerPasskey = vi.fn<() => Promise<PasskeyEnrolmentOutcome>>();
    registerPasskey.mockResolvedValueOnce({ status: 'enrolled' });
    registerPasskey.mockResolvedValueOnce({
      status: 'error',
      message: 'The operation either timed out or was not allowed',
    });
    mockedUseAuth.mockReturnValue(authState({ registerPasskey }));
    withPasskeys(true);

    render(<PasskeyEnrolment />, { withProviders: false });
    const button = screen.getByRole('button', ADD_BUTTON);

    await userEvent.click(button);
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    await userEvent.click(button);

    // "Passkey added" standing next to "the operation was not allowed" says
    // both happened, and the reader cannot tell which one is now true.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('reports a build with no backend', async () => {
    mockedUseAuth.mockReturnValue(
      authState({ registerPasskey: vi.fn(async () => ({ status: 'unavailable' as const })) }),
    );
    withPasskeys(true);

    render(<PasskeyEnrolment />, { withProviders: false });
    await userEvent.click(screen.getByRole('button', ADD_BUTTON));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('auth.errors.unavailable');
    });
  });
});
