/**
 * @fileoverview `lib/native/deep-links`: what the store app does with a link
 * the operating system opened it with.
 *
 * @module lib/native/__tests__/deep-links.test
 */

import { describe, expect, it } from 'vitest';

import { resolveDeepLink, type DeepLinkOrigins } from '@/lib/native/deep-links';

const ORIGINS: DeepLinkOrigins = {
  app: 'https://app.kikouchou.app',
  share: 'https://share.kikouchou.app',
  scheme: 'app.kikouchou',
};

const TOKEN = 'OMIMwxRIi6TF_KP6';

describe('resolveDeepLink', () => {
  it('opens a website page as the same route, query and fragment included', () => {
    expect(
      resolveDeepLink('https://app.kikouchou.app/trip/room-1?x=1#secret-key', ORIGINS),
    ).toEqual({ kind: 'navigate', to: '/trip/room-1?x=1#secret-key' });
    expect(resolveDeepLink(`https://app.kikouchou.app/join/${TOKEN}`, ORIGINS)).toEqual({
      kind: 'navigate',
      to: `/join/${TOKEN}`,
    });
  });

  it('skips the preview page and goes where its redirect would', () => {
    expect(resolveDeepLink(`https://share.kikouchou.app/fr/${TOKEN}`, ORIGINS)).toEqual({
      kind: 'navigate',
      to: `/join/${TOKEN}?lng=fr`,
    });
    expect(resolveDeepLink(`https://share.kikouchou.app/en/t/${TOKEN}`, ORIGINS)).toEqual({
      kind: 'navigate',
      to: `/template/${TOKEN}?lng=en`,
    });
    // Before language negotiation.
    expect(resolveDeepLink(`https://share.kikouchou.app/${TOKEN}`, ORIGINS)).toEqual({
      kind: 'navigate',
      to: `/join/${TOKEN}`,
    });
  });

  it('ignores what the preview service would 404', () => {
    expect(resolveDeepLink('https://share.kikouchou.app/fr/short', ORIGINS)).toEqual({
      kind: 'ignore',
    });
    expect(resolveDeepLink(`https://share.kikouchou.app/fr/${TOKEN}/card.png`, ORIGINS)).toEqual({
      kind: 'ignore',
    });
    expect(resolveDeepLink('https://share.kikouchou.app/healthz', ORIGINS)).toEqual({
      kind: 'ignore',
    });
  });

  it('hands a sign-in answer to the auth layer', () => {
    expect(resolveDeepLink('app.kikouchou://auth/callback?code=abc', ORIGINS)).toEqual({
      kind: 'auth',
      then: null,
    });
    expect(
      resolveDeepLink('app.kikouchou://auth/callback?error=access_denied', ORIGINS),
    ).toEqual({ kind: 'auth', then: null });
    // A magic link lands on the website's return page, then the trips.
    expect(resolveDeepLink('https://app.kikouchou.app/auth/native?code=abc', ORIGINS)).toEqual({
      kind: 'auth',
      then: '/trips',
    });
  });

  it('ignores the app scheme without an answer, and every other host', () => {
    expect(resolveDeepLink('app.kikouchou://somewhere', ORIGINS)).toEqual({ kind: 'ignore' });
    expect(resolveDeepLink('https://evil.example/join/abc', ORIGINS)).toEqual({ kind: 'ignore' });
    expect(resolveDeepLink('http://app.kikouchou.app/trips', ORIGINS)).toEqual({ kind: 'ignore' });
    expect(resolveDeepLink('not a url', ORIGINS)).toEqual({ kind: 'ignore' });
  });

  it('ignores share links when the build has no preview service', () => {
    expect(
      resolveDeepLink(`https://share.kikouchou.app/fr/${TOKEN}`, { ...ORIGINS, share: '' }),
    ).toEqual({ kind: 'ignore' });
  });
});
