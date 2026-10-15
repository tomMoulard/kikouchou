/**
 * @fileoverview PKCE helpers for the OpenRouter sign-in.
 *
 * RFC 7636 with the S256 method: a random verifier stays on the device, and
 * only its SHA-256 digest travels in the authorization URL. A code that leaks
 * on the way back (browser history, a referrer, an extension) is useless to
 * anyone without the verifier.
 *
 * @module features/assistant/openrouter/pkce
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Random bytes behind a verifier. 32 bytes encode to 43 base64url characters,
 * the minimum length RFC 7636 accepts and plenty of entropy.
 */
const VERIFIER_BYTES = 32;

/** Random bytes behind the `state` value that pairs a callback with its request. */
const STATE_BYTES = 16;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Encodes bytes as unpadded base64url, the alphabet both PKCE and OpenRouter
 * expect.
 */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBase64Url(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

// ============================================================================
// Public API
// ============================================================================

/** A fresh PKCE code verifier. */
export function createCodeVerifier(): string {
  return randomBase64Url(VERIFIER_BYTES);
}

/** A fresh `state` value, to refuse a callback this device did not ask for. */
export function createState(): string {
  return randomBase64Url(STATE_BYTES);
}

/**
 * The S256 challenge for a verifier: base64url of its SHA-256 digest.
 *
 * @param verifier - The verifier that will be sent at the code exchange
 * @returns The challenge to put in the authorization URL
 */
export async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return toBase64Url(new Uint8Array(digest));
}
