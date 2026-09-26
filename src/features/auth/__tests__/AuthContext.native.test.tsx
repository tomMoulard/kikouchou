/**
 * @fileoverview The auth provider's store-app half, and account deletion.
 *
 * Inside the iOS and Android apps the provider does not redirect the page: the
 * sign-in runs in a system browser sheet and comes back as a link. And both
 * stores require that an account can be deleted from the app.
 *
 * @module features/auth/__tests__/AuthContext.native.test
 */

import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// ============================================================================
// Test doubles
// ============================================================================

const doubles = vi.hoisted(() => ({
  platform: 'ios' as string,
  capture: vi.fn(),
  reportError: vi.fn(),
  runNativeOAuth: vi.fn(async () => ({ status: 'returned' as string, message: null as string | null })),
  forgetAccountTrips: vi.fn(async () => undefined),
  callbackListener: undefined as ((callback: { code: string | null; error: string | null }) => void) | undefined,
  getClient: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => doubles.platform, isPluginAvailable: () => true },
}));
vi.mock('@/lib/posthog', () => ({
  reportError: doubles.reportError,
  default: { identify: vi.fn(), register: vi.fn(), capture: doubles.capture },
  captureEvent: doubles.capture,
  resetAnalyticsIdentity: vi.fn(),
}));
vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: doubles.getClient,
  isSupabaseConfigured: () => true,
}));
vi.mock('@/lib/supabase/auth-callback', () => ({
  consumeAuthCode: () => null,
  getCapturedAuthError: () => null,
  onAuthCallback: (listener: (callback: { code: string | null; error: string | null }) => void) => {
    doubles.callbackListener = listener;
    return () => {
      doubles.callbackListener = undefined;
    };
  },
}));
vi.mock('@/lib/native/oauth', () => ({ runNativeOAuth: doubles.runNativeOAuth }));
vi.mock('@/lib/sync/remote-trip', () => ({ forgetAccountTrips: doubles.forgetAccountTrips }));

import { AuthProvider, useAuth } from '@/features/auth/AuthContext';
import { installTestLocalStorage } from '@/test/utils';

const SESSION = {
  access_token: 'token',
  user: {
    id: 'user-1',
    email: 'someone@example.test',
    user_metadata: {},
    app_metadata: { provider: 'google' },
    created_at: '2026-01-02T03:04:05.000Z',
  },
};

type Handler = (event: string, session: unknown) => void;

function makeClient() {
  let handler: Handler = () => undefined;
  return {
    auth: {
      onAuthStateChange: vi.fn((next: Handler) => {
        handler = next;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signInWithOAuth: vi.fn(async () => ({
        data: { url: 'https://ref.supabase.co/auth/v1/authorize?provider=google' },
        error: null,
      })),
      signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      exchangeCodeForSession: vi.fn(async () => ({ data: { session: null }, error: null as { message: string } | null })),
    },
    rpc: vi.fn(async () => ({ data: null, error: null as { message: string } | null })),
    emit: (event: string, session: unknown) => handler(event, session),
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

async function mount(client: ReturnType<typeof makeClient>) {
  doubles.getClient.mockResolvedValue(client);
  const hook = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(client.auth.onAuthStateChange).toHaveBeenCalled());
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  doubles.platform = 'ios';
  doubles.runNativeOAuth.mockResolvedValue({ status: 'returned', message: null });
  installTestLocalStorage();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ============================================================================
// Tests
// ============================================================================

describe('signing in from a store app', () => {
  it('opens the provider in a browser sheet and returns to the app scheme', async () => {
    const client = makeClient();
    const { result } = await mount(client);

    await expect(result.current.signInWithProvider('google')).resolves.toEqual({
      status: 'signed-in',
    });

    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'app.kikouchou://auth/callback', skipBrowserRedirect: true },
    });
    expect(doubles.runNativeOAuth).toHaveBeenCalledWith(
      'https://ref.supabase.co/auth/v1/authorize?provider=google',
    );
  });

  it('counts a closed sheet as cancelled, not as an error', async () => {
    doubles.runNativeOAuth.mockResolvedValue({ status: 'cancelled', message: null });
    const { result } = await mount(makeClient());

    await expect(result.current.signInWithProvider('google')).resolves.toEqual({
      status: 'cancelled',
    });
    expect(doubles.capture).toHaveBeenCalledWith('sign_in_failed', {
      method: 'oauth',
      reason: 'cancelled',
    });
    await waitFor(() => expect(result.current.isSigningIn).toBe(false));
  });

  it("passes the provider's refusal on, or an empty message for the caller to fill", async () => {
    const { result } = await mount(makeClient());

    doubles.runNativeOAuth.mockResolvedValueOnce({ status: 'refused', message: 'Denied' });
    await expect(result.current.signInWithProvider('google')).resolves.toEqual({
      status: 'error',
      message: 'Denied',
    });

    doubles.runNativeOAuth.mockResolvedValueOnce({ status: 'refused', message: null });
    await expect(result.current.signInWithProvider('google')).resolves.toEqual({
      status: 'error',
      message: '',
    });
  });

  it('sends a magic link back to the website path the app claims', async () => {
    const client = makeClient();
    const { result } = await mount(client);

    await result.current.signInWithEmailLink('someone@example.test');

    expect(client.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'someone@example.test',
      options: { emailRedirectTo: 'https://app.kikouchou.app/auth/native' },
    });
  });

  it('exchanges a code that arrives as a link', async () => {
    const client = makeClient();
    await mount(client);

    doubles.callbackListener?.({ code: 'from-the-sheet', error: null });

    await waitFor(() =>
      expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith('from-the-sheet'),
    );
  });

  it('shows the error a link brought back, and one the exchange raised', async () => {
    const client = makeClient();
    const { result } = await mount(client);

    doubles.callbackListener?.({ code: null, error: 'access_denied' });
    await waitFor(() => expect(result.current.lastAuthError).toBe('access_denied'));

    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    client.auth.exchangeCodeForSession.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'code verifier not found' },
    });
    doubles.callbackListener?.({ code: 'spent', error: null });
    await waitFor(() => expect(result.current.lastAuthError).toBe('code verifier not found'));
  });

  it('keeps the website on its own origin and a real redirect', async () => {
    doubles.platform = 'web';
    const client = makeClient();
    const { result } = await mount(client);

    await expect(result.current.signInWithProvider('google')).resolves.toEqual({
      status: 'redirecting',
    });
    expect(doubles.runNativeOAuth).not.toHaveBeenCalled();
    const [options] = client.auth.signInWithOAuth.mock.calls[0] as unknown as [
      { options: { redirectTo: string; skipBrowserRedirect: boolean } },
    ];
    expect(options.options.redirectTo).toBe(`${window.location.origin}/`);
    expect(options.options.skipBrowserRedirect).toBe(false);
  });
});

describe('deleteAccount', () => {
  it('deletes the account, unlinks this device, and signs out', async () => {
    const client = makeClient();
    const { result } = await mount(client);
    client.emit('INITIAL_SESSION', SESSION);
    await waitFor(() => expect(result.current.user).not.toBeNull());

    await expect(result.current.deleteAccount()).resolves.toBe(true);

    expect(client.rpc).toHaveBeenCalledWith('delete_my_account');
    expect(doubles.forgetAccountTrips).toHaveBeenCalledWith('user-1');
    expect(doubles.capture).toHaveBeenCalledWith('account_deleted');
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    await waitFor(() => expect(result.current.session).toBeNull());
  });

  it('touches nothing when the server refuses', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = makeClient();
    client.rpc.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    const { result } = await mount(client);
    client.emit('INITIAL_SESSION', SESSION);
    await waitFor(() => expect(result.current.user).not.toBeNull());

    await expect(result.current.deleteAccount()).resolves.toBe(false);

    expect(doubles.forgetAccountTrips).not.toHaveBeenCalled();
    expect(client.auth.signOut).not.toHaveBeenCalled();
    expect(result.current.user).not.toBeNull();
  });

  it('still signs out when unlinking the local trips fails', async () => {
    doubles.forgetAccountTrips.mockRejectedValueOnce(new Error('IndexedDB closed'));
    const client = makeClient();
    const { result } = await mount(client);
    client.emit('INITIAL_SESSION', SESSION);
    await waitFor(() => expect(result.current.user).not.toBeNull());

    await expect(result.current.deleteAccount()).resolves.toBe(true);

    expect(doubles.reportError).toHaveBeenCalled();
    expect(client.auth.signOut).toHaveBeenCalled();
  });

  it('does nothing without a session', async () => {
    const client = makeClient();
    const { result } = await mount(client);

    await expect(result.current.deleteAccount()).resolves.toBe(false);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
