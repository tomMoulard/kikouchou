/**
 * The Android app's passkeys: the page's WebAuthn calls go to Credential
 * Manager, in WebAuthn's JSON form, and come back as a credential auth-js
 * accepts.
 *
 * @module lib/native/__tests__/passkeys.test
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fromBase64Url,
  hasNativePasskeys,
  installNativePasskeys,
  toBase64Url,
  toWebAuthnJson,
} from '@/lib/native/passkeys';
import { getAppPlatform, hasNativePlugin } from '@/lib/platform';

// ============================================================================
// Mocks
// ============================================================================

const plugin = vi.hoisted(() => ({
  get: vi.fn(),
  create: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  registerPlugin: vi.fn(() => plugin),
}));

vi.mock('@/lib/platform', () => ({
  getAppPlatform: vi.fn(() => 'android'),
  hasNativePlugin: vi.fn(() => true),
}));

// ============================================================================
// Helpers
// ============================================================================

/** A stand-in for the WebView's own class, the one auth-js checks against. */
class FakePublicKeyCredential {
  get id(): string {
    throw new TypeError('Illegal invocation');
  }
}

interface FakeGlobals {
  readonly navigator: Navigator;
  readonly window: Window & { PublicKeyCredential?: unknown };
}

function fakeGlobals(options: { withClass?: boolean; original?: Partial<CredentialsContainer> } = {}): FakeGlobals {
  const nav = {} as Navigator;
  if (options.original) {
    Object.defineProperty(nav, 'credentials', { configurable: true, value: options.original });
  }
  const win = {} as Window & { PublicKeyCredential?: unknown };
  if (options.withClass !== false) {
    win.PublicKeyCredential = FakePublicKeyCredential;
  }
  return { navigator: nav, window: win };
}

function install(globals: FakeGlobals): boolean {
  return installNativePasskeys(globals as Parameters<typeof installNativePasskeys>[0]);
}

const bytes = (...values: number[]): Uint8Array<ArrayBuffer> => new Uint8Array(values);

const ASSERTION = {
  id: 'Y3JlZA',
  rawId: 'Y3JlZA',
  type: 'public-key',
  authenticatorAttachment: 'platform',
  response: {
    clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0',
    authenticatorData: 'AQID',
    signature: 'BAUG',
    userHandle: 'dXNlcg',
  },
  clientExtensionResults: {},
};

beforeEach(() => {
  plugin.get.mockReset();
  plugin.create.mockReset();
  vi.mocked(getAppPlatform).mockReturnValue('android');
  vi.mocked(hasNativePlugin).mockReturnValue(true);
});

// ============================================================================
// Encoding
// ============================================================================

describe('base64url', () => {
  it('encodes without padding and with the URL alphabet', () => {
    expect(toBase64Url(bytes(0xfb, 0xff))).toBe('-_8');
    expect(toBase64Url(bytes())).toBe('');
  });

  it('decodes what it encodes, padded or not', () => {
    const original = bytes(0, 1, 2, 250, 251, 252, 253, 254, 255);

    expect(new Uint8Array(fromBase64Url(toBase64Url(original)))).toEqual(original);
    expect(new Uint8Array(fromBase64Url('-_8='))).toEqual(bytes(0xfb, 0xff));
  });
});

describe('toWebAuthnJson', () => {
  it('turns every buffer into base64url, at any depth, and keeps the rest', () => {
    const view = bytes(9, 1, 2, 3, 9);

    expect(
      toWebAuthnJson({
        challenge: bytes(1, 2, 3).buffer,
        rpId: 'app.kikouchou.app',
        timeout: 60000,
        user: { id: new Uint8Array(view.buffer, 1, 3), name: 'a@b.c' },
        allowCredentials: [{ id: bytes(4, 5, 6), type: 'public-key', transports: ['internal'] }],
        userVerification: 'preferred',
        hints: undefined,
      }),
    ).toEqual({
      challenge: 'AQID',
      rpId: 'app.kikouchou.app',
      timeout: 60000,
      user: { id: 'AQID', name: 'a@b.c' },
      allowCredentials: [{ id: 'BAUG', type: 'public-key', transports: ['internal'] }],
      userVerification: 'preferred',
    });
  });
});

// ============================================================================
// hasNativePasskeys
// ============================================================================

describe('hasNativePasskeys', () => {
  it('is true in the Android app with the plugin', () => {
    expect(hasNativePasskeys()).toBe(true);
    expect(hasNativePlugin).toHaveBeenCalledWith('Passkeys');
  });

  it('is false in an Android build without the plugin', () => {
    vi.mocked(hasNativePlugin).mockReturnValue(false);

    expect(hasNativePasskeys()).toBe(false);
  });

  it('is false in the iPhone app and on the website', () => {
    vi.mocked(getAppPlatform).mockReturnValue('ios');
    expect(hasNativePasskeys()).toBe(false);

    vi.mocked(getAppPlatform).mockReturnValue('web');
    expect(hasNativePasskeys()).toBe(false);
  });
});

// ============================================================================
// installNativePasskeys
// ============================================================================

describe('installNativePasskeys', () => {
  it('leaves the website alone', () => {
    vi.mocked(getAppPlatform).mockReturnValue('web');
    const original = { get: vi.fn(), create: vi.fn() };
    const globals = fakeGlobals({ original });

    expect(install(globals)).toBe(false);
    expect(globals.navigator.credentials).toBe(original);
  });

  it('signs in through Credential Manager with the JSON form of the options', async () => {
    plugin.get.mockResolvedValue({ responseJson: JSON.stringify(ASSERTION) });
    const globals = fakeGlobals();
    install(globals);

    const credential = (await globals.navigator.credentials.get({
      publicKey: {
        challenge: bytes(1, 2, 3).buffer,
        rpId: 'app.kikouchou.app',
        allowCredentials: [],
      },
    })) as PublicKeyCredential;

    expect(plugin.get).toHaveBeenCalledWith({
      requestJson: JSON.stringify({ challenge: 'AQID', rpId: 'app.kikouchou.app', allowCredentials: [] }),
    });
    // auth-js refuses anything that is not an instance of the page's class.
    expect(credential).toBeInstanceOf(FakePublicKeyCredential);
    expect(credential.id).toBe('Y3JlZA');
    expect(credential.type).toBe('public-key');
    expect(credential.authenticatorAttachment).toBe('platform');
    expect(new Uint8Array(credential.rawId)).toEqual(bytes(0x63, 0x72, 0x65, 0x64));
    // auth-js sends `toJSON()` to Supabase, so it must be the answer as it came.
    expect(credential.toJSON()).toEqual(ASSERTION);
    expect(credential.getClientExtensionResults()).toEqual({});
    const response = credential.response as AuthenticatorAssertionResponse;
    expect(new Uint8Array(response.authenticatorData)).toEqual(bytes(1, 2, 3));
    expect(new Uint8Array(response.signature)).toEqual(bytes(4, 5, 6));
  });

  it('fills in rawId and the extension results when the answer leaves them out', async () => {
    const bare = { id: ASSERTION.id, type: ASSERTION.type, response: ASSERTION.response };
    plugin.get.mockResolvedValue({ responseJson: JSON.stringify(bare) });
    const globals = fakeGlobals();
    install(globals);

    const credential = (await globals.navigator.credentials.get({
      publicKey: { challenge: bytes(1).buffer },
    })) as PublicKeyCredential;

    expect(credential.toJSON()).toEqual({ ...bare, rawId: 'Y3JlZA', clientExtensionResults: {} });
  });

  it('adds a passkey through Credential Manager', async () => {
    const registration = {
      id: 'bmV3',
      rawId: 'bmV3',
      type: 'public-key',
      response: { clientDataJSON: 'e30', attestationObject: 'AQID', transports: ['internal', 'hybrid'] },
    };
    plugin.create.mockResolvedValue({ responseJson: JSON.stringify(registration) });
    const globals = fakeGlobals();
    install(globals);

    const credential = (await globals.navigator.credentials.create({
      publicKey: {
        challenge: bytes(7).buffer,
        rp: { id: 'app.kikouchou.app', name: 'Kikouchou' },
        user: { id: bytes(8).buffer, name: 'a@b.c', displayName: 'A' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      },
    })) as PublicKeyCredential;

    expect(JSON.parse((plugin.create.mock.calls[0]?.[0] as { requestJson: string }).requestJson)).toEqual({
      challenge: 'Bw',
      rp: { id: 'app.kikouchou.app', name: 'Kikouchou' },
      user: { id: 'CA', name: 'a@b.c', displayName: 'A' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    });
    expect(credential.toJSON()).toEqual({ ...registration, clientExtensionResults: {} });
    const response = credential.response as AuthenticatorAttestationResponse & { transports: string[] };
    expect(new Uint8Array(response.attestationObject)).toEqual(bytes(1, 2, 3));
    expect(response.transports).toEqual(['internal', 'hybrid']);
  });

  it('throws the DOMException the plugin names, as a browser would', async () => {
    plugin.get.mockRejectedValue(Object.assign(new Error('User cancelled'), { code: 'NotAllowedError' }));
    const globals = fakeGlobals();
    install(globals);

    const attempt = globals.navigator.credentials.get({ publicKey: { challenge: bytes(1).buffer } });

    await expect(attempt).rejects.toBeInstanceOf(DOMException);
    await expect(attempt).rejects.toMatchObject({ name: 'NotAllowedError', message: 'User cancelled' });
  });

  it('calls a failure with no name an UnknownError', async () => {
    plugin.create.mockRejectedValue('boom');
    const globals = fakeGlobals();
    install(globals);

    await expect(
      globals.navigator.credentials.create({ publicKey: { challenge: bytes(1).buffer } as PublicKeyCredentialCreationOptions }),
    ).rejects.toMatchObject({ name: 'UnknownError' });
  });

  it('refuses an answer that is not a passkey', async () => {
    plugin.get.mockResolvedValue({ responseJson: JSON.stringify({ id: 'x', type: 'password' }) });
    const globals = fakeGlobals();
    install(globals);

    await expect(
      globals.navigator.credentials.get({ publicKey: { challenge: bytes(1).buffer } }),
    ).rejects.toMatchObject({ name: 'UnknownError' });
  });

  it('does not open the sheet for a request already aborted', async () => {
    const globals = fakeGlobals();
    install(globals);
    const controller = new AbortController();
    controller.abort();

    await expect(
      globals.navigator.credentials.get({ publicKey: { challenge: bytes(1).buffer }, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(plugin.get).not.toHaveBeenCalled();
  });

  it('gives the page a PublicKeyCredential class when the WebView has none', async () => {
    plugin.get.mockResolvedValue({ responseJson: JSON.stringify(ASSERTION) });
    const globals = fakeGlobals({ withClass: false });
    install(globals);

    expect(typeof globals.window.PublicKeyCredential).toBe('function');
    const credential = await globals.navigator.credentials.get({ publicKey: { challenge: bytes(1).buffer } });
    expect(credential).toBeInstanceOf(globals.window.PublicKeyCredential as typeof FakePublicKeyCredential);
  });

  it('hands a request without publicKey to the WebView', async () => {
    const original = {
      get: vi.fn().mockResolvedValue('password'),
      create: vi.fn().mockResolvedValue('created'),
      store: vi.fn().mockResolvedValue(undefined),
      preventSilentAccess: vi.fn().mockResolvedValue(undefined),
    };
    const globals = fakeGlobals({ original });
    install(globals);

    await expect(globals.navigator.credentials.get({ mediation: 'silent' })).resolves.toBe('password');
    await expect(globals.navigator.credentials.create({})).resolves.toBe('created');
    await globals.navigator.credentials.store({} as Credential);
    await globals.navigator.credentials.preventSilentAccess();

    expect(original.get).toHaveBeenCalledWith({ mediation: 'silent' });
    expect(original.store).toHaveBeenCalled();
    expect(original.preventSilentAccess).toHaveBeenCalled();
    expect(plugin.get).not.toHaveBeenCalled();
  });

  it('answers null for a request without publicKey when the WebView has no API', async () => {
    const globals = fakeGlobals();
    install(globals);

    await expect(globals.navigator.credentials.get({})).resolves.toBeNull();
    await expect(globals.navigator.credentials.create({})).resolves.toBeNull();
    await expect(globals.navigator.credentials.store({} as Credential)).resolves.toBeUndefined();
    await expect(globals.navigator.credentials.preventSilentAccess()).resolves.toBeUndefined();
  });
});

// ============================================================================
// The native project
// ============================================================================

describe('the Android project', () => {
  const read = (path: string): string => readFileSync(resolve(import.meta.dirname, '../../../..', path), 'utf8');

  it('registers the plugin under the name the page asks for', () => {
    expect(read('android/app/src/main/java/app/kikouchou/PasskeyPlugin.java')).toContain('name = "Passkeys"');
    expect(read('android/app/src/main/java/app/kikouchou/MainActivity.java')).toContain(
      'registerPlugin(PasskeyPlugin.class)',
    );
  });

  it('keeps Google Play services out of the F-Droid build', () => {
    const gradle = read('android/app/build.gradle');

    // Resolved only behind the flavor check, which the F-Droid scanner needs.
    expect(gradle).toMatch(
      /if \(distributionFlavor != 'fdroid'\) \{\s*dependencies \{\s*playImplementation "androidx\.credentials:credentials-play-services-auth:/,
    );
    expect(gradle.match(/credentials-play-services-auth/g)).toHaveLength(1);
  });
});
