/// <reference types="vite/client" />

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

  /** Legacy y-webrtc signaling relay. Retired in Phase 8 of the sync migration. */
  readonly VITE_SIGNALING_URL?: string;

  /** Version string shown in Settings; set by CI from the ref and SHA. */
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
