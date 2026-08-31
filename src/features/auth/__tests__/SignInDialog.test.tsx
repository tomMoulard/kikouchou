/**
 * SignInDialog and AccountSection tests.
 *
 * The offline case is the one that earns a test: sign-in is one of only two
 * operations in the app that genuinely need a network, so the dialog has to say
 * so and refuse rather than fail into an opaque fetch error.
 *
 * @module features/auth/__tests__/SignInDialog.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AccountSection } from '@/features/auth/components/AccountSection';
import { SignInDialog } from '@/features/auth/components/SignInDialog';
import type { AuthContextValue } from '@/features/auth/AuthContext';
import { useAuth } from '@/features/auth/AuthContext';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('@/features/auth/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/auth/AuthContext')>();
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(useAuth);

function authState(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    session: null,
    user: null,
    isResolved: true,
    isAvailable: true,
    isSigningIn: false,
    signInWithGoogle: vi.fn(async () => ({ status: 'redirecting' as const })),
    signOut: vi.fn(async () => undefined),
    ...overrides,
  };
}

/** Drives `navigator.onLine`, which `useOnlineStatus` reads. */
function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

beforeEach(() => {
  mockedUseAuth.mockReset();
  setOnline(true);
});

afterEach(() => {
  setOnline(true);
});

// ============================================================================
// SignInDialog
// ============================================================================

describe('SignInDialog', () => {
  it('renders the benefit-led copy and the local-data reassurance', () => {
    mockedUseAuth.mockReturnValue(authState());

    render(<SignInDialog open onOpenChange={vi.fn()} />);

    // Someone deciding whether to sign up needs the benefit, not the mechanism.
    // The wording itself lives in the locale files; setup mocks `t` to the key.
    expect(screen.getByText('auth.signIn.description')).toBeInTheDocument();
    expect(screen.getByText('auth.signIn.localDataKept')).toBeInTheDocument();
  });

  it('shows a caller-supplied reason in place of the generic line', () => {
    mockedUseAuth.mockReturnValue(authState());

    render(
      <SignInDialog open onOpenChange={vi.fn()} reason="Sign in to share “Brittany 2026”." />,
    );

    expect(screen.getByText('Sign in to share “Brittany 2026”.')).toBeInTheDocument();
  });

  it('refuses and explains when offline instead of failing into a fetch error', async () => {
    setOnline(false);
    const signInWithGoogle = vi.fn();
    mockedUseAuth.mockReturnValue(authState({ signInWithGoogle }));

    render(<SignInDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('auth.signIn.offline');
    const button = screen.getByRole('button', { name: 'auth.signIn.withGoogle' });
    expect(button).toBeDisabled();

    await userEvent.click(button);
    expect(signInWithGoogle).not.toHaveBeenCalled();
  });

  it('shows no offline notice when online', () => {
    mockedUseAuth.mockReturnValue(authState());

    render(<SignInDialog open onOpenChange={vi.fn()} />);

    // The notice is load-bearing offline and pure noise when connected.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'auth.signIn.withGoogle' }),
    ).toBeEnabled();
  });

  it('starts sign-in when online', async () => {
    const signInWithGoogle = vi.fn(async () => ({ status: 'redirecting' as const }));
    mockedUseAuth.mockReturnValue(authState({ signInWithGoogle }));

    render(<SignInDialog open onOpenChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'auth.signIn.withGoogle' }));

    expect(signInWithGoogle).toHaveBeenCalledTimes(1);
  });

  it('surfaces a sign-in error to the user', async () => {
    const signInWithGoogle = vi.fn(async () => ({
      status: 'error' as const,
      message: 'provider disabled',
    }));
    mockedUseAuth.mockReturnValue(authState({ signInWithGoogle }));

    render(<SignInDialog open onOpenChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'auth.signIn.withGoogle' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('provider disabled');
    });
  });

  it('disables sign-in when no backend is configured', () => {
    mockedUseAuth.mockReturnValue(authState({ isAvailable: false }));

    render(<SignInDialog open onOpenChange={vi.fn()} />);

    expect(
      screen.getByRole('button', { name: 'auth.signIn.withGoogle' }),
    ).toBeDisabled();
  });

  it('keeps the button disabled while a redirect is in flight', () => {
    mockedUseAuth.mockReturnValue(authState({ isSigningIn: true }));

    render(<SignInDialog open onOpenChange={vi.fn()} />);

    expect(
      screen.getByRole('button', { name: 'auth.signIn.withGoogle' }),
    ).toBeDisabled();
  });

  it('closes without signing in when dismissed', async () => {
    const onOpenChange = vi.fn();
    mockedUseAuth.mockReturnValue(authState());

    render(<SignInDialog open onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'auth.signIn.notNow' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

// ============================================================================
// AccountSection
// ============================================================================

describe('AccountSection', () => {
  it('says trips stay local when no backend is configured', () => {
    mockedUseAuth.mockReturnValue(authState({ isAvailable: false }));

    render(<AccountSection />);

    expect(screen.getByText('auth.account.notConfigured')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers sign-in when signed out, framed around sharing', () => {
    mockedUseAuth.mockReturnValue(authState());

    render(<AccountSection />);

    expect(screen.getByText('auth.account.signedOut')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'auth.account.signInAction' })).toBeInTheDocument();
  });

  it('renders neither state until the session resolves', () => {
    mockedUseAuth.mockReturnValue(authState({ isResolved: false }));

    render(<AccountSection />);

    // Avoids flashing "Sign in" at someone already signed in. Withholds one
    // small panel, never the app.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('auth.account.signedOut')).not.toBeInTheDocument();
  });

  it('shows the signed-in identity and a sign-out control', () => {
    mockedUseAuth.mockReturnValue(
      authState({
        user: {
          id: 'user-1',
          email: 'someone@example.test',
          user_metadata: {},
        } as AuthContextValue['user'],
      }),
    );

    render(<AccountSection />);

    expect(screen.getByText('someone@example.test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'auth.account.signOutAction' })).toBeInTheDocument();
  });

  it('falls back to a name when the account has no email', () => {
    mockedUseAuth.mockReturnValue(
      authState({
        user: {
          id: 'user-1',
          user_metadata: { full_name: 'Alex Doe' },
        } as unknown as AuthContextValue['user'],
      }),
    );

    render(<AccountSection />);

    expect(screen.getByText('Alex Doe')).toBeInTheDocument();
  });

  it('signs out when asked', async () => {
    const signOut = vi.fn(async () => undefined);
    mockedUseAuth.mockReturnValue(
      authState({
        signOut,
        user: {
          id: 'user-1',
          email: 'someone@example.test',
          user_metadata: {},
        } as AuthContextValue['user'],
      }),
    );

    render(<AccountSection />);
    await userEvent.click(screen.getByRole('button', { name: 'auth.account.signOutAction' }));

    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
