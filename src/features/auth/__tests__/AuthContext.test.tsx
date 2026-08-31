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
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/client';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: vi.fn(),
  isSupabaseConfigured: vi.fn(),
  resetSupabaseClientForTests: vi.fn(),
}));

const mockedGetClient = vi.mocked(getSupabaseClient);
const mockedIsConfigured = vi.mocked(isSupabaseConfigured);

type AuthChangeHandler = (event: string, session: unknown) => void;

interface FakeClient {
  readonly auth: {
    onAuthStateChange: ReturnType<typeof vi.fn>;
    signInWithOAuth: ReturnType<typeof vi.fn>;
    signOut: ReturnType<typeof vi.fn>;
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

  it('subscribes once rather than also calling getSession', async () => {
    const client = makeFakeClient();
    withBackend(client);

    renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);

    // onAuthStateChange already fires INITIAL_SESSION for both a stored session
    // and a PKCE code in the URL. A parallel getSession() would race it and
    // could resolve with a stale null.
    expect(client.auth.onAuthStateChange).toHaveBeenCalledTimes(1);
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
