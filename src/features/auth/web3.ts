/**
 * @fileoverview Which wallet chains this build offers, and whether a wallet is
 * actually there to sign with.
 *
 * This is the one part of the sign-in screen that cannot be discovered from the
 * backend. `GET /auth/v1/settings` reports every OAuth provider plus email and
 * phone, but it says **nothing** about web3: a project with Sign in with Solana
 * enabled and one without return byte-identical payloads. So the chains are
 * named locally, in `VITE_SUPABASE_WEB3_CHAINS`, and this module is the only
 * place that reads it.
 *
 * Both chains are the default, matching the project, which has Solana and
 * Ethereum enabled. The variable is therefore an override rather than a
 * switch — and because there is no server flag to fall back on, an *explicit
 * empty value* has to mean "none" or a deploy without web3 enabled would have
 * no way to stop offering it.
 *
 * Enablement alone is not enough to show a button. Wallet sign-in needs an
 * injected wallet in *this* browser — `window.solana` from Phantom, an
 * EIP-1193 `window.ethereum` from MetaMask — and without one `signInWithWeb3`
 * fails with a message about a missing wallet, which reads as "the app is
 * broken" rather than "you have no wallet installed". A phone browser with no
 * extension is the common case, so the button is offered only when both the
 * project and the browser can honour it.
 *
 * Reading `window` here is deliberate and allowed: this is feature code, not
 * `lib/`, which may not touch it.
 *
 * @module features/auth/web3
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Chains Supabase can verify a signature for. `erasableSyntaxOnly` rules out an
 * enum, so this is a union plus the array below.
 */
export type Web3Chain = 'solana' | 'ethereum';

// ============================================================================
// Constants
// ============================================================================

/** Every chain this app knows how to ask for, and the `window` key each uses. */
const WALLET_KEYS: Readonly<Record<Web3Chain, string>> = {
  solana: 'solana',
  ethereum: 'ethereum',
};

const ALL_CHAINS: readonly Web3Chain[] = ['solana', 'ethereum'];

/**
 * What an unset `VITE_SUPABASE_WEB3_CHAINS` means.
 *
 * Both, because both are enabled on the project. The cost of being wrong is
 * bounded: a chain is only ever offered when this browser also has a wallet for
 * it, so a deployment that has not enabled web3 shows the button to the small
 * number of visitors carrying a wallet, and it fails with the server's own
 * message. Those deployments set the variable to an empty value.
 */
const DEFAULT_CHAINS: readonly Web3Chain[] = ['solana', 'ethereum'];

// ============================================================================
// Configuration
// ============================================================================

function isWeb3Chain(value: string): value is Web3Chain {
  return (ALL_CHAINS as readonly string[]).includes(value);
}

/**
 * Chains this build offers, from `VITE_SUPABASE_WEB3_CHAINS`.
 *
 * Unset gives {@link DEFAULT_CHAINS}. Any *set* value replaces that list
 * outright rather than adding to it, including these two edge cases, which are
 * the ones worth knowing:
 *
 * - An empty or whitespace value yields nothing. This is the opt-out, and it
 *   only works because "set but empty" is distinguishable from "unset".
 * - A value naming nothing recognisable — `bitcoin`, or a typo — also yields
 *   nothing, deliberately. Falling back to the default when the parse comes up
 *   empty would answer a misconfiguration with *more* providers than were
 *   asked for, and the person who typed it would never see their mistake.
 *
 * @returns The chains, deduplicated and in the order given. Duplicates would
 *   otherwise reach React as two children with the same key.
 *
 * @example
 * ```ts
 * // VITE_SUPABASE_WEB3_CHAINS unset  -> ['solana', 'ethereum']
 * // VITE_SUPABASE_WEB3_CHAINS=solana -> ['solana']
 * // VITE_SUPABASE_WEB3_CHAINS=       -> []
 * ```
 */
export function getConfiguredWeb3Chains(): readonly Web3Chain[] {
  const raw = import.meta.env.VITE_SUPABASE_WEB3_CHAINS;
  if (typeof raw !== 'string') {
    return DEFAULT_CHAINS;
  }

  const named = raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(isWeb3Chain);

  return [...new Set(named)];
}

// ============================================================================
// Detection
// ============================================================================

/**
 * Whether a wallet for this chain is injected in this browser.
 *
 * A bare presence check, not a capability check: the wallet's own UI is the next
 * thing the user sees, and it will say if it cannot sign.
 */
export function hasWalletFor(chain: Web3Chain): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const key = WALLET_KEYS[chain];
  return (window as unknown as Record<string, unknown>)[key] != null;
}

/**
 * The chains worth offering: enabled in this build *and* backed by a wallet in
 * this browser.
 *
 * @example
 * ```ts
 * for (const chain of getAvailableWeb3Chains()) {
 *   // one "Continue with your <chain> wallet" button each
 * }
 * ```
 */
export function getAvailableWeb3Chains(): readonly Web3Chain[] {
  return getConfiguredWeb3Chains().filter(hasWalletFor);
}
