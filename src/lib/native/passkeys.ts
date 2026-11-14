/**
 * @fileoverview Passkeys in the Android app, through Credential Manager.
 *
 * A passkey is bound to the rpId `app.kikouchou.app`, and the Android app's
 * page runs on `https://localhost`. Chromium refuses that pair, in the
 * WebView's app mode too, so `navigator.credentials` cannot sign in there.
 * Android's Credential Manager can, as the app: `assetlinks.json` grants the
 * app the website's passkeys (`delegate_permission/common.get_login_creds`),
 * and the signed answer names the origin `android:apk-key-hash:<signing key>`,
 * which the Supabase project accepts (`webauthn_rp_origins` in
 * `supabase/config.toml`).
 *
 * `installNativePasskeys()` puts a `navigator.credentials` in front of the
 * WebView's own, which hands every `publicKey` request to the `Passkeys`
 * plugin (`android/.../PasskeyPlugin.java`). auth-js keeps doing the whole
 * Supabase side: it asks for the options, calls `navigator.credentials`, and
 * sends the answer back. Nothing about the account flow forks per platform.
 *
 * Both directions are WebAuthn's JSON form: binary fields as base64url
 * strings. Credential Manager reads and writes that form, so the plugin only
 * moves strings.
 *
 * @module lib/native/passkeys
 */

import { registerPlugin } from '@capacitor/core';

import { getAppPlatform, hasNativePlugin } from '@/lib/platform';

// ============================================================================
// Type Definitions
// ============================================================================

interface PasskeyResult {
  /** WebAuthn's `RegistrationResponseJSON` or `AuthenticationResponseJSON`. */
  readonly responseJson: string;
}

interface PasskeysPlugin {
  get(options: { readonly requestJson: string }): Promise<PasskeyResult>;
  create(options: { readonly requestJson: string }): Promise<PasskeyResult>;
}

/** The JSON form of a credential, as Credential Manager returns it. */
interface CredentialJson {
  readonly id: string;
  readonly rawId?: string;
  readonly type: string;
  readonly response: Record<string, unknown>;
  readonly authenticatorAttachment?: string | null;
  readonly clientExtensionResults?: Record<string, unknown>;
}

/** What the page sees of `navigator.credentials`; enough to replace it. */
type CredentialsLike = Pick<CredentialsContainer, 'get' | 'create'> &
  Partial<Pick<CredentialsContainer, 'store' | 'preventSilentAccess'>>;

type PublicKeyCredentialConstructor = abstract new () => PublicKeyCredential;

/** The two globals this module touches, passed in so tests can hand fakes. */
interface PasskeyGlobals {
  readonly navigator: Navigator;
  readonly window: Window & { PublicKeyCredential?: PublicKeyCredentialConstructor };
}

// ============================================================================
// Constants
// ============================================================================

const PLUGIN_NAME = 'Passkeys';

/**
 * The response fields that are bytes, so the credential object can hand them
 * out as `ArrayBuffer`s like a browser does. auth-js reads `toJSON()`, which
 * is the string form, but anything that reads the object reads bytes.
 */
const BINARY_RESPONSE_FIELDS = [
  'clientDataJSON',
  'authenticatorData',
  'signature',
  'userHandle',
  'attestationObject',
  'publicKey',
] as const;

/** Registered on first use, so loading this module on the website costs nothing. */
let plugin: PasskeysPlugin | undefined;

function getPlugin(): PasskeysPlugin {
  plugin ??= registerPlugin<PasskeysPlugin>(PLUGIN_NAME);
  return plugin;
}

// ============================================================================
// Encoding
// ============================================================================

/**
 * Base64url without padding, the encoding WebAuthn's JSON form uses.
 *
 * @param bytes - The bytes to encode
 */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The bytes of a base64url string, padded or not.
 *
 * @param value - The base64url text
 */
export function fromBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

/**
 * WebAuthn options in their JSON form: every `BufferSource` becomes base64url,
 * at any depth, and everything else is kept. That is the whole difference
 * between `PublicKeyCredentialRequestOptions` and its JSON twin, and the same
 * for creation.
 *
 * @param value - The `publicKey` member of a `navigator.credentials` call
 */
export function toWebAuthnJson(value: unknown): unknown {
  if (value instanceof ArrayBuffer) {
    return toBase64Url(new Uint8Array(value));
  }
  if (ArrayBuffer.isView(value)) {
    return toBase64Url(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  if (Array.isArray(value)) {
    return value.map(toWebAuthnJson);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, toWebAuthnJson(entry)]),
    );
  }
  return value;
}

function parseCredentialJson(text: string): CredentialJson {
  const parsed: unknown = JSON.parse(text);
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    typeof (parsed as CredentialJson).id !== 'string' ||
    (parsed as CredentialJson).type !== 'public-key' ||
    (parsed as CredentialJson).response === null ||
    typeof (parsed as CredentialJson).response !== 'object'
  ) {
    throw new DOMException('Credential Manager returned no passkey', 'UnknownError');
  }
  return parsed as CredentialJson;
}

/**
 * A `PublicKeyCredential` the page can use, built from Credential Manager's
 * JSON. It inherits from the WebView's own class, because auth-js checks
 * `instanceof PublicKeyCredential`, and `toJSON()` returns the JSON as it
 * came, which is what auth-js sends to Supabase.
 */
function toCredential(json: CredentialJson, Credential: PublicKeyCredentialConstructor): PublicKeyCredential {
  const serialised: CredentialJson = {
    ...json,
    rawId: json.rawId ?? json.id,
    clientExtensionResults: json.clientExtensionResults ?? {},
  };
  const response: Record<string, unknown> = { ...json.response };
  for (const field of BINARY_RESPONSE_FIELDS) {
    const entry = response[field];
    if (typeof entry === 'string') {
      response[field] = fromBase64Url(entry);
    }
  }

  const credential = Object.create(Credential.prototype) as PublicKeyCredential;
  // Own properties shadow the prototype's getters, which throw on an object
  // the browser did not make.
  Object.defineProperties(credential, {
    id: { value: json.id, enumerable: true },
    rawId: { value: fromBase64Url(serialised.rawId ?? json.id), enumerable: true },
    type: { value: 'public-key', enumerable: true },
    authenticatorAttachment: { value: json.authenticatorAttachment ?? null, enumerable: true },
    response: { value: response, enumerable: true },
    getClientExtensionResults: { value: () => serialised.clientExtensionResults },
    toJSON: { value: () => serialised },
  });
  return credential;
}

// ============================================================================
// Public API
// ============================================================================

/** Whether this is the Android app and it carries the passkey plugin. */
export function hasNativePasskeys(): boolean {
  return getAppPlatform() === 'android' && hasNativePlugin(PLUGIN_NAME);
}

/**
 * Routes the page's passkey requests to Credential Manager, in the Android app
 * only. Returns whether it did. Call once, before anything renders: the
 * sign-in screen decides whether to offer a passkey on its first render
 * (`features/auth/passkeys`).
 *
 * A request without `publicKey` (a stored password, say) goes to the
 * WebView's own `navigator.credentials`, when it has one.
 *
 * @param globals - The real `navigator` and `window` by default
 */
export function installNativePasskeys(
  globals: PasskeyGlobals = { navigator, window },
): boolean {
  if (!hasNativePasskeys()) {
    return false;
  }

  const { navigator: nav, window: win } = globals;
  // The WebView may expose no WebAuthn at all, and auth-js asks for the class
  // before it asks for a passkey.
  if (typeof win.PublicKeyCredential !== 'function') {
    Object.defineProperty(win, 'PublicKeyCredential', {
      configurable: true,
      writable: true,
      value: class PublicKeyCredential {},
    });
  }
  const Credential = win.PublicKeyCredential as PublicKeyCredentialConstructor;
  const original = nav.credentials as CredentialsLike | undefined;

  const run = async (
    method: 'get' | 'create',
    publicKey: object,
    signal: AbortSignal | null | undefined,
  ): Promise<Credential> => {
    if (signal?.aborted) {
      throw new DOMException('The operation was aborted', 'AbortError');
    }
    let result: PasskeyResult;
    try {
      result = await getPlugin()[method]({ requestJson: JSON.stringify(toWebAuthnJson(publicKey)) });
    } catch (error: unknown) {
      // The plugin rejects with the DOMException name a browser would throw,
      // so auth-js tells a cancelled sheet from a broken one the same way.
      const code = (error as { code?: unknown }).code;
      const message = error instanceof Error ? error.message : 'Passkey request failed';
      throw new DOMException(message, typeof code === 'string' ? code : 'UnknownError');
    }
    return toCredential(parseCredentialJson(result.responseJson), Credential);
  };

  const credentials: CredentialsLike = {
    get: (options?: CredentialRequestOptions) =>
      options?.publicKey
        ? run('get', options.publicKey, options.signal)
        : (original?.get(options) ?? Promise.resolve(null)),
    create: (options?: CredentialCreationOptions) =>
      options?.publicKey
        ? run('create', options.publicKey, options.signal)
        : (original?.create(options) ?? Promise.resolve(null)),
    store: (credential: Credential) => original?.store?.(credential) ?? Promise.resolve(),
    preventSilentAccess: () => original?.preventSilentAccess?.() ?? Promise.resolve(),
  };

  Object.defineProperty(nav, 'credentials', {
    configurable: true,
    value: credentials,
  });
  return true;
}
