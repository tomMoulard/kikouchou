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

const mockIdentify = vi.fn();
const mockReset = vi.fn();
const mockRegister = vi.fn();
const mockCapture = vi.fn();
vi.mock('@/lib/posthog', () => ({
  // The real module exports `undefined` without env config, which is the case in
  // tests, so nothing here could observe a call without this.
  default: {
    identify: (...args: unknown[]) => mockIdentify(...args),
    register: (...args: unknown[]) => mockRegister(...args),
    capture: (...args: unknown[]) => mockCapture(...args),
  },
  // Not `posthog.reset()`: the real helper also puts back the super properties
  // that `reset()` wipes. Mocking the named export is what keeps this test
  // honest about which one the provider calls.
  resetAnalyticsIdentity: (...args: unknown[]) => mockReset(...args),
}));

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: vi.fn(),
  isSupabaseConfigured: vi.fn(),
  resetSupabaseClientForTests: vi.fn(),
}));

vi.mock('@/lib/supabase/auth-callback', () => ({
  consumeAuthCode: vi.fn(() => null),
  getCapturedAuthError: vi.fn(() => null),
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
    signInWithOtp: ReturnType<typeof vi.fn>;
    signInWithWeb3: ReturnType<typeof vi.fn>;
    signInWithPasskey: ReturnType<typeof vi.fn>;
    registerPasskey: ReturnType<typeof vi.fn>;
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
 * needs one, and the surface used is a handful of methods wide.
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
      signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
      signInWithWeb3: vi.fn(async () => ({ data: {}, error: null })),
      signInWithPasskey: vi.fn(async () => ({ data: {}, error: null })),
      registerPasskey: vi.fn(async () => ({ data: {}, error: null })),
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
  user: {
    id: 'user-1',
    email: 'someone@example.test',
    user_metadata: {},
    // Both are on every real `User`, and both cross into the person profile:
    // `provider` says how this account gets in, `created_at` is the day it
    // started existing — which is also how a registration is told apart from
    // the thousandth sign-in.
    app_metadata: { provider: 'google' },
    created_at: '2026-01-02T03:04:05.000Z',
  },
};

/** What `identify()` writes once and never overwrites, for the fixture above. */
const SET_ONCE = { signed_up_at: '2026-01-02T03:04:05.000Z' };

/**
 * The sign-in that *is* the registration.
 *
 * GoTrue stamps `last_sign_in_at` at the moment it issues the first session, so
 * on a brand-new account the two timestamps are the same event a beat apart.
 * Both come from the server, which is why the check does not involve the
 * browser's clock.
 */
const REGISTRATION_SESSION = {
  access_token: 'token',
  user: {
    id: 'user-new',
    email: 'new@example.test',
    user_metadata: {},
    app_metadata: { provider: 'google' },
    created_at: '2026-01-02T03:04:05.000Z',
    last_sign_in_at: '2026-01-02T03:04:06.500Z',
  },
};

/** The same account, months later, signing in again. */
const RETURNING_SESSION = {
  ...REGISTRATION_SESSION,
  user: { ...REGISTRATION_SESSION.user, last_sign_in_at: '2026-04-11T09:00:00.000Z' },
};

/** The same session with different provider metadata, for the identify tests. */
function sessionWithMetadata(metadata: Record<string, unknown>): typeof SESSION {
  return { ...SESSION, user: { ...SESSION.user, user_metadata: metadata } };
}

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

/** Waits for the dynamically imported client to be wired up. */
async function waitForSubscription(client: FakeClient): Promise<void> {
  await waitFor(() => {
    expect(client.auth.onAuthStateChange).toHaveBeenCalled();
  });
}

/**
 * Installs an in-memory `localStorage`, the way `chat-storage.test` does.
 *
 * This environment has none at all — `typeof window.localStorage` is
 * `'undefined'` under the suite's jsdom, not merely empty — so the registration
 * guard has nothing to write to and every test would look like a first
 * registration. A fresh store per test is also what keeps them independent: the
 * guard is deliberately durable, so one test recording an account would
 * otherwise silence the event for every test after it.
 */
function installMemoryLocalStorage(): void {
  const store = new Map<string, string>();

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string): string | null => store.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        store.set(key, value);
      },
      removeItem: (key: string): void => {
        store.delete(key);
      },
      clear: (): void => {
        store.clear();
      },
    },
  });
}

beforeEach(() => {
  installMemoryLocalStorage();
  mockedGetClient.mockReset();
  mockedIsConfigured.mockReset();
  mockedCapturedCode.mockReset();
  mockedCapturedCode.mockReturnValue(null);
  mockedCapturedError.mockReset();
  mockedCapturedError.mockReturnValue(null);
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
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

  it('identifies analytics with the Supabase user id', async () => {
    const client = makeFakeClient();
    withBackend(client);

    renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);

    client.emit('SIGNED_IN', SESSION);

    // The same id on both sides is the point: it is what lets one person's
    // events line up across their devices.
    //
    // The properties are the other half. Identified with the id alone, a person
    // is a bare UUID in PostHog with nothing to match against the `auth.users`
    // row it *is* — which is how a project came to hold 20 people for 3 accounts
    // with no way to tell which was which.
    await waitFor(() => {
      expect(mockIdentify).toHaveBeenCalledWith(
        'user-1',
        {
          supabase_user_id: 'user-1',
          email: 'someone@example.test',
          auth_provider: 'google',
        },
        SET_ONCE,
      );
    });
    expect(mockRegister).toHaveBeenCalledWith({ signed_in: true });
  });

  it("sends the account's display name when the provider supplied one", async () => {
    const client = makeFakeClient();
    withBackend(client);

    renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);

    client.emit('SIGNED_IN', sessionWithMetadata({ full_name: 'Ada Lovelace' }));

    await waitFor(() => {
      expect(mockIdentify).toHaveBeenCalledWith(
        'user-1',
        {
          supabase_user_id: 'user-1',
          email: 'someone@example.test',
          name: 'Ada Lovelace',
          auth_provider: 'google',
        },
        SET_ONCE,
      );
    });
  });

  it('falls back to `name` when the provider sends no `full_name`', async () => {
    const client = makeFakeClient();
    withBackend(client);

    renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);

    // Google sends both; other providers send only one, and `user_metadata` is
    // provider-shaped so neither key is guaranteed.
    client.emit('SIGNED_IN', sessionWithMetadata({ name: 'Ada' }));

    await waitFor(() => {
      expect(mockIdentify).toHaveBeenCalledWith(
        'user-1',
        {
          supabase_user_id: 'user-1',
          email: 'someone@example.test',
          name: 'Ada',
          auth_provider: 'google',
        },
        SET_ONCE,
      );
    });
  });

  it('omits a property rather than sending a blank one', async () => {
    const client = makeFakeClient();
    withBackend(client);

    renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);

    // A non-string `full_name`, no email at all: `identify()` merges into the
    // person profile, so sending an empty or wrongly-typed value would overwrite
    // a good one rather than leave it alone.
    client.emit('SIGNED_IN', {
      access_token: 'token',
      user: { id: 'user-1', user_metadata: { full_name: { given: 'Ada' } } },
    });

    await waitFor(() => {
      expect(mockIdentify).toHaveBeenCalledWith('user-1', { supabase_user_id: 'user-1' }, {});
    });
  });

  it('sends nothing about the account beyond the four allowed properties', async () => {
    const client = makeFakeClient();
    withBackend(client);

    renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);

    // Supabase puts the whole provider payload in `user_metadata`. Only the
    // fields that identify the account may cross into analytics; the rest —
    // avatar URLs, provider ids, phone numbers — must not.
    client.emit(
      'SIGNED_IN',
      sessionWithMetadata({
        full_name: 'Ada Lovelace',
        avatar_url: 'https://example.test/ada.png',
        provider_id: '1234567890',
        phone: '+33123456789',
      }),
    );

    await waitFor(() => {
      expect(mockIdentify).toHaveBeenCalled();
    });
    const properties = mockIdentify.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(Object.keys(properties).sort()).toEqual([
      'auth_provider',
      'email',
      'name',
      'supabase_user_id',
    ]);
  });

  it('writes the signup date once, so a later sign-in cannot move it', async () => {
    const client = makeFakeClient();
    withBackend(client);

    renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);

    client.emit('SIGNED_IN', SESSION);

    await waitFor(() => {
      expect(mockIdentify).toHaveBeenCalled();
    });
    // The third argument is posthog-js's `$set_once` bucket, and `created_at`
    // belongs in it: it is fixed for the life of the account, and it is what
    // separates the sign-in that *was* a registration from the thousandth one.
    // Sent as a plain property it would be rewritten on every sign-in — and on
    // the merge with the anonymous person, where set-once is what stops the
    // pre-account half of the profile clobbering the account's own dates.
    expect(mockIdentify.mock.calls.at(-1)?.[2]).toEqual({
      signed_up_at: '2026-01-02T03:04:05.000Z',
    });
  });

  it('captures account_registered when the sign-in is the registration', async () => {
    const client = makeFakeClient();
    withBackend(client);

    renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);

    client.emit('SIGNED_IN', REGISTRATION_SESSION);

    // Supabase fires the same `SIGNED_IN` for a registration and for the
    // thousandth login, so nothing in the event says which this was. The two
    // server timestamps do: on a new account they are the same moment.
    await waitFor(() => {
      expect(mockCapture).toHaveBeenCalledWith('account_registered', {
        auth_provider: 'google',
      });
    });
  });

  it('does not capture account_registered for a returning sign-in', async () => {
    const client = makeFakeClient();
    withBackend(client);

    renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);

    client.emit('SIGNED_IN', RETURNING_SESSION);

    await waitFor(() => {
      expect(mockIdentify).toHaveBeenCalled();
    });
    expect(mockCapture).not.toHaveBeenCalledWith('account_registered', expect.anything());
  });

  it('captures account_registered once, however often the session is restored', async () => {
    // The trap this guards. `last_sign_in_at` only moves on a *new* sign-in, so
    // for somebody who registers and then stays signed in it sits a beat after
    // `created_at` forever — and every cold load restoring that session would
    // look like a fresh registration to the timestamps alone.
    const first = makeFakeClient();
    withBackend(first);
    const { unmount } = renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(first);
    first.emit('SIGNED_IN', REGISTRATION_SESSION);
    await waitFor(() => {
      expect(mockCapture).toHaveBeenCalledWith('account_registered', {
        auth_provider: 'google',
      });
    });
    unmount();

    const second = makeFakeClient();
    withBackend(second);
    renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(second);
    second.emit('INITIAL_SESSION', REGISTRATION_SESSION);

    await waitFor(() => {
      expect(mockIdentify).toHaveBeenCalledTimes(2);
    });
    const registrations = mockCapture.mock.calls.filter(
      ([event]) => event === 'account_registered',
    );
    expect(registrations).toHaveLength(1);
  });

  it('does not capture account_registered without a last sign-in to compare', async () => {
    const client = makeFakeClient();
    withBackend(client);

    renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);

    // `last_sign_in_at` is optional on `User`. No comparison is possible, and
    // guessing would put a fake registration into the funnel every time.
    client.emit('SIGNED_IN', SESSION);

    await waitFor(() => {
      expect(mockIdentify).toHaveBeenCalled();
    });
    expect(mockCapture).not.toHaveBeenCalledWith('account_registered', expect.anything());
  });

  it('does not re-identify on a token refresh', async () => {
    const client = makeFakeClient();
    withBackend(client);

    renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);

    client.emit('SIGNED_IN', SESSION);
    await waitFor(() => {
      expect(mockIdentify).toHaveBeenCalledTimes(1);
    });

    // This handler runs on every refresh, and Supabase refreshes hourly.
    client.emit('TOKEN_REFRESHED', SESSION);
    client.emit('TOKEN_REFRESHED', SESSION);

    expect(mockIdentify).toHaveBeenCalledTimes(1);
  });

  it('does not reset analytics for a visitor who was never signed in', async () => {
    const client = makeFakeClient();
    withBackend(client);

    renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);

    client.emit('INITIAL_SESSION', null);
    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith({ signed_in: false });
    });

    // `reset()` mints a fresh anonymous id, so calling it on every cold load
    // would give a signed-out visitor a different identity each time and inflate
    // the unique-user count.
    expect(mockReset).not.toHaveBeenCalled();
  });

  it('resets analytics on sign-out, so a shared browser does not inherit an identity', async () => {
    const client = makeFakeClient();
    withBackend(client);

    renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);

    client.emit('SIGNED_IN', SESSION);
    await waitFor(() => {
      expect(mockIdentify).toHaveBeenCalled();
    });

    client.emit('SIGNED_OUT', null);

    await waitFor(() => {
      expect(mockReset).toHaveBeenCalledTimes(1);
    });
  });

  it('puts the signed-out context back after the reset that wipes it', async () => {
    const client = makeFakeClient();
    withBackend(client);

    renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);

    client.emit('SIGNED_IN', SESSION);
    await waitFor(() => {
      expect(mockIdentify).toHaveBeenCalled();
    });

    mockRegister.mockClear();
    client.emit('SIGNED_OUT', null);

    // `reset()` calls `persistence.clear()`, which drops super properties too —
    // so the `signed_in` registered before it is gone by the time it returns.
    // Without re-registering, every later event in this tab carries neither
    // `signed_in` nor `app_version`, and falls out of the breakdowns the whole
    // project is sliced by.
    await waitFor(() => {
      expect(mockReset).toHaveBeenCalled();
    });
    const afterReset = mockRegister.mock.invocationCallOrder.filter(
      (order) => order > mockReset.mock.invocationCallOrder[0]!,
    );
    expect(afterReset.length).toBeGreaterThan(0);
    expect(mockRegister).toHaveBeenLastCalledWith({ signed_in: false });
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

describe('signInWithProvider', () => {
  it('reports unavailable rather than throwing with no backend', async () => {
    withoutBackend();

    const { result } = renderHook(() => useAuth(), { wrapper });
    await expect(result.current.signInWithProvider('google')).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('passes through whatever provider id it is given', async () => {
    const client = makeFakeClient();
    withBackend(client);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);
    // Not in any list in this repo: the ids come from the project's own
    // /auth/v1/settings, so enabling one in the dashboard must reach the API
    // call without an edit here.
    await result.current.signInWithProvider('spotify');

    expect(client.auth.signInWithOAuth.mock.calls[0]?.[0].provider).toBe('spotify');
  });

  it('sends the user back to the app root, not a callback route', async () => {
    const client = makeFakeClient();
    withBackend(client);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);
    await result.current.signInWithProvider('google');

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
    await result.current.signInWithProvider('google');

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

    await expect(result.current.signInWithProvider('google')).resolves.toEqual({
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

    await expect(result.current.signInWithProvider('google')).resolves.toEqual({
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
    await result.current.signInWithProvider('google');

    await waitFor(() => {
      expect(result.current.isSigningIn).toBe(false);
    });
  });

  it('keeps the in-flight flag set while the browser is leaving', async () => {
    const client = makeFakeClient();
    withBackend(client);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);
    await result.current.signInWithProvider('google');

    // The document is being torn down; re-enabling the button would only invite
    // a second click that races the navigation. Read through `waitFor` because
    // the flag is set outside `act`, so the commit trails the resolved promise.
    await waitFor(() => {
      expect(result.current.isSigningIn).toBe(true);
    });
  });
});

// ============================================================================
// Sign in — email
// ============================================================================

describe('signInWithEmailLink', () => {
  it('reports the mail as queued, not as a session', async () => {
    const client = makeFakeClient();
    withBackend(client);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);

    await expect(
      result.current.signInWithEmailLink('someone@example.com'),
    ).resolves.toEqual({ status: 'email-sent' });

    const options = client.auth.signInWithOtp.mock.calls[0]?.[0];
    expect(options.email).toBe('someone@example.com');
    // Same destination as the OAuth redirect, for the same reason.
    expect(String(options.options.emailRedirectTo)).toMatch(/\/$/);
  });

  it('re-enables the form once the mail is away', async () => {
    const client = makeFakeClient();
    withBackend(client);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);
    await result.current.signInWithEmailLink('someone@example.com');

    // Nothing is navigating, so leaving the flag set would strand the form.
    await waitFor(() => {
      expect(result.current.isSigningIn).toBe(false);
    });
  });

  it('surfaces the sender rate limit as a message', async () => {
    const client = makeFakeClient();
    // The built-in sender is capped at two an hour, so this is the error people
    // will actually hit while trying the flow.
    client.auth.signInWithOtp.mockResolvedValue({
      data: {},
      error: { message: 'email rate limit exceeded' },
    });
    withBackend(client);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);

    await expect(
      result.current.signInWithEmailLink('someone@example.com'),
    ).resolves.toEqual({ status: 'error', message: 'email rate limit exceeded' });
  });
});

// ============================================================================
// Sign in — wallet
// ============================================================================

describe('signInWithWallet', () => {
  it('reports a session in hand, with no redirect', async () => {
    const client = makeFakeClient();
    withBackend(client);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);

    await expect(
      result.current.signInWithWallet('solana', 'Sign in to Kikoushou.'),
    ).resolves.toEqual({ status: 'signed-in' });

    expect(client.auth.signInWithWeb3).toHaveBeenCalledWith({
      chain: 'solana',
      statement: 'Sign in to Kikoushou.',
    });
  });

  it('passes the chain through unchanged', async () => {
    const client = makeFakeClient();
    withBackend(client);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);
    await result.current.signInWithWallet('ethereum', 'Sign in to Kikoushou.');

    expect(client.auth.signInWithWeb3.mock.calls[0]?.[0].chain).toBe('ethereum');
  });

  it('treats a dismissed wallet prompt as an ordinary error', async () => {
    const client = makeFakeClient();
    // Wallets throw on rejection rather than returning an error.
    client.auth.signInWithWeb3.mockRejectedValue(new Error('User rejected the request'));
    withBackend(client);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);

    await expect(
      result.current.signInWithWallet('solana', 'Sign in to Kikoushou.'),
    ).resolves.toEqual({ status: 'error', message: 'User rejected the request' });

    // Nothing navigated, so the buttons have to come back.
    await waitFor(() => {
      expect(result.current.isSigningIn).toBe(false);
    });
  });
});

// ============================================================================
// Sign in — passkey
// ============================================================================

describe('signInWithPasskey', () => {
  it('reports a session in hand, with no redirect', async () => {
    const client = makeFakeClient();
    withBackend(client);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);

    await expect(result.current.signInWithPasskey()).resolves.toEqual({
      status: 'signed-in',
    });
    expect(client.auth.signInWithPasskey).toHaveBeenCalledTimes(1);
  });

  it('treats a cancelled prompt as an ordinary error', async () => {
    const client = makeFakeClient();
    client.auth.signInWithPasskey.mockResolvedValue({
      data: null,
      error: { message: 'The operation either timed out or was not allowed' },
    });
    withBackend(client);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);

    await expect(result.current.signInWithPasskey()).resolves.toEqual({
      status: 'error',
      message: 'The operation either timed out or was not allowed',
    });
  });

  it('survives the experimental flag being off, which throws', async () => {
    const client = makeFakeClient();
    // `@supabase/auth-js` throws rather than returning an error when
    // `experimental.passkey` is not set — see lib/supabase/client.
    client.auth.signInWithPasskey.mockRejectedValue(
      new Error('passkey support is not enabled'),
    );
    withBackend(client);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);

    await expect(result.current.signInWithPasskey()).resolves.toEqual({
      status: 'error',
      message: 'passkey support is not enabled',
    });
  });
});

// ============================================================================
// Passkey enrolment
// ============================================================================

describe('registerPasskey', () => {
  it('reports the passkey as enrolled', async () => {
    const client = makeFakeClient();
    withBackend(client);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);

    await expect(result.current.registerPasskey()).resolves.toEqual({
      status: 'enrolled',
    });
  });

  it('leaves the sign-in flag alone, since nobody is signing in', async () => {
    const client = makeFakeClient();
    withBackend(client);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);
    await result.current.registerPasskey();

    // Enrolment happens on the Settings page. Flipping `isSigningIn` would
    // disable a sign-in surface that is not even mounted.
    expect(result.current.isSigningIn).toBe(false);
  });

  it('reports unavailable with no backend rather than throwing', async () => {
    withoutBackend();

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(result.current.registerPasskey()).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('surfaces a refused ceremony', async () => {
    const client = makeFakeClient();
    client.auth.registerPasskey.mockRejectedValue(
      new Error('The operation either timed out or was not allowed'),
    );
    withBackend(client);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitForSubscription(client);

    await expect(result.current.registerPasskey()).resolves.toEqual({
      status: 'error',
      message: 'The operation either timed out or was not allowed',
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
