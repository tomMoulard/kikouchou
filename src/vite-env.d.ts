/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/**
 * Build-time environment surface.
 *
 * `vite/client` types `ImportMetaEnv` with a permissive index signature, so a
 * typo like `VITE_SUPBASE_URL` would silently read `undefined` and degrade to
 * local-only mode with no error anywhere. Declaring the keys turns that into a
 * compile failure.
 *
 * Every entry is optional on purpose: the app must build and run with none of
 * them set. See `lib/supabase/client` for what absence means.
 */
interface ImportMetaEnv {
  /** Supabase project URL, e.g. `https://<ref>.supabase.co`. */
  readonly VITE_SUPABASE_URL?: string;

  /**
   * Supabase publishable (`sb_publishable_…`) key. Ships inside the client
   * bundle by design — Row-Level Security is what protects the data, which is
   * why every table has RLS enabled in the migration that creates it.
   */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;

  /**
   * Wallet chains to offer, comma-separated: `solana`, `ethereum`, or both.
   *
   * The one auth setting that cannot be discovered from the project.
   * `GET /auth/v1/settings` lists every OAuth provider plus email and phone but
   * says nothing about web3, so this is how the app is told. Unset means no
   * wallet button. See `features/auth/web3`.
   */
  readonly VITE_SUPABASE_WEB3_CHAINS?: string;

  /**
   * PostHog project token (`phc_…`). Absent means analytics is off entirely —
   * `lib/posthog` default-exports `undefined` and every capture is a no-op.
   */
  readonly VITE_POSTHOG_KEY?: string;

  /** PostHog ingestion host, e.g. `https://eu.i.posthog.com`. */
  readonly VITE_POSTHOG_HOST?: string;

  /**
   * Opt in to PostHog on a dev server. `'true'` and nothing else.
   *
   * Off by default because a key on `localhost` created 19 anonymous people in
   * a project with three real accounts. See `lib/posthog` for the mechanism.
   */
  readonly VITE_POSTHOG_ALLOW_LOCALHOST?: string;

  /** Version string shown in Settings; set by CI from the ref and SHA. */
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
