/**
 * @fileoverview `lib/platform`: which shell the page runs in, and the origin
 * every shareable link is built from.
 *
 * @module lib/platform/__tests__/platform.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const capacitor = vi.hoisted(() => ({
  getPlatform: vi.fn(() => 'web'),
  isPluginAvailable: vi.fn(() => true),
}));

vi.mock('@capacitor/core', () => ({ Capacitor: capacitor }));

import {
  NATIVE_AUTH_CALLBACK_URL,
  getAppPlatform,
  getPublicAppOrigin,
  hasNativePlugin,
  isNativeApp,
  resolveLinkOrigin,
} from '@/lib/platform';

describe('lib/platform', () => {
  beforeEach(() => {
    capacitor.getPlatform.mockReturnValue('web');
    capacitor.isPluginAvailable.mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is the website in a browser', () => {
    expect(getAppPlatform()).toBe('web');
    expect(isNativeApp()).toBe(false);
  });

  it.each(['ios', 'android'] as const)('is the %s app inside the store shell', (platform) => {
    capacitor.getPlatform.mockReturnValue(platform);

    expect(getAppPlatform()).toBe(platform);
    expect(isNativeApp()).toBe(true);
  });

  it('reads an unknown platform as the website', () => {
    capacitor.getPlatform.mockReturnValue('electron');

    expect(getAppPlatform()).toBe('web');
  });

  it('reads a throwing bridge as the website rather than failing the import', () => {
    capacitor.getPlatform.mockImplementation(() => {
      throw new Error('no bridge');
    });

    expect(getAppPlatform()).toBe('web');
    expect(hasNativePlugin('PushNotifications')).toBe(false);
  });

  it('reports a plugin only in a store app that compiled it in', () => {
    expect(hasNativePlugin('PushNotifications')).toBe(false);

    capacitor.getPlatform.mockReturnValue('android');
    expect(hasNativePlugin('PushNotifications')).toBe(true);

    // The F-Droid build leaves Firebase, and so the push plugin, out.
    capacitor.isPluginAvailable.mockReturnValue(false);
    expect(hasNativePlugin('PushNotifications')).toBe(false);
  });

  it('names the website as the public origin, with no trailing slash', () => {
    expect(getPublicAppOrigin()).toBe('https://app.kikouchou.app');

    vi.stubEnv('VITE_PUBLIC_APP_ORIGIN', 'https://staging.kikouchou.app/');
    expect(getPublicAppOrigin()).toBe('https://staging.kikouchou.app');
  });

  it('builds links from the page on the web and from the website in an app', () => {
    expect(resolveLinkOrigin('http://localhost:5173')).toBe('http://localhost:5173');

    capacitor.getPlatform.mockReturnValue('ios');
    // Nobody else can open capacitor://localhost.
    expect(resolveLinkOrigin('capacitor://localhost')).toBe('https://app.kikouchou.app');
  });

  it('returns sign-ins to the app scheme', () => {
    expect(NATIVE_AUTH_CALLBACK_URL).toBe('app.kikouchou://auth/callback');
  });
});
