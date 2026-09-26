/**
 * @fileoverview Analytics in the store apps.
 *
 * A store app serves its bundled files from `localhost`, the hostname every
 * development guard refuses. Without the platform check PostHog would never
 * start in a shipped app; with a careless one, a dev build in the simulator
 * would report to the real project. And the two ad trackers must never load
 * there at all.
 *
 * @module lib/__tests__/native-analytics.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ value: 'ios' as string }));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => platform.value, isPluginAvailable: () => true },
}));

const mockInit = vi.fn();
const mockRegister = vi.fn();

vi.mock('posthog-js', () => ({
  default: {
    init: (...args: unknown[]) => mockInit(...args),
    register: (...args: unknown[]) => mockRegister(...args),
    reset: vi.fn(),
    capture: vi.fn(),
    setPersonProperties: vi.fn(),
  },
}));

beforeEach(() => {
  vi.resetModules();
  mockInit.mockClear();
  mockRegister.mockClear();
  platform.value = 'ios';
  Reflect.deleteProperty(window, 'fbq');
  Reflect.deleteProperty(window, '_fbq');
  document.head.innerHTML = '';
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isDevelopmentHost in a store app', () => {
  it('is not a dev host in a production build, whatever the hostname says', async () => {
    vi.stubEnv('DEV', false);
    const { isDevelopmentHost } = await import('@/lib/analytics/development-host');

    // jsdom reports `localhost`, as a store app's web view does.
    expect(isDevelopmentHost()).toBe(false);
  });

  it('stays a dev host in a development build, the live-reload shell', async () => {
    vi.stubEnv('DEV', true);
    const { isDevelopmentHost } = await import('@/lib/analytics/development-host');

    expect(isDevelopmentHost()).toBe(true);
  });

  it('keeps refusing localhost on the website', async () => {
    platform.value = 'web';
    vi.stubEnv('DEV', false);
    const { isDevelopmentHost } = await import('@/lib/analytics/development-host');

    expect(isDevelopmentHost()).toBe(true);
  });
});

describe('trackers in a store app', () => {
  it('starts PostHog, and says which app sent the event', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test_token');
    vi.stubEnv('VITE_POSTHOG_HOST', 'https://events.kikouchou.app');

    await import('@/lib/posthog');

    expect(mockInit).toHaveBeenCalled();
    expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'ios', display_mode: 'standalone' }),
    );
  });

  it('never loads the Meta pixel', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_META_PIXEL_ID', '2066436523976108');

    const { isMetaPixelEnabled } = await import('@/lib/meta-pixel');

    expect(isMetaPixelEnabled()).toBe(false);
    expect(document.querySelectorAll('script')).toHaveLength(0);
  });

  it('never loads the Google tags', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_GTM_CONTAINER_ID', 'GTM-THNTTWRZ');
    vi.stubEnv('VITE_GOOGLE_ADS_ID', 'AW-18455477906');

    await import('@/lib/google-tag');

    expect(document.querySelectorAll('script')).toHaveLength(0);
  });
});

describe('the store app is installed by definition', () => {
  it('reads as standalone, so no install offer appears', async () => {
    const { isRunningStandalone, readDisplayMode } = await import('@/lib/pwa/display-mode');

    expect(readDisplayMode()).toBe('standalone');
    expect(isRunningStandalone()).toBe(true);
  });
});
