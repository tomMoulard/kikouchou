/**
 * Wallet sign-in is configured, not discovered.
 *
 * `GET /auth/v1/settings` reports every OAuth provider plus email and phone and
 * says nothing whatsoever about web3 — a project with Sign in with Solana on
 * returns a byte-identical payload to one with it off. So this is the one part
 * of the sign-in screen driven by the build's own environment, and these tests
 * pin the two conditions for offering a button: the chain is configured *and*
 * the browser has a wallet for it.
 *
 * With both chains now the default, the parsing cases below are the ones that
 * decide whether a misconfiguration fails open or closed. Each is written
 * against a way this could plausibly have been implemented: merging the
 * override into the default instead of replacing it, treating an empty value as
 * "unset", or falling back to the default when a value parses to nothing. All
 * three read as reasonable and all three take the decision away from whoever
 * set the variable.
 *
 * @module features/auth/__tests__/web3.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getAvailableWeb3Chains,
  getConfiguredWeb3Chains,
  hasWalletFor,
} from '@/features/auth/web3';

// ============================================================================
// Helpers
// ============================================================================

/** Injects a wallet the way a browser extension would. */
function installWallet(key: string): void {
  Object.defineProperty(window, key, {
    configurable: true,
    writable: true,
    value: { isFake: true },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  Reflect.deleteProperty(window, 'solana');
  Reflect.deleteProperty(window, 'ethereum');
});

// ============================================================================
// Configuration
// ============================================================================

describe('getConfiguredWeb3Chains', () => {
  it('offers both chains when the variable is unset', () => {
    // Deliberately not stubbed: this is the default the project runs on, and
    // both Solana and Ethereum are enabled there.
    expect(getConfiguredWeb3Chains()).toEqual(['solana', 'ethereum']);
  });

  it('offers nothing when the variable is set but empty', () => {
    vi.stubEnv('VITE_SUPABASE_WEB3_CHAINS', '');

    // The opt-out, and the only one there is: no endpoint reports whether a
    // project accepts wallets, so a deployment without web3 enabled has nothing
    // else to say "not here" with. Reading empty as "unset" would take that
    // away and leave a button that always errors.
    expect(getConfiguredWeb3Chains()).toEqual([]);
  });

  it('offers nothing when the value is only separators and spaces', () => {
    vi.stubEnv('VITE_SUPABASE_WEB3_CHAINS', ' , ');

    // Same intent as an empty value, and reached by a half-finished edit.
    expect(getConfiguredWeb3Chains()).toEqual([]);
  });

  it('replaces the default rather than adding to it', () => {
    vi.stubEnv('VITE_SUPABASE_WEB3_CHAINS', 'solana');

    // Naming one chain is how you turn the other one off. Merging with the
    // default would make that impossible and quietly offer Ethereum to someone
    // who asked for Solana alone.
    expect(getConfiguredWeb3Chains()).toEqual(['solana']);
  });

  it('reads a list, tolerating spacing and case', () => {
    vi.stubEnv('VITE_SUPABASE_WEB3_CHAINS', ' Solana , ETHEREUM ');

    expect(getConfiguredWeb3Chains()).toEqual(['solana', 'ethereum']);
  });

  it('keeps the order the value gave, not the default order', () => {
    vi.stubEnv('VITE_SUPABASE_WEB3_CHAINS', 'ethereum,solana');

    // The list drives render order, so filtering the default array instead of
    // reading the value would silently ignore the stated preference.
    expect(getConfiguredWeb3Chains()).toEqual(['ethereum', 'solana']);
  });

  it('drops a name it does not know rather than failing the build', () => {
    vi.stubEnv('VITE_SUPABASE_WEB3_CHAINS', 'solanna,bitcoin,solana');

    // A typo costs the button, never the app — this is read while rendering a
    // screen that has to work.
    expect(getConfiguredWeb3Chains()).toEqual(['solana']);
  });

  it('offers nothing when every name is unrecognised, rather than the default', () => {
    vi.stubEnv('VITE_SUPABASE_WEB3_CHAINS', 'bitcoin,doge');

    // The tempting `parsed.length === 0 ? DEFAULT : parsed` answers a typo with
    // *more* providers than were asked for, and hides the typo from the person
    // who made it. Nothing is the honest answer: they asked for chains this app
    // does not have.
    expect(getConfiguredWeb3Chains()).toEqual([]);
  });

  it('collapses a repeated chain', () => {
    vi.stubEnv('VITE_SUPABASE_WEB3_CHAINS', 'solana,solana');

    // The list is rendered with the chain as the React key, so a duplicate is
    // two children keyed the same — a warning at best, and at worst two buttons
    // whose pending state moves together.
    expect(getConfiguredWeb3Chains()).toEqual(['solana']);
  });
});

// ============================================================================
// Detection
// ============================================================================

describe('hasWalletFor', () => {
  it('is false with no wallet injected', () => {
    expect(hasWalletFor('solana')).toBe(false);
    expect(hasWalletFor('ethereum')).toBe(false);
  });

  it('is true once the extension has injected one', () => {
    installWallet('solana');

    expect(hasWalletFor('solana')).toBe(true);
    expect(hasWalletFor('ethereum')).toBe(false);
  });
});

// ============================================================================
// The two together
// ============================================================================

describe('getAvailableWeb3Chains', () => {
  it('offers nothing on a browser with no wallet, defaults notwithstanding', () => {
    // The guard that makes an on-by-default list safe. Most visitors — every
    // phone browser without an extension — are this case, and they must see no
    // wallet button at all rather than one that fails when tapped.
    expect(getAvailableWeb3Chains()).toEqual([]);
  });

  it('offers only the installed half of the default pair', () => {
    installWallet('ethereum');

    // Unset, so both chains are configured; only one is usable.
    expect(getAvailableWeb3Chains()).toEqual(['ethereum']);
  });

  it('offers both when both wallets are present', () => {
    installWallet('solana');
    installWallet('ethereum');

    expect(getAvailableWeb3Chains()).toEqual(['solana', 'ethereum']);
  });

  it('offers a configured chain the browser can honour', () => {
    vi.stubEnv('VITE_SUPABASE_WEB3_CHAINS', 'solana');
    installWallet('solana');

    expect(getAvailableWeb3Chains()).toEqual(['solana']);
  });

  it('withholds a configured chain with no wallet behind it', () => {
    vi.stubEnv('VITE_SUPABASE_WEB3_CHAINS', 'solana,ethereum');
    installWallet('ethereum');

    // A phone browser with no extension is the common case. The button would
    // fail with a message about a missing wallet, which reads as "the app is
    // broken" rather than "you have no wallet installed".
    expect(getAvailableWeb3Chains()).toEqual(['ethereum']);
  });

  it('withholds an installed wallet the build did not ask for', () => {
    vi.stubEnv('VITE_SUPABASE_WEB3_CHAINS', 'solana');
    installWallet('solana');
    installWallet('ethereum');

    // Supabase verifies the signature, and it will refuse a chain the project
    // has not enabled.
    expect(getAvailableWeb3Chains()).toEqual(['solana']);
  });
});
