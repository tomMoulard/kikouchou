/**
 * A passkey needs the project *and* the browser to agree.
 *
 * `passkeys_enabled` from `/auth/v1/settings` only says the server will verify
 * one. These pin the other half, which is where the surprises are: WebAuthn is
 * absent from old browsers and some embedded webviews, and — the one that
 * catches people — it refuses to work outside a secure context, which is
 * exactly how a phone reaches `http://192.168.x.x:5173`.
 *
 * @module features/auth/__tests__/passkeys.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { isPasskeySupported } from '@/features/auth/passkeys';

// ============================================================================
// Helpers
// ============================================================================

function setSecureContext(value: boolean): void {
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    writable: true,
    value,
  });
}

/** jsdom ships no WebAuthn, so a working one has to be installed. */
function installWebAuthn(): void {
  Object.defineProperty(window, 'PublicKeyCredential', {
    configurable: true,
    writable: true,
    value: function PublicKeyCredential(): void {
      // Presence is all that is checked; the ceremony is the browser's.
    },
  });
  Object.defineProperty(window.navigator, 'credentials', {
    configurable: true,
    writable: true,
    value: { create: () => undefined, get: () => undefined },
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, 'PublicKeyCredential');
  Reflect.deleteProperty(window, 'isSecureContext');
  Reflect.deleteProperty(window.navigator, 'credentials');
});

// ============================================================================
// isPasskeySupported
// ============================================================================

describe('isPasskeySupported', () => {
  it('is false in a browser with no WebAuthn', () => {
    // Which is jsdom, and therefore the whole unit suite: no passkey button is
    // offered in these tests unless one is asked for explicitly.
    setSecureContext(true);

    expect(isPasskeySupported()).toBe(false);
  });

  it('is false outside a secure context, even with WebAuthn present', () => {
    installWebAuthn();
    setSecureContext(false);

    // `navigator.credentials` exists here but throws when called, and an
    // exception mid-ceremony reads as the app being broken rather than as the
    // page needing HTTPS.
    expect(isPasskeySupported()).toBe(false);
  });

  it('is true with WebAuthn in a secure context', () => {
    installWebAuthn();
    setSecureContext(true);

    expect(isPasskeySupported()).toBe(true);
  });

  it('is false when the credentials API is missing despite the constructor', () => {
    Object.defineProperty(window, 'PublicKeyCredential', {
      configurable: true,
      writable: true,
      value: function PublicKeyCredential(): void {},
    });
    setSecureContext(true);

    expect(isPasskeySupported()).toBe(false);
  });
});

describe('isPasskeySupported in a store app', () => {
  /** The module as a store app on `platform` loads it, WebAuthn present. */
  async function loadInApp(platform: 'ios' | 'android', hasPlugin: boolean): Promise<() => boolean> {
    vi.resetModules();
    vi.doMock('@capacitor/core', () => ({
      Capacitor: { getPlatform: () => platform, isPluginAvailable: (name: string) => hasPlugin && name === 'Passkeys' },
      registerPlugin: () => ({}),
    }));
    installWebAuthn();
    setSecureContext(true);

    const module = await import('@/features/auth/passkeys');
    vi.doUnmock('@capacitor/core');
    return module.isPasskeySupported;
  }

  it('is false in the iPhone app: a passkey is bound to the website, and the web view is not it', async () => {
    const inApp = await loadInApp('ios', true);

    expect(inApp()).toBe(false);
  });

  it('is true in the Android app, which asks Credential Manager instead of the web view', async () => {
    const inApp = await loadInApp('android', true);

    expect(inApp()).toBe(true);
  });

  it('is false in an Android build that left the passkey plugin out', async () => {
    // The F-Droid app below Android 14: no provider can answer there.
    const inApp = await loadInApp('android', false);

    expect(inApp()).toBe(false);
  });
});
