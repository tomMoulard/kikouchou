/**
 * SignInDialog and AccountSection tests.
 *
 * The offline case is the one that earns a test: sign-in is one of only two
 * operations in the app that genuinely need a network, so the dialog has to say
 * so and refuse rather than fail into an opaque fetch error.
 *
 * These render the real `ProviderList` rather than a stand-in, which means they
 * also pin the fallback: with no backend configured — the state the whole unit
 * suite runs in — provider discovery reaches nothing, and the list must still
 * offer something to click instead of an empty dialog. `ProviderList.test.tsx`
 * covers what a project's *answer* does to that list.
 *
 * @module features/auth/__tests__/SignInDialog.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, userEvent, waitFor } from '@/test/utils';
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

/** Drives `navigator.onLine`, which `useOnlineStatus` reads. */
function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

/**
 * The only button the fallback list offers. Two nodes — a translated prefix and
 * the untranslated brand name — because the provider list is not known at build
 * time, so there is no per-provider key to translate.
 */
const GOOGLE_BUTTON = 'auth.signIn.continueWith Google';

/** `withProviders: false` gives a MemoryRouter and nothing else: the panel
 *  links to `/signin`, and `useAuth` is mocked, so the real provider tree would
 *  be weight without an assertion behind it. */
const isolated = { withProviders: false } as const;

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

    render(<SignInDialog open onOpenChange={vi.fn()} />, isolated);

    // Someone deciding whether to sign up needs the benefit, not the mechanism.
    // The wording itself lives in the locale files; setup mocks `t` to the key.
    expect(screen.getByText('auth.signIn.description')).toBeInTheDocument();
    expect(screen.getByText('auth.signIn.localDataKept')).toBeInTheDocument();
  });

  it('shows a caller-supplied reason in place of the generic line', () => {
    mockedUseAuth.mockReturnValue(authState());

    render(
      <SignInDialog open onOpenChange={vi.fn()} reason="Sign in to share “Brittany 2026”." />,
      isolated,
    );

    expect(screen.getByText('Sign in to share “Brittany 2026”.')).toBeInTheDocument();
  });

  it('still offers a way in when discovery reached nothing', () => {
    mockedUseAuth.mockReturnValue(authState());

    render(<SignInDialog open onOpenChange={vi.fn()} />, isolated);

    // No backend is configured in this suite, so the fetch never happens and
    // the cache is empty. An empty dialog would be a dead end.
    expect(screen.getByRole('button', { name: GOOGLE_BUTTON })).toBeEnabled();
  });

  it('refuses and explains when offline instead of failing into a fetch error', async () => {
    setOnline(false);
    const signInWithProvider = vi.fn();
    mockedUseAuth.mockReturnValue(authState({ signInWithProvider }));

    render(<SignInDialog open onOpenChange={vi.fn()} />, isolated);

    expect(screen.getByRole('status')).toHaveTextContent('auth.signIn.offline');
    const button = screen.getByRole('button', { name: GOOGLE_BUTTON });
    expect(button).toBeDisabled();

    await userEvent.click(button);
    expect(signInWithProvider).not.toHaveBeenCalled();
  });

  it('shows no offline notice when online', () => {
    mockedUseAuth.mockReturnValue(authState());

    render(<SignInDialog open onOpenChange={vi.fn()} />, isolated);

    // The notice is load-bearing offline and pure noise when connected.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: GOOGLE_BUTTON })).toBeEnabled();
  });

  it('starts sign-in with the provider that was clicked', async () => {
    const signInWithProvider = vi.fn(async () => ({ status: 'redirecting' as const }));
    mockedUseAuth.mockReturnValue(authState({ signInWithProvider }));

    render(<SignInDialog open onOpenChange={vi.fn()} />, isolated);
    await userEvent.click(screen.getByRole('button', { name: GOOGLE_BUTTON }));

    expect(signInWithProvider).toHaveBeenCalledWith('google');
  });

  it('surfaces a sign-in error to the user', async () => {
    const signInWithProvider = vi.fn(async () => ({
      status: 'error' as const,
      message: 'provider disabled',
    }));
    mockedUseAuth.mockReturnValue(authState({ signInWithProvider }));

    render(<SignInDialog open onOpenChange={vi.fn()} />, isolated);
    await userEvent.click(screen.getByRole('button', { name: GOOGLE_BUTTON }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('provider disabled');
    });
  });

  it('says trips stay local when no backend is configured', () => {
    mockedUseAuth.mockReturnValue(authState({ isAvailable: false }));

    render(<SignInDialog open onOpenChange={vi.fn()} />, isolated);

    // A dead disabled button invites a click and explains nothing.
    expect(screen.getByText('auth.account.notConfigured')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: GOOGLE_BUTTON })).not.toBeInTheDocument();
  });

  it('keeps the buttons disabled while a redirect is in flight', () => {
    mockedUseAuth.mockReturnValue(authState({ isSigningIn: true }));

    render(<SignInDialog open onOpenChange={vi.fn()} />, isolated);

    expect(screen.getByRole('button', { name: GOOGLE_BUTTON })).toBeDisabled();
  });

  it('closes without signing in when dismissed', async () => {
    const onOpenChange = vi.fn();
    mockedUseAuth.mockReturnValue(authState());

    render(<SignInDialog open onOpenChange={onOpenChange} />, isolated);
    await userEvent.click(screen.getByRole('button', { name: 'auth.signIn.notNow' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('gets out of the way when a wallet signature signs the user in', async () => {
    const onOpenChange = vi.fn();
    mockedUseAuth.mockReturnValue(
      authState({
        signInWithProvider: vi.fn(async () => ({ status: 'signed-in' as const })),
      }),
    );

    render(<SignInDialog open onOpenChange={onOpenChange} />, isolated);
    await userEvent.click(screen.getByRole('button', { name: GOOGLE_BUTTON }));

    // The redirect flows never need this — the document is gone — but a session
    // that appears in place leaves the dialog covering the thing it unblocked.
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});

// ============================================================================
// AccountSection
// ============================================================================

describe('AccountSection', () => {
  it('says trips stay local when no backend is configured', () => {
    mockedUseAuth.mockReturnValue(authState({ isAvailable: false }));

    render(<AccountSection />, isolated);

    expect(screen.getByText('auth.account.notConfigured')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('sends a signed-out visitor to the sign-in page, and back here after', () => {
    mockedUseAuth.mockReturnValue(authState());

    render(<AccountSection />, isolated);

    expect(screen.getByText('auth.account.signedOut')).toBeInTheDocument();
    // A link, not a dialog: whoever opened Settings to sign in has decided
    // already, and a page is linkable where a dialog is not.
    expect(screen.getByRole('link', { name: 'auth.account.signInAction' })).toHaveAttribute(
      'href',
      '/signin?next=/settings',
    );
  });

  it('renders neither state until the session resolves', () => {
    mockedUseAuth.mockReturnValue(authState({ isResolved: false }));

    render(<AccountSection />, isolated);

    // Avoids flashing "Sign in" at someone already signed in. Withholds one
    // small panel, never the app.
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
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

    render(<AccountSection />, isolated);

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

    render(<AccountSection />, isolated);

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

    render(<AccountSection />, isolated);
    await userEvent.click(screen.getByRole('button', { name: 'auth.account.signOutAction' }));

    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
