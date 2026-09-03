/**
 * @fileoverview The Supabase client, created lazily and allowed to be absent.
 *
 * Two constraints from the offline-first contract shape this module:
 *
 * 1. **A missing configuration is not an error.** The app must boot and stay
 *    fully usable with no `VITE_SUPABASE_*` set — that is the local-only mode a
 *    first launch runs in, and it is also how the unit suite runs. Nothing here
 *    throws at import time; callers get `null` and fall back to local behaviour.
 *
 * 2. **Creating the client must not touch the network.** `supabase-js` reads a
 *    persisted session from `localStorage` synchronously and only refreshes it
 *    when asked, so constructing it offline is safe. Any call that does hit the
 *    network belongs behind an explicit user action.
 *
 * 3. **`supabase-js` is loaded on demand.** It is ~218 kB (57 kB gzipped), and
 *    `AuthProvider` mounts in the eager provider tree — a static import would
 *    put that on the critical path of every cold launch, including for the
 *    majority of launches that never sign in. So the library is imported
 *    dynamically and `getSupabaseClient` is async. That costs nothing in
 *    practice because nothing waits on the session: see `AuthContext`.
 *
 * @module lib/supabase/client
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from './database.types';

/**
 * The client, typed against the generated schema.
 *
 * Exported because every consumer wants this rather than the bare
 * `SupabaseClient`: with the generic in place, a column or an RPC argument that
 * does not exist is a compile error instead of an `undefined` found at run time.
 * The sync layer carried a hand-written cast at each call site to stand in for
 * it.
 */
export type TypedSupabaseClient = SupabaseClient<Database>;

// ============================================================================
// Constants
// ============================================================================

/**
 * Key the session is persisted under. Named per-project so two Supabase
 * projects (say prod and a local stack) cannot overwrite each other's session
 * in the same browser profile.
 */
const STORAGE_KEY = 'kikouchou-auth';

// ============================================================================
// Configuration
// ============================================================================

export interface SupabaseConfig {
  readonly url: string;
  readonly publishableKey: string;
}

/**
 * The backend coordinates, or `null` when this build has none.
 *
 * Exported so that anything needing to call the project directly — see
 * `lib/supabase/auth-settings`, which talks to the Auth REST API without the
 * client library — reads the environment through this one function. Two copies
 * of the "is a blank string configured?" question is exactly how one caller
 * ends up disagreeing with `isSupabaseConfigured`.
 */
export function readSupabaseConfig(): SupabaseConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (typeof url !== 'string' || url.length === 0) {
    return null;
  }
  if (typeof publishableKey !== 'string' || publishableKey.length === 0) {
    return null;
  }

  return { url, publishableKey };
}

// ============================================================================
// Client
// ============================================================================

let cachedClient: TypedSupabaseClient | null = null;
/** In-flight creation, so concurrent callers share one client. */
let pending: Promise<TypedSupabaseClient | null> | null = null;

/**
 * Returns the shared Supabase client, or `null` when the app is not configured
 * for a backend.
 *
 * Created on first call rather than at module scope, so importing this module —
 * as the unit suite does transitively — neither loads `supabase-js` nor reads
 * `localStorage`.
 *
 * @example
 * ```ts
 * const supabase = await getSupabaseClient();
 * if (!supabase) {
 *   // Local-only mode: no account, no sync. Not an error.
 *   return;
 * }
 * ```
 */
export function getSupabaseClient(): Promise<TypedSupabaseClient | null> {
  if (cachedClient) {
    return Promise.resolve(cachedClient);
  }
  if (pending) {
    return pending;
  }

  const config = readSupabaseConfig();
  if (!config) {
    return Promise.resolve(null);
  }

  pending = createConfiguredClient(config);
  return pending;
}

async function createConfiguredClient(
  config: SupabaseConfig,
): Promise<SupabaseClient | null> {
  // Dynamic so the library stays off the cold-launch critical path.
  const { createClient } = await import('@supabase/supabase-js');

  cachedClient = createClient<Database>(config.url, config.publishableKey, {
    auth: {
      // The session outlives the tab: a trip is edited over days, and being
      // signed out by a reload would make sharing feel broken.
      persistSession: true,
      autoRefreshToken: true,
      storageKey: STORAGE_KEY,
      // PKCE puts the authorization code in the query string of whatever URL we
      // sent the user back to. That URL is the app root, so GitHub Pages never
      // has to serve a deep link for sign-in to work — see
      // `githubPagesSpaFallback` in vite.config.ts for the deep links that *do*
      // need handling.
      flowType: 'pkce',
      // Off deliberately. This client is constructed lazily, in an effect, after
      // main() has awaited i18n and the database — far too late to find a query
      // parameter the router may already have normalised away. The code is
      // captured synchronously at import instead, and exchanged explicitly by
      // AuthProvider. See lib/supabase/auth-callback.
      detectSessionInUrl: false,
      // Passkey sign-in is behind this flag in `@supabase/auth-js`, and every
      // passkey method *throws* without it — including the one behind a button
      // that would look enabled. The project has passkeys on
      // (`passkeys_enabled: true` at `/auth/v1/settings`), so the flag is what
      // makes that reachable. Experimental means the API may change under us on
      // a minor bump; the two call sites are `signInWithPasskey` and
      // `registerPasskey` in `features/auth/AuthContext`.
      experimental: { passkey: true },
    },
  });

  return cachedClient;
}

/**
 * Whether a backend is configured at all.
 *
 * Synchronous and cheap: it reads the environment only, and deliberately does
 * *not* load `supabase-js`. Use it to decide whether to offer an
 * account-related affordance. Never use it to gate rendering or to decide
 * whether a trip can be edited — both work regardless.
 */
export function isSupabaseConfigured(): boolean {
  return readSupabaseConfig() !== null;
}

/**
 * Drops the memoised client so a test can change the environment between cases.
 * Not for production paths.
 *
 * @internal
 */
export function resetSupabaseClientForTests(): void {
  cachedClient = null;
  pending = null;
}
