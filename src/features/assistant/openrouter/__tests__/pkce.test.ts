/**
 * @fileoverview Unit tests for the PKCE helpers.
 * @module features/assistant/openrouter/__tests__/pkce.test
 */

import { describe, expect, it } from 'vitest';

import {
  createCodeChallenge,
  createCodeVerifier,
  createState,
  toBase64Url,
} from '../pkce';

describe('PKCE helpers', () => {
  it('derives the S256 challenge of the RFC 7636 example', async () => {
    // Appendix B of RFC 7636: the same verifier must give the same challenge,
    // or OpenRouter refuses every exchange this app makes.
    await expect(
      createCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    ).resolves.toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('makes a verifier of the length RFC 7636 accepts, in the base64url alphabet', () => {
    const verifier = createCodeVerifier();

    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
  });

  it('never repeats a verifier or a state', () => {
    expect(createCodeVerifier()).not.toBe(createCodeVerifier());
    expect(createState()).not.toBe(createState());
  });

  it('encodes without padding and with the URL-safe characters', () => {
    expect(toBase64Url(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
  });
});
