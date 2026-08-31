/**
 * AuthContext tests.
 *
 * The rule worth defending here is the offline-first one: **rendering never
 * waits on auth.** Several of these assert that children are on screen before —
 * and regardless of whether — a session resolves, because a spinner in this
 * provider would put a network round trip in front of a cold launch with no
 * connection, which is the situation the app exists for.
 *
 * `supabase-js` is loaded dynamically, so the client arrives a tick after mount.
 * That is why `isAvailable` comes from `isSupabaseConfigured()` (environment
 * only, synchronous) while the client itself is awaited.
 *
 * @module features/auth/__tests__/AuthContext.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { AuthProvider, useAuth } from '@/features/auth/AuthContext';
import {
  consumeAuthCode,
  getCapturedAuthError,
} from '@/lib/supabase/auth-callback';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/client';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: vi.fn(),
  isSupabaseConfigured: vi.fn(),
  resetSupabaseClientForTests: vi.fn(),
}));

vi.mock('@/lib/supabase/auth-callback', () => ({
  consumeAuthCode: vi.fn(() => null),
  getCapturedAuthError: vi.fn(() => null),
  hasCapturedAuthCode: vi.fn(() => false),
  isAuthCallback: vi.fn(() => false),
  resetAuthCallbackForTests: vi.fn(),
}));

const mockedGetClient = vi.mocked(getSupabaseClient);
const mockedIsConfigured = vi.mocked(isSupabaseConfigured);
const mockedCapturedCode = vi.mocked(consumeAuthCode);
const mockedCapturedError = vi.mocked(getCapturedAuthError);

type AuthChangeHandler = (event: string, session: unknown) => void;

interface FakeClient {
  readonly auth: {
    onAuthStateChange: ReturnType<typeof vi.fn>;
    signInWithOAuth: ReturnType<typeof vi.fn>;
    signOut: ReturnType<typeof vi.fn>;
    getSession: ReturnType<typeof vi.fn>;
    exchangeCodeForSession: ReturnType<typeof vi.fn>;
  };
  readonly unsubscribe: ReturnType<typeof vi.fn>;
  /** Drives the subscribed handler the way supabase-js would. */
  emit: AuthChangeHandler;
}

/**
 * A Supabase client stand-in.
 *
 * Hand-rolled rather than generated: this is the only place in the repo that
 * needs one, and the surface used is three methods wide.
 */
function makeFakeClient(): FakeClient {
  let handler: AuthChangeHandler = () => undefined;
  const unsubscribe = vi.fn();

  return {
    auth: {
      onAuthStateChange: vi.fn((next: AuthChangeHandler) => {
        handler = next;
        return { data: { subscription: { unsubscribe } } };
      }),
      signInWithOAuth: vi.fn(async () => ({ data: {}, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      exchangeCodeForSession: vi.fn(async () => ({
        data: { session: null },
        error: null,
      })),
    },
    unsubscribe,
    emit: (event, session) => {
      handler(event, session);
    },
  };
}

/** Configures a backend whose client resolves on the next microtask. */
function withBackend(client: FakeClient): void {
  mockedIsConfigured.mockReturnValue(true);
  mockedGetClient.mockResolvedValue(client as never);
}

/** Configures no backend at all — the local-only mode. */
function withoutBackend(): void {
  mockedIsConfigured.mockReturnValue(false);
  mockedGetClient.mockResolvedValue(null);
}

const SESSION = {
  access_token: 'token',
  user: { id: 'user-1', email: 'someone@example.test', user_metadata: {} },
};

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

/** Waits for the dynamically imported client to be wired up. */
async function waitForSubscription(client: FakeClient): Promise<void> {
  await waitFor(() => {
    expect(client.auth.onAuthStateChange).toHaveBeenCalled();
  });
}

beforeEach(() => {
  mockedGetClient.mockReset();
  mockedIsConfigured.mockReset();
  mockedCapturedCode.mockReset();
  mockedCapturedCode.mockReturnValue(null);
  mockedCapturedError.mockReset();
  mockedCapturedError.mockReturnValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ============================================================================
// Rendering is never gated
// ============================================================================

describe('AuthProvider — rendering', () => {
  it('renders children immediately while the session is unresolved', () => {
    withBackend(makeFakeClient());

    render(
      <AuthProvider>
        <p>trip planner</p>
      </AuthProvider>,
    );

    // Synchronously, on the first render: the client has not even loaded yet.
    expect(screen.getByText('trip planner')).toBeInTheDocument();
  });

  it('renders children with no backend configured at all', () => {
    withoutBackend();

    render(
      <AuthProvider>
        <p>trip planner</p>
      </AuthProvider>,
    );

    expect(screen.getByText('trip planner')).toBeInTheDocument();
  });

  it('does not load the client library when no backend is configured', () => {
    withoutBackend();

    renderHook(() => useAuth(), { wrapper });

    // The ~218 kB chunk must not be fetched in local-only mode.
    expect(mockedGetClient).not.toHaveBeenCalled();
  });
});

// ============================================================================
// State
// ============================================================================

describe('AuthProvider — state', () => {
  it('reports resolved and unavailable with no backend', () => {
    withoutBackend();

    const { result } = renderHook(() => useAuth(), { wrapper });

    // Resolved immediately: an indeterminate state it would never leave is
    // worse than a definite "signed out".
    expect(result.current.isResolved).toBe(true);
    expect(result.current.isAvailable).toBe(false);
    expect(result.current.session).toBeNull();
    expect(result.current.user).toBeNull();
  });

  it('reports available on the first render, before the client loads', () => {
    withBackend(makeFakeClient());

    const { result } = renderHook(() => useAuth(), { wrapper });

    // Read from the environment, not from the client, so the UI can decide
    // whether to offer sign-in without waiting on a dynamic import.
    expect(result.current.isAvailable).toBe(true);
    expect(result.current.isResolved).toBe(false);
    expect(result.current.session).toBeNull();
  });

  it('resolves signed-out when the initial event carries no session', async () => {
    const client = makeFakeClient();
    withBackend(client);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);
    client.emit('INITIAL_SESSION', null);

    await waitFor(() => {
      expect(result.current.isResolved).toBe(true);
    });
    expect(result.current.session).toBeNull();
  });

  it('exposes the user once a session arrives', async () => {
    const client = makeFakeClient();
    withBackend(client);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);
    client.emit('INITIAL_SESSION', SESSION);

    await waitFor(() => {
      expect(result.current.user?.id).toBe('user-1');
    });
    expect(result.current.isResolved).toBe(true);
  });

  it('subscribes once, and reads the persisted session as a fallback', async () => {
    const client = makeFakeClient();
    withBackend(client);

    renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);

    expect(client.auth.onAuthStateChange).toHaveBeenCalledTimes(1);

    // An earlier version relied on INITIAL_SESSION alone, reasoning that a
    // parallel getSession() could race it with a stale null. That was wrong in
    // the direction that matters: if the single event ever reports null, the UI
    // is stranded signed-out forever with no second chance. getSession is a
    // backstop, and a null from it never overrides a session already in hand.
    await waitFor(() => {
      expect(client.auth.getSession).toHaveBeenCalled();
    });
  });

  it('does not let the fallback overwrite a session already received', async () => {
    const client = makeFakeClient();
    // The event lands first with a real session; getSession answers later, null.
    let releaseGetSession: (value: unknown) => void = () => undefined;
    client.auth.getSession.mockReturnValue(
      new Promise((resolve) => {
        releaseGetSession = resolve;
      }),
    );
    withBackend(client);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);
    client.emit('SIGNED_IN', SESSION);
    await waitFor(() => {
      expect(result.current.user?.id).toBe('user-1');
    });

    releaseGetSession({ data: { session: null }, error: null });

    // Still signed in: the stale null must lose.
    await waitFor(() => {
      expect(result.current.user?.id).toBe('user-1');
    });
  });

  it('unsubscribes on unmount', async () => {
    const client = makeFakeClient();
    withBackend(client);

    const { unmount } = renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);

    unmount();

    expect(client.unsubscribe).toHaveBeenCalled();
  });

  it('never subscribes when unmounted before the client finished loading', async () => {
    const client = makeFakeClient();
    let release: (value: unknown) => void = () => undefined;
    mockedIsConfigured.mockReturnValue(true);
    mockedGetClient.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }) as never,
    );

    const { unmount } = renderHook(() => useAuth(), { wrapper });
    unmount();
    // The dynamic import lands after the component is gone.
    release(client);
    await Promise.resolve();

    // Not subscribed-then-torn-down: never subscribed. A listener created after
    // unmount would hold the doc and fire setState into a dead component.
    expect(client.auth.onAuthStateChange).not.toHaveBeenCalled();
    expect(client.unsubscribe).not.toHaveBeenCalled();
  });

  it('survives the client chunk failing to load', async () => {
    mockedIsConfigured.mockReturnValue(true);
    mockedGetClient.mockRejectedValue(new Error('chunk load failed'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { result } = renderHook(() => useAuth(), { wrapper });

    // Offline on a cold launch, or a stale service worker. Sign-in is
    // unavailable; nothing else about the app is affected.
    await waitFor(() => {
      expect(consoleError).toHaveBeenCalled();
    });
    expect(result.current.session).toBeNull();
    consoleError.mockRestore();
  });

  it('throws when used outside the provider', () => {
    withoutBackend();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => renderHook(() => useAuth())).toThrow(
      /useAuth must be used within an AuthProvider/,
    );

    consoleError.mockRestore();
  });
});

// ============================================================================
// The OAuth callback
// ============================================================================

describe('AuthProvider — returning from the provider', () => {
  it('exchanges a captured authorization code', async () => {
    const client = makeFakeClient();
    withBackend(client);
    mockedCapturedCode.mockReturnValue('auth-code-123');

    renderHook(() => useAuth(), { wrapper });

    // The code is captured synchronously at import, because the client is built
    // lazily in an effect long after the router may have normalised the URL.
    // Letting supabase-js find it via detectSessionInUrl left sign-in silently
    // failing: the user existed server-side but the app stayed signed out.
    await waitFor(() => {
      expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith('auth-code-123');
    });
  });

  it('subscribes before exchanging, so the resulting event is not missed', async () => {
    const client = makeFakeClient();
    withBackend(client);
    mockedCapturedCode.mockReturnValue('auth-code-123');

    renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(client.auth.exchangeCodeForSession).toHaveBeenCalled();
    });
    const subscribeOrder = client.auth.onAuthStateChange.mock.invocationCallOrder[0]!;
    const exchangeOrder = client.auth.exchangeCodeForSession.mock.invocationCallOrder[0]!;
    expect(subscribeOrder).toBeLessThan(exchangeOrder);
  });

  it('does not read the persisted session when exchanging a code', async () => {
    const client = makeFakeClient();
    withBackend(client);
    mockedCapturedCode.mockReturnValue('auth-code-123');

    renderHook(() => useAuth(), { wrapper });
    await waitFor(() => {
      expect(client.auth.exchangeCodeForSession).toHaveBeenCalled();
    });

    // The exchange produces the session through the subscription; a getSession
    // racing it could read the pre-exchange null.
    expect(client.auth.getSession).not.toHaveBeenCalled();
  });

  it('surfaces a failed exchange instead of sitting on a spinner', async () => {
    const client = makeFakeClient();
    client.auth.exchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'invalid request: both auth code and code verifier should be non-empty' },
    });
    withBackend(client);
    mockedCapturedCode.mockReturnValue('auth-code-123');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.lastAuthError).toMatch(/code verifier/);
    });
    consoleError.mockRestore();
  });

  it("surfaces the provider's own error, e.g. a cancelled consent screen", async () => {
    const client = makeFakeClient();
    withBackend(client);
    mockedCapturedError.mockReturnValue('access_denied');

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.lastAuthError).toBe('access_denied');
    });
  });
});

// ============================================================================
// Sign in
// ============================================================================

describe('signInWithGoogle', () => {
  it('reports unavailable rather than throwing with no backend', async () => {
    withoutBackend();

    const { result } = renderHook(() => useAuth(), { wrapper });
    await expect(result.current.signInWithGoogle()).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('sends the user back to the app root, not a callback route', async () => {
    const client = makeFakeClient();
    withBackend(client);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);
    await result.current.signInWithGoogle();

    const options = client.auth.signInWithOAuth.mock.calls[0]?.[0];
    expect(options.provider).toBe('google');
    // GitHub Pages has no SPA rewrite, so a cold load of a deep callback path
    // would 404 before the service worker exists. The root always resolves.
    expect(String(options.options.redirectTo)).toMatch(/\/$/);
    expect(String(options.options.redirectTo)).not.toContain('callback');
  });

  it('works when clicked before the client chunk has loaded', async () => {
    const client = makeFakeClient();
    withBackend(client);

    const { result } = renderHook(() => useAuth(), { wrapper });
    // Deliberately no waitForSubscription: the click races the dynamic import.
    await result.current.signInWithGoogle();

    expect(client.auth.signInWithOAuth).toHaveBeenCalledTimes(1);
  });

  it('surfaces a provider error as a message', async () => {
    const client = makeFakeClient();
    client.auth.signInWithOAuth.mockResolvedValue({
      data: {},
      error: { message: 'provider disabled' },
    });
    withBackend(client);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);

    await expect(result.current.signInWithGoogle()).resolves.toEqual({
      status: 'error',
      message: 'provider disabled',
    });
  });

  it('surfaces a rejection — the offline case — as a message', async () => {
    const client = makeFakeClient();
    // signInWithOAuth rejects rather than resolving when the fetch itself fails.
    client.auth.signInWithOAuth.mockRejectedValue(new Error('Failed to fetch'));
    withBackend(client);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);

    await expect(result.current.signInWithGoogle()).resolves.toEqual({
      status: 'error',
      message: 'Failed to fetch',
    });
  });

  it('clears the in-flight flag after a failure so the button re-enables', async () => {
    const client = makeFakeClient();
    client.auth.signInWithOAuth.mockRejectedValue(new Error('Failed to fetch'));
    withBackend(client);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);
    await result.current.signInWithGoogle();

    await waitFor(() => {
      expect(result.current.isSigningIn).toBe(false);
    });
  });
});

// ============================================================================
// Sign out
// ============================================================================

describe('signOut', () => {
  it('clears the session locally so it works offline', async () => {
    const client = makeFakeClient();
    withBackend(client);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);
    client.emit('INITIAL_SESSION', SESSION);
    await waitFor(() => {
      expect(result.current.user).not.toBeNull();
    });

    await result.current.signOut();

    // 'local' scope skips the server call. A global sign-out would need the
    // network and fail exactly when someone wants to hand their phone over.
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    await waitFor(() => {
      expect(result.current.session).toBeNull();
    });
  });

  it('still clears the session when the sign-out call fails', async () => {
    const client = makeFakeClient();
    client.auth.signOut.mockRejectedValue(new Error('offline'));
    withBackend(client);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);
    client.emit('INITIAL_SESSION', SESSION);
    await waitFor(() => {
      expect(result.current.user).not.toBeNull();
    });

    await result.current.signOut();

    // Leaving someone apparently signed in after they asked to sign out is the
    // worse failure.
    await waitFor(() => {
      expect(result.current.session).toBeNull();
    });
    consoleError.mockRestore();
  });

  it('is a no-op with no backend', async () => {
    withoutBackend();

    const { result } = renderHook(() => useAuth(), { wrapper });
    await expect(result.current.signOut()).resolves.toBeUndefined();
  });
});
