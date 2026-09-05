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
 * What this provider does **not** know is *which* ways in the project accepts.
 * That is asked of the backend when a sign-in surface opens — see
 * `lib/supabase/auth-settings` — so enabling a provider in the Supabase
 * dashboard needs no change here. The methods below are therefore shaped by
 * mechanism (a redirect, an emailed link, a wallet signature, a passkey)
 * rather than by provider, and `signInWithProvider` takes whatever id the
 * project reported.
 *
 * @module features/auth/AuthContext
 */
/* eslint-disable react-refresh/only-export-components -- The provider, its `useAuth` hook and the context type are one concept; splitting them across three files to please Fast Refresh costs more than the refresh it buys. */

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
import type { Provider, Session, SupabaseClient, User } from '@supabase/supabase-js';

import {
  consumeAuthCode,
  getCapturedAuthError,
} from '@/lib/supabase/auth-callback';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/client';
import posthog, { resetAnalyticsIdentity } from '@/lib/posthog';

import { getAccountDisplayName } from './display-name';
import type { Web3Chain } from './web3';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * How a sign-in attempt ended, so the caller can show the right message.
 *
 * The three success shapes are genuinely different endings and the UI has to
 * tell them apart: `redirecting` means this document is being torn down and
 * anything after it is unreachable; `email-sent` means nothing has happened yet
 * and the user must go and open a mail client; `signed-in` means there is a
 * session *now*, on this page, with no round trip at all.
 */
export type SignInOutcome =
  /** The browser is leaving for the provider. Nothing after this runs. */
  | { readonly status: 'redirecting' }
  /** A magic link is on its way; the session will arrive on a later load. */
  | { readonly status: 'email-sent' }
  /** Signed in without leaving the page — a wallet signature. */
  | { readonly status: 'signed-in' }
  /** No backend in this build, so there was nothing to try. */
  | { readonly status: 'unavailable' }
  | { readonly status: 'error'; readonly message: string };

/**
 * How enrolling a passkey ended.
 *
 * Separate from {@link SignInOutcome} because it is not a sign-in: the user is
 * already signed in, and what changed is that this device can now be the way
 * back in. Reusing `signed-in` for it would have every caller re-checking which
 * of the two things just happened.
 */
export type PasskeyEnrolmentOutcome =
  | { readonly status: 'enrolled' }
  /** No backend, or no session to attach the passkey to. */
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
   * Starts an OAuth redirect for one provider id, as reported by the project's
   * own `/auth/v1/settings` — `'google'`, `'spotify'`, anything enabled later.
   * Navigates away on success, so nothing after the `redirecting` outcome runs
   * in this document.
   */
  readonly signInWithProvider: (providerId: string) => Promise<SignInOutcome>;

  /**
   * Emails a sign-in link. Resolves `email-sent` once the request is accepted —
   * which says the mail was *queued*, not that it arrived.
   */
  readonly signInWithEmailLink: (email: string) => Promise<SignInOutcome>;

  /**
   * Signs in with an injected wallet, via Sign in with Solana / Ethereum.
   *
   * Completes in this document: the wallet prompts, the signature is verified,
   * and the outcome is `signed-in` with a session already in hand.
   *
   * @param chain - Must be one the wallet is actually there for; see
   *   `features/auth/web3`.
   * @param statement - The sentence shown inside the wallet's signing prompt.
   *   User-facing, so it is translated by the caller, and it must contain no
   *   newline — most wallets reject one.
   */
  readonly signInWithWallet: (
    chain: Web3Chain,
    statement: string,
  ) => Promise<SignInOutcome>;

  /**
   * Signs in with a passkey already enrolled for this origin.
   *
   * Completes in this document, like a wallet: the browser prompts for the
   * screen lock or security key and a session follows. Offer it only where
   * `features/auth/passkeys` says the browser can, and where the project
   * reports `passkeys` enabled.
   */
  readonly signInWithPasskey: () => Promise<SignInOutcome>;

  /**
   * Enrols a passkey for the signed-in user, on this device and origin.
   *
   * Sign-in with a passkey is unreachable until somebody has done this once —
   * there is no other way for one to exist — which is why the account panel
   * offers it rather than leaving it to a provider's own screens.
   */
  readonly registerPasskey: () => Promise<PasskeyEnrolmentOutcome>;

  /** Signs out locally. Safe to call offline: the local session is cleared. */
  readonly signOut: () => Promise<void>;

  /**
   * Why the last sign-in attempt did not produce a session.
   *
   * Set when the provider redirected back with an error, or when exchanging the
   * authorization code failed. Without it a failed callback is indistinguishable
   * from never having tried.
   */
  readonly lastAuthError: string | null;
}

// ============================================================================
// Context
// ============================================================================

const AuthContext = createContext<AuthContextValue | null>(null);
AuthContext.displayName = 'AuthContext';

// ============================================================================
// Constants
// ============================================================================

/**
 * How close `last_sign_in_at` must sit to `created_at` for the sign-in to *be*
 * the registration.
 *
 * GoTrue writes both when it issues a new account's first session, so on a real
 * registration they are the same moment give or take the round trip that
 * created the row. Thirty seconds is far wider than that gap and far narrower
 * than any second visit, so the only way to land inside it wrongly is to sign
 * out and back in within half a minute of registering.
 */
const REGISTRATION_WINDOW_MS = 30_000;

/**
 * Prefix of the localStorage key remembering that an account's registration was
 * already reported. Follows the `kikouchou_` convention of the other stored
 * keys.
 */
const REGISTRATION_STORAGE_PREFIX = 'kikouchou_registered_';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Where Google should send the user back to.
 *
 * Deliberately the app **root**, not a dedicated callback route: GitHub Pages
 * has no SPA rewrite, so a cold load of `/auth/callback` would 404
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

/**
 * What PostHog is told about the person it just identified.
 *
 * That person already exists — `lib/posthog` runs `person_profiles: 'always'`,
 * so the visitor has been a person since their first pageview and `identify()`
 * merges that person into the account rather than opening a new one. This is
 * the data the account adds on top of what the anonymous half already knows.
 *
 * Without it an identified person shows up as a bare UUID with no way to line
 * it up against the `auth.users` row it *is* — which is how a project ended up
 * holding 20 people for 3 accounts with nobody able to tell which was which.
 * `email` and `name` are also what PostHog's own person display falls back to,
 * and `auth_provider` is what answers "how does this person get in" when
 * somebody writes in unable to.
 *
 * Deliberately nothing else. The rule for this app is counts and enum values,
 * not user content, and an account's own identity is the one thing `identify()`
 * is for — `auth_provider` is an enum (`google`, `email`, `solana`), not the
 * provider payload around it. Absent fields are omitted rather than sent as
 * `undefined`, so a person profile is never overwritten with a blank.
 */
function toPersonProperties(user: User): Record<string, string> {
  const properties: Record<string, string> = { supabase_user_id: user.id };

  if (user.email !== undefined && user.email !== '') {
    properties['email'] = user.email;
  }

  const name = getAccountDisplayName(user);
  if (name !== undefined) {
    properties['name'] = name;
  }

  // `app_metadata` is provider-shaped and typed as an open record, like
  // `user_metadata` above, so the value is guarded rather than trusted.
  const provider: unknown = user.app_metadata?.['provider'];
  if (typeof provider === 'string' && provider !== '') {
    properties['auth_provider'] = provider;
  }

  return properties;
}

/**
 * What is written the first time and never again.
 *
 * `identify()`'s third argument is posthog-js's `$set_once` bucket, and the
 * account's creation date is exactly what it is for: it cannot change, so
 * rewriting it on each of a person's thousand sign-ins buys nothing — and it is
 * the property that tells the sign-in which *was* a registration apart from all
 * the ones after it, so a cohort by signup week is a person breakdown rather
 * than a search for somebody's first event.
 *
 * Set-once also decides the merge. The anonymous person this call is folding
 * into the account has its own dates; sending the account's as plain properties
 * would let whichever side wrote last win.
 */
function toPersonPropertiesSetOnce(user: User): Record<string, string> {
  const properties: Record<string, string> = {};

  // Required by the `User` type, absent from a hand-built test double and from
  // whatever GoTrue returns next. Guarded for the same reason as the rest.
  if (typeof user.created_at === 'string' && user.created_at !== '') {
    properties['signed_up_at'] = user.created_at;
  }

  return properties;
}

/**
 * Whether this sign-in is the one that created the account.
 *
 * Supabase fires the same `SIGNED_IN` for a registration and for the thousandth
 * login, and there is no field that says which — so the two timestamps are
 * asked instead. Both come from the server, which is why this survives a
 * browser clock that is wrong, and why it is not a comparison against `now`.
 *
 * Every value is guarded: `last_sign_in_at` is optional on `User`, and a
 * missing or unparseable pair means "no idea", which must read as *not* a
 * registration. Guessing here would put a fake signup into the funnel on every
 * sign-in that omitted a field.
 */
function isRegistrationSignIn(user: User): boolean {
  if (typeof user.last_sign_in_at !== 'string' || typeof user.created_at !== 'string') {
    return false;
  }

  const created = Date.parse(user.created_at);
  const signedIn = Date.parse(user.last_sign_in_at);
  if (Number.isNaN(created) || Number.isNaN(signedIn)) {
    return false;
  }

  return signedIn - created < REGISTRATION_WINDOW_MS;
}

/**
 * Whether this browser has already reported that account's registration.
 *
 * The timestamps alone are not enough, and the failure they leave is the
 * expensive kind: `last_sign_in_at` only moves on a *new* sign-in, so for
 * somebody who registers and then simply stays signed in it sits a beat after
 * `created_at` for as long as the session lives. Every cold load restoring that
 * session re-runs the check above and passes it, and the signup count becomes a
 * count of app launches.
 *
 * Storage is the right place for the flag because it shares the fate of the
 * thing it is about: the Supabase session lives in localStorage too, so
 * clearing site data drops both, the next sign-in is a real one, and
 * `last_sign_in_at` moves — the timestamps then say "not a registration" on
 * their own. Read defensively: this suite's jsdom has no `localStorage` at all,
 * and a private window can throw on access.
 */
function hasReportedRegistration(userId: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return window.localStorage.getItem(`${REGISTRATION_STORAGE_PREFIX}${userId}`) !== null;
  } catch {
    // No storage: the event may repeat on a later launch, which is a better
    // failure than throwing inside an auth state change.
    return false;
  }
}

function rememberReportedRegistration(userId: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(`${REGISTRATION_STORAGE_PREFIX}${userId}`, '1');
  } catch {
    // Storage full, or refused. Nothing to do: the capture above already
    // happened and the worst case is a duplicate on the next launch.
  }
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
  /** Set from the async exchange; a callback, so not an effect-body write. */
  const [exchangeError, setExchangeError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  /**
   * Who PostHog currently thinks this browser is, or null for anonymous.
   *
   * Tracked rather than derived because the two calls below must fire on a
   * *transition*, not on every auth event — `onAuthStateChange` also runs on
   * every token refresh and on `INITIAL_SESSION`.
   */
  const identifiedRef = useRef<string | null>(null);

  /**
   * An error the provider redirected back with — usually a cancelled consent
   * screen.
   *
   * Captured at module import and constant for this document, so it is derived
   * rather than stored. Writing it into state from an effect would be a
   * cascading render carrying information that was already available on the
   * first one.
   */
  const providerError = useMemo(() => getCapturedAuthError(), []);

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

    const attach = async (resolvedClient: SupabaseClient): Promise<void> => {
      // Subscribe *before* exchanging, so the SIGNED_IN the exchange produces is
      // observed rather than missed.
      const { data } = resolvedClient.auth.onAuthStateChange((event, nextSession) => {
        if (!isMountedRef.current) {
          return;
        }
        if (import.meta.env.DEV) {
          console.info('[auth] %s, session: %s', event, nextSession ? 'yes' : 'none');
        }
        setSession(nextSession);
        setHasSeenAuthEvent(true);
        setIsSigningIn(false);

        // Tie analytics to the Supabase account, so a person's events line up
        // across their devices and browsers under the same id.
        const nextUser = nextSession?.user ?? null;
        const nextUserId = nextUser?.id ?? null;

        // A super property, so every event — not just the ones fired near here —
        // can be split by whether the person had an account. Most of this app
        // works signed out, so that split is the difference between "nobody uses
        // sharing" and "nobody signs in".
        posthog?.register({ signed_in: nextUserId !== null });

        if (nextUser !== null) {
          // Only on a change. This handler also fires on every token refresh,
          // where re-identifying the same id is pointless churn.
          if (identifiedRef.current !== nextUser.id) {
            // The properties are what make the person recognisable: an id on
            // its own is a UUID nobody can match to an account. This does not
            // create the person — the visitor has been one since their first
            // pageview — it merges that one into the account and enriches it.
            posthog?.identify(
              nextUser.id,
              toPersonProperties(nextUser),
              toPersonPropertiesSetOnce(nextUser),
            );
            identifiedRef.current = nextUser.id;

            // The signup event, and the only place it can be known. Ordered
            // after `identify()` so the event lands on the person it belongs
            // to rather than on the anonymous one being merged away.
            if (isRegistrationSignIn(nextUser) && !hasReportedRegistration(nextUser.id)) {
              rememberReportedRegistration(nextUser.id);
              const provider: unknown = nextUser.app_metadata?.['provider'];
              posthog?.capture(
                'account_registered',
                typeof provider === 'string' && provider !== ''
                  ? { auth_provider: provider }
                  : undefined,
              );
            }
          }
          return;
        }

        // Only on an actual sign-out, never on an initial null session.
        //
        // `reset()` mints a *new* anonymous distinct id, so calling it on every
        // cold load for a signed-out visitor would give them a different
        // identity each time and inflate the unique-user count. Guarding on
        // having previously identified somebody keeps it to the transition that
        // matters — and that transition is what makes a shared browser safe,
        // since without it the next person inherits the last one's identity.
        if (identifiedRef.current !== null) {
          resetAnalyticsIdentity();
          // `reset()` clears every persisted property, super properties
          // included, so the `signed_in` registered a few lines up is gone by
          // the time it returns. Registering it again is what keeps the rest of
          // this session's events attributable to a signed-out visitor rather
          // than to nothing at all. `resetAnalyticsIdentity` restores the
          // properties `lib/posthog` owns; this one is ours.
          posthog?.register({ signed_in: false });
          identifiedRef.current = null;
        }
      });
      unsubscribe = () => data.subscription.unsubscribe();

      // The authorization code, captured synchronously at import before the
      // router could normalise it away. Taken *once*: StrictMode remounts this
      // effect, and a second exchange of the same code fails with "PKCE code
      // verifier not found" because the first one consumed the verifier.
      const code = consumeAuthCode();
      if (code !== null) {
        const { error } = await resolvedClient.auth.exchangeCodeForSession(code);
        if (error && isMountedRef.current) {
          // A spent or mismatched code — a reload of the callback URL, or a
          // verifier lost with the browser's storage.
          console.error('[auth] code exchange failed:', error.message);
          setExchangeError(error.message);
        }
        // Either way the subscription above has the outcome; nothing else to do.
        return;
      }

      // No callback to process, so read whatever session is persisted.
      //
      // This is a fallback, not the primary path, and it exists because relying
      // on a single INITIAL_SESSION event with nothing behind it strands the UI
      // permanently if that event ever reports null for a reason we did not
      // anticipate. A null here never overrides a session already in hand.
      const { data: sessionData } = await resolvedClient.auth.getSession();
      if (!isMountedRef.current || cancelled) {
        return;
      }
      setSession((current) => current ?? sessionData.session);
      setHasSeenAuthEvent(true);
    };

    void getSupabaseClient()
      .then(async (resolvedClient) => {
        // Unmounted while the library was loading: never subscribe at all,
        // rather than subscribing and immediately tearing it down.
        if (cancelled || !resolvedClient || !isMountedRef.current) {
          return;
        }
        setClient(resolvedClient);
        await attach(resolvedClient);
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

  /**
   * The part every way in shares: refuse when there is no backend, resolve the
   * client, run the attempt, and make sure `isSigningIn` comes back down.
   *
   * One runner rather than three copies, because the copies are where the
   * differences creep in — the original single method already carried three
   * separate `setIsSigningIn(false)` calls, and each new provider would have
   * added three more places to forget one.
   */
  const runSignIn = useCallback(
    async (
      attempt: (activeClient: SupabaseClient) => Promise<SignInOutcome>,
    ): Promise<SignInOutcome> => {
      if (!isAvailable) {
        return { status: 'unavailable' };
      }

      setIsSigningIn(true);
      setExchangeError(null);

      const settle = (outcome: SignInOutcome): SignInOutcome => {
        // `redirecting` is the exception: the browser is on its way to the
        // provider, so the flag stays set and the buttons stay disabled for the
        // remainder of this document's life.
        if (outcome.status !== 'redirecting' && isMountedRef.current) {
          setIsSigningIn(false);
        }
        return outcome;
      };

      try {
        // Usually already resolved by the mount effect; awaited here so a click
        // that lands before the chunk finishes loading still works.
        const activeClient = client ?? (await getSupabaseClient());
        if (!activeClient) {
          return settle({ status: 'unavailable' });
        }

        return settle(await attempt(activeClient));
      } catch (error: unknown) {
        // Offline or blocked: these calls reject rather than returning an
        // error. A wallet prompt the user dismisses also lands here.
        return settle({ status: 'error', message: toMessage(error) });
      }
    },
    [client, isAvailable],
  );

  const signInWithProvider = useCallback(
    (providerId: string): Promise<SignInOutcome> =>
      runSignIn(async (activeClient) => {
        const { error } = await activeClient.auth.signInWithOAuth({
          // The id came from this project's own `/auth/v1/settings`, whose
          // `external` map is keyed by exactly these ids — so the cast asserts
          // something the endpoint guarantees. Narrowing it against a literal
          // list here would reintroduce the hard-coded provider list that
          // discovery exists to delete, and the failure mode it would prevent
          // is already benign: an id GoTrue does not know comes straight back
          // as a "provider is not enabled" error.
          provider: providerId as Provider,
          options: { redirectTo: resolveRedirectTo() },
        });

        return error
          ? { status: 'error', message: error.message }
          : { status: 'redirecting' };
      }),
    [runSignIn],
  );

  const signInWithEmailLink = useCallback(
    (email: string): Promise<SignInOutcome> =>
      runSignIn(async (activeClient) => {
        const { error } = await activeClient.auth.signInWithOtp({
          email,
          // Same destination as the OAuth redirect, for the same reason: the
          // link has to land somewhere GitHub Pages serves on a cold load.
          options: { emailRedirectTo: resolveRedirectTo() },
        });

        return error
          ? { status: 'error', message: error.message }
          : { status: 'email-sent' };
      }),
    [runSignIn],
  );

  const signInWithWallet = useCallback(
    (chain: Web3Chain, statement: string): Promise<SignInOutcome> =>
      runSignIn(async (activeClient) => {
        // Built per chain rather than spread from the parameter: the credentials
        // type is a union discriminated on `chain`, and a widened
        // `'solana' | 'ethereum'` matches neither arm.
        const { error } = await activeClient.auth.signInWithWeb3(
          chain === 'solana' ? { chain: 'solana', statement } : { chain: 'ethereum', statement },
        );

        return error
          ? { status: 'error', message: error.message }
          : { status: 'signed-in' };
      }),
    [runSignIn],
  );

  const signInWithPasskey = useCallback(
    (): Promise<SignInOutcome> =>
      runSignIn(async (activeClient) => {
        // Throws rather than returning an error when `experimental.passkey` is
        // off in `lib/supabase/client` — `runSignIn` catches that too.
        const { error } = await activeClient.auth.signInWithPasskey();

        return error
          ? { status: 'error', message: error.message }
          : { status: 'signed-in' };
      }),
    [runSignIn],
  );

  /**
   * Deliberately not routed through {@link runSignIn}: nobody is signing in, so
   * flipping `isSigningIn` would disable a sign-in surface that is not even on
   * screen. The caller owns the in-flight state for its own button.
   */
  const registerPasskey = useCallback(async (): Promise<PasskeyEnrolmentOutcome> => {
    if (!isAvailable) {
      return { status: 'unavailable' };
    }

    try {
      const activeClient = client ?? (await getSupabaseClient());
      if (!activeClient) {
        return { status: 'unavailable' };
      }

      const { error } = await activeClient.auth.registerPasskey();
      return error ? { status: 'error', message: error.message } : { status: 'enrolled' };
    } catch (error: unknown) {
      // A dismissed system prompt, an origin WebAuthn will not serve, or the
      // experimental flag being off.
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
      signInWithProvider,
      signInWithEmailLink,
      signInWithWallet,
      signInWithPasskey,
      registerPasskey,
      signOut,
      // The exchange's own failure is more specific than the redirect's, so it
      // wins when both are present.
      lastAuthError: exchangeError ?? providerError,
    }),
    [
      exchangeError,
      providerError,
      isAvailable,
      isResolved,
      isSigningIn,
      registerPasskey,
      session,
      signInWithEmailLink,
      signInWithPasskey,
      signInWithProvider,
      signInWithWallet,
      signOut,
    ],
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
