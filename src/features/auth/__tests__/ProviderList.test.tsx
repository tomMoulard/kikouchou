/**
 * The sign-in list is built from what the project reported.
 *
 * This is the test that holds the feature's promise: enabling a provider in the
 * Supabase dashboard changes the sign-in screen with no edit to the app. So the
 * cases here are driven by varying the *discovered settings* and asserting the
 * UI follows — including for a provider id that appears nowhere in this
 * repository, which is exactly what a newly enabled one looks like.
 *
 * `useAuthProviders` is mocked rather than `fetch`: what the endpoint's bytes
 * turn into is `lib/supabase/auth-settings`'s business, tested there, and
 * duplicating it here would tie these assertions to a wire format we do not own.
 *
 * @module features/auth/__tests__/ProviderList.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, userEvent, waitFor } from '@/test/utils';
import { ProviderList } from '@/features/auth/components/ProviderList';
import type { AuthContextValue } from '@/features/auth/AuthContext';
import { useAuth } from '@/features/auth/AuthContext';
import { useAuthProviders } from '@/features/auth/hooks/useAuthProviders';
import type { UseAuthProvidersResult } from '@/features/auth/hooks/useAuthProviders';
import type { AuthSettings } from '@/lib/supabase/auth-settings';

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

/**
 * What the project is pretending to have answered.
 *
 * `canUsePasskeys` is passed rather than derived from `settings.passkeys`
 * because the hook combines the project's flag with the browser's WebAuthn
 * support, and jsdom has neither — so the two have to be set independently
 * here, exactly as they are independent in life.
 */
function discovered(
  settings: Partial<AuthSettings> = {},
  extras: Partial<Pick<UseAuthProvidersResult, 'walletChains' | 'canUsePasskeys'>> = {},
): void {
  mockedUseAuthProviders.mockReturnValue({
    settings: {
      oauth: [],
      email: false,
      phone: false,
      passkeys: false,
      signupDisabled: false,
      ...settings,
    },
    isConfirmed: true,
    walletChains: extras.walletChains ?? [],
    canUsePasskeys: extras.canUsePasskeys ?? false,
  });
}

const continueWith = (name: string): string => `auth.signIn.continueWith ${name}`;

beforeEach(() => {
  mockedUseAuth.mockReset();
  mockedUseAuthProviders.mockReset();
  mockedUseAuth.mockReturnValue(authState());
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => true,
  });
});

// ============================================================================
// OAuth
// ============================================================================

describe('the discovered OAuth providers', () => {
  it('each get a button, in the order the project listed them', () => {
    discovered({ oauth: ['google', 'spotify'] });

    render(<ProviderList />, { withProviders: false });

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      continueWith('Google'),
      continueWith('Spotify'),
    ]);
  });

  it('include one this app has never heard of', () => {
    // `some_new_idp` appears nowhere in the source. A provider enabled in the
    // dashboard tomorrow looks exactly like this, and it has to work today.
    discovered({ oauth: ['some_new_idp'] });

    render(<ProviderList />, { withProviders: false });

    expect(
      screen.getByRole('button', { name: continueWith('Some New Idp') }),
    ).toBeEnabled();
  });

  it('read as brand names where the id does not capitalise cleanly', () => {
    discovered({ oauth: ['github', 'linkedin_oidc'] });

    render(<ProviderList />, { withProviders: false });

    expect(screen.getByRole('button', { name: continueWith('GitHub') })).toBeInTheDocument();
    // The protocol variant is an implementation detail nobody is signing in with.
    expect(screen.getByRole('button', { name: continueWith('LinkedIn') })).toBeInTheDocument();
  });

  it('start the redirect with the id the project gave, not a hard-coded one', async () => {
    const signInWithProvider = vi.fn(async () => ({ status: 'redirecting' as const }));
    mockedUseAuth.mockReturnValue(authState({ signInWithProvider }));
    discovered({ oauth: ['google', 'spotify'] });

    render(<ProviderList />, { withProviders: false });
    await userEvent.click(screen.getByRole('button', { name: continueWith('Spotify') }));

    expect(signInWithProvider).toHaveBeenCalledWith('spotify');
  });

  it('disappear when the project turns them off', () => {
    discovered({ oauth: ['spotify'] });

    render(<ProviderList />, { withProviders: false });

    // Discovery removes as well as adds: Google was the only way in when this
    // app shipped, and a button for a disabled provider is a dead end.
    expect(screen.queryByRole('button', { name: continueWith('Google') })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: continueWith('Spotify') })).toBeInTheDocument();
  });
});

// ============================================================================
// Email
// ============================================================================

describe('the email form', () => {
  it('is absent while the project has email disabled', () => {
    discovered({ oauth: ['google'] });

    render(<ProviderList />, { withProviders: false });

    expect(screen.queryByLabelText('auth.signIn.emailLabel')).not.toBeInTheDocument();
  });

  it('appears when the project reports email enabled', () => {
    discovered({ oauth: ['google'], email: true });

    render(<ProviderList />, { withProviders: false });

    expect(screen.getByLabelText('auth.signIn.emailLabel')).toBeInTheDocument();
  });

  it('sends the address and then says where to look', async () => {
    const signInWithEmailLink = vi.fn(async () => ({ status: 'email-sent' as const }));
    mockedUseAuth.mockReturnValue(authState({ signInWithEmailLink }));
    discovered({ email: true });

    render(<ProviderList />, { withProviders: false });
    await userEvent.type(
      screen.getByLabelText('auth.signIn.emailLabel'),
      'someone@example.test',
    );
    await userEvent.click(screen.getByRole('button', { name: 'auth.signIn.sendEmailLink' }));

    expect(signInWithEmailLink).toHaveBeenCalledWith('someone@example.test');
    // Nothing has happened yet from the user's point of view — the form must
    // stop looking ready to submit, or they click until the sender rate-limits.
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('auth.signIn.emailSent');
    });
    expect(screen.getByText('someone@example.test')).toBeInTheDocument();
    expect(screen.queryByLabelText('auth.signIn.emailLabel')).not.toBeInTheDocument();
  });

  it('will not submit an empty address', () => {
    discovered({ email: true });

    render(<ProviderList />, { withProviders: false });

    expect(screen.getByRole('button', { name: 'auth.signIn.sendEmailLink' })).toBeDisabled();
  });

  it('reports a rejected send against the field', async () => {
    const signInWithEmailLink = vi.fn(async () => ({
      status: 'error' as const,
      message: 'email rate limit exceeded',
    }));
    mockedUseAuth.mockReturnValue(authState({ signInWithEmailLink }));
    discovered({ email: true });

    render(<ProviderList />, { withProviders: false });
    const field = screen.getByLabelText('auth.signIn.emailLabel');
    await userEvent.type(field, 'someone@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'auth.signIn.sendEmailLink' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('email rate limit exceeded');
    });
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription('email rate limit exceeded');
  });
});

// ============================================================================
// Wallet
// ============================================================================

describe('the wallet button', () => {
  it('is absent when no chain is both enabled and installed', () => {
    // The settings endpoint reports nothing about web3 either way, so this is
    // driven by the build's own configuration and the browser's wallets.
    discovered({ oauth: ['google'] });

    render(<ProviderList />, { withProviders: false });

    expect(
      screen.queryByRole('button', { name: 'auth.signIn.withWallet' }),
    ).not.toBeInTheDocument();
  });

  it('signs a statement for the chain that was offered', async () => {
    const signInWithWallet = vi.fn(async () => ({ status: 'signed-in' as const }));
    mockedUseAuth.mockReturnValue(authState({ signInWithWallet }));
    discovered({}, { walletChains: ['solana'] });

    render(<ProviderList />, { withProviders: false });
    await userEvent.click(screen.getByRole('button', { name: 'auth.signIn.withWallet' }));

    expect(signInWithWallet).toHaveBeenCalledWith('solana', 'auth.signIn.walletStatement');
  });

  it('offers one per chain when the project accepts both', async () => {
    const signInWithWallet = vi.fn(async () => ({ status: 'signed-in' as const }));
    mockedUseAuth.mockReturnValue(authState({ signInWithWallet }));
    discovered({}, { walletChains: ['solana', 'ethereum'] });

    render(<ProviderList />, { withProviders: false });

    // Two buttons, in the configured order. They share an accessible name here
    // only because the harness echoes translation keys — the real string
    // interpolates the chain, so a reader sees "…your Solana wallet" and
    // "…your Ethereum wallet".
    const buttons = screen.getAllByRole('button', { name: 'auth.signIn.withWallet' });
    expect(buttons).toHaveLength(2);

    // The second one must ask for the second chain: a single shared handler
    // that always signed with `solana` would look right and be wrong.
    await userEvent.click(buttons[1] as HTMLElement);
    expect(signInWithWallet).toHaveBeenCalledWith('ethereum', 'auth.signIn.walletStatement');
  });

  it('reports a session that arrived without a redirect', async () => {
    const onSignedIn = vi.fn();
    mockedUseAuth.mockReturnValue(
      authState({ signInWithWallet: vi.fn(async () => ({ status: 'signed-in' as const })) }),
    );
    discovered({}, { walletChains: ['solana'] });

    render(<ProviderList onSignedIn={onSignedIn} />, { withProviders: false });
    await userEvent.click(screen.getByRole('button', { name: 'auth.signIn.withWallet' }));

    // The surface around the list has to move on — close, or navigate — since
    // no page load is coming to do it.
    await waitFor(() => {
      expect(onSignedIn).toHaveBeenCalledTimes(1);
    });
  });

  it('reports a dismissed wallet prompt', async () => {
    mockedUseAuth.mockReturnValue(
      authState({
        signInWithWallet: vi.fn(async () => ({
          status: 'error' as const,
          message: 'User rejected the request',
        })),
      }),
    );
    discovered({}, { walletChains: ['solana'] });

    render(<ProviderList />, { withProviders: false });
    await userEvent.click(screen.getByRole('button', { name: 'auth.signIn.withWallet' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('User rejected the request');
    });
  });
});

// ============================================================================
// Passkey
// ============================================================================

describe('the passkey button', () => {
  it('is absent when the project accepts passkeys but the browser cannot', () => {
    // jsdom is this case: `passkeys_enabled` is true server-side and there is no
    // WebAuthn implementation, so offering it would produce a
    // `NotSupportedError` that reads as the app being broken.
    discovered({ oauth: ['google'], passkeys: true }, { canUsePasskeys: false });

    render(<ProviderList />, { withProviders: false });

    expect(
      screen.queryByRole('button', { name: 'auth.signIn.withPasskey' }),
    ).not.toBeInTheDocument();
  });

  it('appears when both halves are true', () => {
    discovered({ passkeys: true }, { canUsePasskeys: true });

    render(<ProviderList />, { withProviders: false });

    expect(screen.getByRole('button', { name: 'auth.signIn.withPasskey' })).toBeEnabled();
  });

  it('signs in without a redirect', async () => {
    const signInWithPasskey = vi.fn(async () => ({ status: 'signed-in' as const }));
    const onSignedIn = vi.fn();
    mockedUseAuth.mockReturnValue(authState({ signInWithPasskey }));
    discovered({}, { canUsePasskeys: true });

    render(<ProviderList onSignedIn={onSignedIn} />, { withProviders: false });
    await userEvent.click(screen.getByRole('button', { name: 'auth.signIn.withPasskey' }));

    expect(signInWithPasskey).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(onSignedIn).toHaveBeenCalledTimes(1);
    });
  });

  it('reports a cancelled prompt', async () => {
    mockedUseAuth.mockReturnValue(
      authState({
        // What a dismissed system dialog produces, and what somebody with no
        // passkey for this origin sees.
        signInWithPasskey: vi.fn(async () => ({
          status: 'error' as const,
          message: 'The operation either timed out or was not allowed',
        })),
      }),
    );
    discovered({}, { canUsePasskeys: true });

    render(<ProviderList />, { withProviders: false });
    await userEvent.click(screen.getByRole('button', { name: 'auth.signIn.withPasskey' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The operation either timed out or was not allowed',
      );
    });
  });
});

// ============================================================================
// What the project says about itself
// ============================================================================

describe('the project-level warnings', () => {
  it('say so when new accounts are refused, without hiding the providers', () => {
    discovered({ oauth: ['google'], signupDisabled: true });

    render(<ProviderList />, { withProviders: false });

    // Existing accounts still work, so the buttons stay.
    expect(screen.getByRole('status')).toHaveTextContent('auth.signIn.signupDisabled');
    expect(screen.getByRole('button', { name: continueWith('Google') })).toBeEnabled();
  });

  it('say so when the project has every way in disabled', () => {
    discovered({});

    render(<ProviderList />, { withProviders: false });

    expect(screen.getByText('auth.signIn.noProviders')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
