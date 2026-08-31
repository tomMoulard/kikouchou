/**
 * @fileoverview Authentication state for the app.
 *
 * The rule this provider exists to enforce: **rendering never waits on auth.**
 * A trip is created, edited and read with no account and no network, so an
 * unresolved session must look like "signed out", not like "loading". Any
 * spinner here would put a network round trip in front of a cold launch on a
 * train — which is the situation the app is for.
 *
 * Consequences, all deliberate:
 *
 * - There is no `isLoading` gate around `children`. The provider renders them
 *   immediately and the session arrives later, which is safe because nothing in
 *   the app *requires* a session to work.
 * - `session` starts `null` and becomes non-null once `supabase-js` has read
 *   `localStorage` and, if the URL carries a PKCE code, exchanged it. Callers
 *   that must distinguish "definitely signed out" from "not known yet" read
 *   `isResolved`.
 * - With no backend configured, this is a permanently signed-out provider that
 *   never touches the network. That is the local-only mode, not an error.
 * - `supabase-js` is imported dynamically, so the ~218 kB library stays off the
 *   cold-launch critical path. The client therefore arrives a tick after mount,
 *   which is invisible precisely *because* nothing waits on the session.
 *   `isAvailable` does not wait for it: it reads the environment synchronously,
 *   so the UI can decide whether to offer sign-in on the very first render.
 *
 * @module features/auth/AuthContext
 */
/* eslint-disable react-refresh/only-export-components */

import {
  type ReactElement,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';

import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/client';

// ============================================================================
// Type Definitions
// ============================================================================

/** How a sign-in attempt ended, so the caller can show the right message. */
export type SignInOutcome =
  | { readonly status: 'redirecting' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'error'; readonly message: string };

export interface AuthContextValue {
  /** The active session, or `null` when signed out or not yet resolved. */
  readonly session: Session | null;

  /** The signed-in user, or `null`. */
  readonly user: User | null;

  /**
   * Whether the initial session lookup has finished.
   *
   * `false` means "not known yet", **not** "signed out" — but it is never a
   * reason to withhold the UI. Use it only where the distinction changes what
   * you render, e.g. to avoid flashing a "Sign in" button at someone who turns
   * out to be signed in already.
   */
  readonly isResolved: boolean;

  /** Whether a backend is configured. When false, sign-in is not offered. */
  readonly isAvailable: boolean;

  /** Whether a sign-in redirect is in flight. */
  readonly isSigningIn: boolean;

  /**
   * Starts Google sign-in. Navigates away on success, so nothing after the
   * `redirecting` outcome runs in this document.
   */
  readonly signInWithGoogle: () => Promise<SignInOutcome>;

  /** Signs out locally. Safe to call offline: the local session is cleared. */
  readonly signOut: () => Promise<void>;
}

// ============================================================================
// Context
// ============================================================================

const AuthContext = createContext<AuthContextValue | null>(null);
AuthContext.displayName = 'AuthContext';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Where Google should send the user back to.
 *
 * Deliberately the app **root**, not a dedicated callback route: GitHub Pages
 * has no SPA rewrite, so a cold load of `/kikoushou/auth/callback` would 404
 * before the service worker exists. The root is a real file on every target, and
 * `detectSessionInUrl` picks the `?code=` off whatever URL it lands on.
 *
 * Read from `window` here — a component may, unlike anything under `lib/`.
 */
function resolveRedirectTo(): string {
  const { origin } = window.location;
  const base = import.meta.env.BASE_URL || '/';
  return `${origin}${base.endsWith('/') ? base : `${base}/`}`;
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// ============================================================================
// Provider
// ============================================================================

export function AuthProvider({
  children,
}: {
  readonly children: ReactNode;
}): ReactElement {
  const [session, setSession] = useState<Session | null>(null);
  const [hasSeenAuthEvent, setHasSeenAuthEvent] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const isMountedRef = useRef(true);

  // Environment-only, so it is correct on the first render — before the client
  // module has loaded. Whether a backend exists cannot change at runtime.
  const isAvailable = useMemo(() => isSupabaseConfigured(), []);

  // Derived, not stored. With no backend there is nothing to wait for, so the
  // session is resolved from the first render — which also keeps this out of an
  // effect, where setting it would cause a cascading render.
  const isResolved = !isAvailable || hasSeenAuthEvent;

  useEffect(() => {
    // Set on setup, not only in cleanup. StrictMode's dev-time
    // mount -> cleanup -> mount cycle would otherwise latch this false forever,
    // turning every guarded setState below into a silent no-op.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isAvailable) {
      // No backend: permanently signed out. `isResolved` is already true above,
      // so there is nothing to do here — and nothing loads or hits the network.
      return;
    }

    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    void getSupabaseClient()
      .then((resolvedClient) => {
        // Unmounted while the library was loading: never subscribe at all,
        // rather than subscribing and immediately tearing it down.
        if (cancelled || !resolvedClient || !isMountedRef.current) {
          return;
        }
        setClient(resolvedClient);

        // `onAuthStateChange` fires an INITIAL_SESSION event covering both the
        // stored session and a PKCE code exchanged out of the URL, so
        // subscribing is enough — a separate getSession() would race it and
        // could resolve with a stale null.
        const { data } = resolvedClient.auth.onAuthStateChange(
          (_event, nextSession) => {
            if (!isMountedRef.current) {
              return;
            }
            setSession(nextSession);
            setHasSeenAuthEvent(true);
            setIsSigningIn(false);
          },
        );
        unsubscribe = () => data.subscription.unsubscribe();
      })
      .catch((error: unknown) => {
        // A chunk that will not load — offline on a cold launch, or a stale
        // service worker. Sign-in is unavailable; everything else is unaffected.
        console.error('[auth] failed to load the Supabase client:', error);
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [isAvailable]);

  const signInWithGoogle = useCallback(async (): Promise<SignInOutcome> => {
    if (!isAvailable) {
      return { status: 'unavailable' };
    }

    setIsSigningIn(true);
    try {
      // Usually already resolved by the mount effect; awaited here so a click
      // that lands before the chunk finishes loading still works.
      const activeClient = client ?? (await getSupabaseClient());
      if (!activeClient) {
        if (isMountedRef.current) {
          setIsSigningIn(false);
        }
        return { status: 'unavailable' };
      }

      const { error } = await activeClient.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: resolveRedirectTo() },
      });

      if (error) {
        if (isMountedRef.current) {
          setIsSigningIn(false);
        }
        return { status: 'error', message: error.message };
      }

      // The browser is navigating to Google. Leave `isSigningIn` set so the
      // button stays disabled for the remainder of this document's life.
      return { status: 'redirecting' };
    } catch (error: unknown) {
      // Offline, or the request was blocked: signInWithOAuth rejects rather
      // than returning an error.
      if (isMountedRef.current) {
        setIsSigningIn(false);
      }
      return { status: 'error', message: toMessage(error) };
    }
  }, [client, isAvailable]);

  const signOut = useCallback(async (): Promise<void> => {
    if (!client) {
      return;
    }

    // 'local' scope clears this device's session without calling the server, so
    // signing out works offline. A global sign-out would need the network and
    // would fail exactly when someone wants to hand their phone over.
    try {
      await client.auth.signOut({ scope: 'local' });
    } catch (error: unknown) {
      console.error('[auth] sign-out failed:', error);
    }

    if (isMountedRef.current) {
      setSession(null);
    }
  }, [client]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      isResolved,
      isAvailable,
      isSigningIn,
      signInWithGoogle,
      signOut,
    }),
    [isAvailable, isResolved, isSigningIn, session, signInWithGoogle, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Auth state. Throws outside {@link AuthProvider}, per the repo's context
 * convention — a component silently reading "signed out" because a provider is
 * missing is worse than a crash in development.
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export { AuthContext };
