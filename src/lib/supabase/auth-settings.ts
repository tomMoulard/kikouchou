/**
 * @fileoverview Asks the backend which ways in it accepts, so the UI never
 * hard-codes the answer.
 *
 * GoTrue publishes its own configuration at `GET /auth/v1/settings` — an
 * unauthenticated endpoint that needs only the publishable key. Enabling Spotify
 * in the Supabase dashboard therefore lights up a Spotify button with no
 * redeploy, and disabling one takes its button away. That is the whole point of
 * this module: the provider list is *data*, fetched from the same project the
 * session comes from, not a constant that drifts out of date the moment somebody
 * touches the dashboard.
 *
 * Three things it deliberately does not do:
 *
 * - **It is never on the cold-launch path.** The fetch is a network call, and
 *   the rule in `client.ts` is that anything touching the network sits behind an
 *   explicit user action. `useAuthProviders` runs it when a sign-in surface
 *   opens, not when the app mounts.
 * - **It never gates rendering.** {@link readCachedAuthSettings} answers
 *   synchronously from `localStorage` so a sign-in surface paints the list it
 *   showed last time on the first frame, and the fetch only ever *corrects* it.
 *   Offline with a cold cache falls back to {@link FALLBACK_AUTH_SETTINGS}.
 * - **It never throws.** Every failure — unconfigured build, offline, 500, an
 *   HTML error page, `localStorage` unavailable in a private window — resolves
 *   to `null` and leaves the caller on its cached or fallback list.
 *
 * ## What the endpoint does not tell you
 *
 * `external` covers the OAuth providers plus `email` and `phone`. It carries
 * **no web3 key at all** — a project with Sign in with Solana enabled looks
 * identical to one without. Wallet sign-in is therefore configured locally,
 * through `VITE_SUPABASE_WEB3_CHAINS`; see `features/auth/web3`.
 *
 * Passkeys do appear, as `passkeys_enabled`, but that flag is only half the
 * question: the browser needs a WebAuthn implementation and a secure context
 * before one can be offered, and somebody has to have enrolled one. See
 * `features/auth/passkeys` for the first half and
 * `features/auth/components/PasskeyEnrolment` for the second.
 *
 * @module lib/supabase/auth-settings
 */

import { readSupabaseConfig } from './client';

// ============================================================================
// Type Definitions
// ============================================================================

/** What the project accepts as a way in, as it reported it. */
export interface AuthSettings {
  /**
   * Enabled OAuth provider ids, in the order the endpoint listed them, e.g.
   * `['google', 'spotify']`. These are passed straight to
   * `signInWithOAuth({ provider })`, so they are ids and not display names.
   */
  readonly oauth: readonly string[];

  /** Whether email sign-in (magic link / OTP) is enabled. */
  readonly email: boolean;

  /** Whether phone sign-in is enabled. Parsed, not yet surfaced. */
  readonly phone: boolean;

  /**
   * Whether the project will verify a passkey. Not sufficient on its own to
   * offer one — see the module note.
   */
  readonly passkeys: boolean;

  /**
   * Whether the project refuses *new* accounts. Existing users can still sign
   * in, so this is a warning to show, not a reason to hide the providers.
   */
  readonly signupDisabled: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Keys that live in `external` but are not OAuth providers, so they must not
 * become "Continue with anonymous_users" buttons.
 */
const NON_OAUTH_EXTERNAL_KEYS: ReadonlySet<string> = new Set([
  'email',
  'phone',
  'anonymous_users',
]);

/**
 * Shape an id has to have to be usable.
 *
 * The response comes from our own project, but it is still remote input, and
 * this value is about to be interpolated into a translation key, a DOM id and an
 * analytics property. A bounded `[a-z0-9_]` id keeps all three boring.
 */
const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9_]{1,31}$/;

/** Hard ceiling on the list, so a malformed response cannot render 400 buttons. */
const MAX_OAUTH_PROVIDERS = 24;

/**
 * What to offer when there is nothing else to go on: offline on a first launch,
 * before this browser has ever reached the endpoint.
 *
 * Google, because it is the provider this app shipped with and the one every
 * existing account uses. A wrong guess here is cheap and self-correcting — the
 * button either works or reports "provider is not enabled" — whereas an empty
 * list is a dead end with nothing to click.
 */
export const FALLBACK_AUTH_SETTINGS: AuthSettings = {
  oauth: ['google'],
  email: false,
  phone: false,
  passkeys: false,
  signupDisabled: false,
};

/** Cache key prefix; the project URL is appended. */
const CACHE_KEY_PREFIX = 'kikoushou-auth-settings:';

// ============================================================================
// Parsing
// ============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Turns a `/settings` payload into {@link AuthSettings}, or `null` if it is not
 * one.
 *
 * Absent booleans read as `false` rather than as an error: GoTrue adds keys
 * between releases, and a missing `passkeys_enabled` means "this version does
 * not have them", which is exactly "off".
 *
 * Exported for the tests, which is where the malformed shapes live.
 *
 * @internal
 */
export function parseAuthSettings(payload: unknown): AuthSettings | null {
  if (!isRecord(payload)) {
    return null;
  }

  const external = payload['external'];
  if (!isRecord(external)) {
    // No provider map at all: not a settings payload. An HTML error page parsed
    // as JSON, or a URL pointing at something else entirely.
    return null;
  }

  const oauth: string[] = [];
  for (const [id, enabled] of Object.entries(external)) {
    if (enabled !== true || NON_OAUTH_EXTERNAL_KEYS.has(id)) {
      continue;
    }
    if (!PROVIDER_ID_PATTERN.test(id)) {
      continue;
    }
    if (oauth.length >= MAX_OAUTH_PROVIDERS) {
      break;
    }
    oauth.push(id);
  }

  return {
    oauth,
    email: external['email'] === true,
    phone: external['phone'] === true,
    passkeys: payload['passkeys_enabled'] === true,
    signupDisabled: payload['disable_signup'] === true,
  };
}

// ============================================================================
// Cache
// ============================================================================

/**
 * Keyed by project URL, so pointing a browser profile at a local stack and then
 * back at production does not show one project's providers for the other's.
 */
function cacheKey(url: string): string {
  return `${CACHE_KEY_PREFIX}${url}`;
}

/**
 * The last list this browser saw for this project, or `null`.
 *
 * Synchronous by design — it is what the first frame renders. Re-parsed rather
 * than trusted: whatever is in `localStorage` was written by an older build of
 * this app and is remote data one step removed.
 */
export function readCachedAuthSettings(): AuthSettings | null {
  const config = readSupabaseConfig();
  if (!config) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(cacheKey(config.url));
    if (raw === null) {
      return null;
    }
    return parseCachedSettings(JSON.parse(raw));
  } catch {
    // Private-mode Safari throws on access; a truncated write fails to parse.
    return null;
  }
}

/**
 * Reads back our own cache entry.
 *
 * Not {@link parseAuthSettings}: that one takes GoTrue's wire shape, and this
 * takes the flat {@link AuthSettings} we wrote. Sharing one parser would mean
 * storing the raw payload, which then has to stay compatible with a shape we do
 * not own.
 */
function parseCachedSettings(value: unknown): AuthSettings | null {
  if (!isRecord(value) || !Array.isArray(value['oauth'])) {
    return null;
  }

  const oauth = value['oauth']
    .filter((id): id is string => typeof id === 'string' && PROVIDER_ID_PATTERN.test(id))
    .slice(0, MAX_OAUTH_PROVIDERS);

  return {
    oauth,
    email: value['email'] === true,
    phone: value['phone'] === true,
    passkeys: value['passkeys'] === true,
    signupDisabled: value['signupDisabled'] === true,
  };
}

function writeCachedAuthSettings(url: string, settings: AuthSettings): void {
  try {
    window.localStorage.setItem(cacheKey(url), JSON.stringify(settings));
  } catch {
    // A full or unavailable store costs a first-paint list next launch and
    // nothing else.
  }
}

// ============================================================================
// Fetch
// ============================================================================

/**
 * Asks the project what it accepts, and caches the answer.
 *
 * @param signal - Aborted by the caller on unmount.
 * @returns The settings, or `null` when this build has no backend or the request
 *   did not produce a usable answer. Never rejects, including on abort.
 *
 * @example
 * ```ts
 * const settings =
 *   (await fetchAuthSettings()) ?? readCachedAuthSettings() ?? FALLBACK_AUTH_SETTINGS;
 * ```
 */
export async function fetchAuthSettings(
  signal?: AbortSignal,
): Promise<AuthSettings | null> {
  const config = readSupabaseConfig();
  if (!config) {
    return null;
  }

  try {
    const response = await fetch(`${config.url}/auth/v1/settings`, {
      method: 'GET',
      headers: {
        apikey: config.publishableKey,
        accept: 'application/json',
      },
      // No cookies, and never a stale answer from the HTTP cache — the point of
      // asking is to notice a dashboard change.
      credentials: 'omit',
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    });

    if (!response.ok) {
      return null;
    }

    const settings = parseAuthSettings(await response.json());
    if (settings === null) {
      return null;
    }

    writeCachedAuthSettings(config.url, settings);
    return settings;
  } catch {
    // Offline, aborted, DNS failure, or a body that is not JSON. All the same
    // to the caller: it keeps whatever list it is already showing.
    return null;
  }
}
