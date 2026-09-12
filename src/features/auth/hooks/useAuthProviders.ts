/**
 * @fileoverview Supplies a sign-in surface with the ways in this project
 * accepts.
 *
 * Two rules meet here. The app must never put a network round trip in front of
 * something the user is looking at, and the provider list must come from the
 * backend rather than from a constant. So the hook renders *immediately* from
 * whatever this browser already knows — the cached answer, or Google as a last
 * resort — and the fetch only ever corrects that list in place.
 *
 * It runs on mount of the sign-in surface, not on mount of the app: a launch
 * that never signs in makes no request at all, which is most launches.
 *
 * @module features/auth/hooks/useAuthProviders
 */

import { useEffect, useMemo, useState } from 'react';

import { isPasskeySupported } from '@/features/auth/passkeys';
import { type Web3Chain, getAvailableWeb3Chains } from '@/features/auth/web3';
import {
  type AuthSettings,
  FALLBACK_AUTH_SETTINGS,
  fetchAuthSettings,
  readCachedAuthSettings,
} from '@/lib/supabase/auth-settings';

// ============================================================================
// Type Definitions
// ============================================================================

export interface UseAuthProvidersResult {
  /** The ways in to offer. Never empty of everything on the first render. */
  readonly settings: AuthSettings;

  /**
   * Whether {@link settings} came from the project just now, rather than from
   * the cache or the fallback.
   *
   * Not a loading flag — there is nothing to wait for. Use it only to explain a
   * list that might be out of date, e.g. offline.
   */
  readonly isConfirmed: boolean;

  /**
   * Wallet chains worth offering: enabled in this build and backed by a wallet
   * in this browser. Invisible to the backend, hence separate — see
   * `features/auth/web3`.
   */
  readonly walletChains: readonly Web3Chain[];

  /**
   * Whether to offer a passkey: the project reported them enabled *and* this
   * browser has a WebAuthn implementation it can use. Both halves are needed —
   * see `features/auth/passkeys`.
   */
  readonly canUsePasskeys: boolean;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * @example
 * ```tsx
 * const { settings, walletChains } = useAuthProviders();
 * settings.oauth.map((id) => <ProviderButton key={id} providerId={id} />);
 * ```
 */
export function useAuthProviders(): UseAuthProvidersResult {
  // Read once, synchronously, into the initial state: this is what the first
  // frame paints, so it cannot be an effect.
  const [settings, setSettings] = useState<AuthSettings>(
    () => readCachedAuthSettings() ?? FALLBACK_AUTH_SETTINGS,
  );
  const [isConfirmed, setIsConfirmed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    void fetchAuthSettings(controller.signal).then((fresh) => {
      // `null` is every failure, including an unconfigured build and an abort.
      // Keeping the list already on screen is the right answer to all of them.
      if (fresh === null || controller.signal.aborted) {
        return;
      }
      setSettings(fresh);
      setIsConfirmed(true);
    });

    return () => {
      controller.abort();
    };
  }, []);

  // Reads `window` for injected wallets, so it is computed once per mount
  // rather than on every render.
  const walletChains = useMemo(() => getAvailableWeb3Chains(), []);

  // The project's half of this arrives with `settings`; the browser's half is
  // fixed for the life of the document.
  const isPasskeyCapable = useMemo(() => isPasskeySupported(), []);

  return {
    settings,
    isConfirmed,
    walletChains,
    canUsePasskeys: settings.passkeys && isPasskeyCapable,
  };
}
