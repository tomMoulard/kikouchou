/**
 * The sign-in page.
 *
 * Most of what it renders is `ProviderList`, tested next door. What is only
 * true here is the handling of `?next=` — a value that arrives from the address
 * bar or from a link someone else sent, and that the page hands to `navigate()`
 * and to a `Link`. A protocol-relative `//evil.example` there would take a
 * signed-in user off the site, so the parsing is pinned rather than assumed.
 *
 * @module features/auth/__tests__/SignInPage.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils';
import { SignInPage } from '@/features/auth/pages/SignInPage';
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

const SIGNED_IN = authState({
  user: {
    id: 'user-1',
    email: 'someone@example.test',
    user_metadata: {},
  } as AuthContextValue['user'],
});

function renderAt(route: string): void {
  render(<SignInPage />, { withProviders: false, initialRoute: route });
}

beforeEach(() => {
  mockedUseAuth.mockReset();
  mockedUseAuth.mockReturnValue(authState());
});

// ============================================================================
// Signed out
// ============================================================================

describe('when signed out', () => {
  it('offers the ways in, with the account framed as optional', () => {
    renderAt('/signin');

    expect(screen.getByText('auth.signIn.pageDescription')).toBeInTheDocument();
    // The fallback list, since the unit suite configures no backend.
    expect(
      screen.getByRole('button', { name: 'auth.signIn.continueWith Google' }),
    ).toBeEnabled();
  });
});

// ============================================================================
// Signed in
// ============================================================================

describe('when already signed in', () => {
  it('says so instead of offering the list again', () => {
    mockedUseAuth.mockReturnValue(SIGNED_IN);

    renderAt('/signin');

    // Re-offering the providers to somebody who is signed in reads as though
    // their last attempt failed.
    expect(screen.getByText('someone@example.test')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'auth.signIn.continueWith Google' }),
    ).not.toBeInTheDocument();
  });

  it('withholds both states until the stored session has been read', () => {
    mockedUseAuth.mockReturnValue(authState({ isResolved: false }));

    renderAt('/signin');

    // A "Signed in as" that flips to a provider list, or the reverse, is worse
    // than a beat of nothing.
    expect(screen.queryByText('auth.signIn.continue')).not.toBeInTheDocument();
  });
});

// ============================================================================
// ?next=
// ============================================================================

describe('the ?next= destination', () => {
  it('sends the user on to an in-app path', () => {
    mockedUseAuth.mockReturnValue(SIGNED_IN);

    renderAt('/signin?next=/settings');

    expect(screen.getByRole('link', { name: 'auth.signIn.continue' })).toHaveAttribute(
      'href',
      '/settings',
    );
  });

  it('falls back to the trip list when it is absent', () => {
    mockedUseAuth.mockReturnValue(SIGNED_IN);

    renderAt('/signin');

    expect(screen.getByRole('link', { name: 'auth.signIn.continue' })).toHaveAttribute(
      'href',
      '/trips',
    );
  });

  it.each([
    ['//evil.example/phish', 'a protocol-relative URL that leaves the site'],
    ['https://evil.example', 'an absolute URL'],
    ['javascript:alert(1)', 'a script scheme'],
    ['settings', 'a relative path that would resolve against the current route'],
  ])('refuses %s — %s', (next) => {
    mockedUseAuth.mockReturnValue(SIGNED_IN);

    renderAt(`/signin?next=${encodeURIComponent(next)}`);

    // Discarded rather than sanitised into something half-trusted: this value
    // is attacker-supplied, and `navigate()` follows `//host` off-site.
    expect(screen.getByRole('link', { name: 'auth.signIn.continue' })).toHaveAttribute(
      'href',
      '/trips',
    );
  });
});
