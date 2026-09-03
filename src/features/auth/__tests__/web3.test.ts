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
  it('offers nothing when the variable is unset', () => {
    // The matching Supabase setting is off by default too, so silence is the
    // right default rather than a guess.
    vi.stubEnv('VITE_SUPABASE_WEB3_CHAINS', '');

    expect(getConfiguredWeb3Chains()).toEqual([]);
  });

  it('reads a single chain', () => {
    vi.stubEnv('VITE_SUPABASE_WEB3_CHAINS', 'solana');

    expect(getConfiguredWeb3Chains()).toEqual(['solana']);
  });

  it('reads a list, tolerating spacing and case', () => {
    vi.stubEnv('VITE_SUPABASE_WEB3_CHAINS', ' Solana , ETHEREUM ');

    expect(getConfiguredWeb3Chains()).toEqual(['solana', 'ethereum']);
  });

  it('drops a name it does not know rather than failing the build', () => {
    vi.stubEnv('VITE_SUPABASE_WEB3_CHAINS', 'solanna,bitcoin,solana');

    // A typo costs the button, never the app — this is read while rendering a
    // screen that has to work.
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
