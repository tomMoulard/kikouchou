/**
 * @fileoverview `lib/meta-pixel` loading rules.
 *
 * The module does its work at import time, like `lib/posthog`, so every test
 * here stubs the environment, resets the module registry and imports it fresh.
 *
 * What is being defended is the same accident one account further out. PostHog
 * filled with nineteen people minted on loopback; an ad pixel that loads on a
 * dev server reports that traffic to a live ad account, where it is billed and
 * where it trains the campaign's optimiser on visitors who were never real.
 * jsdom reports `window.location.hostname` as `localhost`, so these tests run
 * on exactly the hostname that caused it.
 *
 * @module lib/__tests__/meta-pixel.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================================
// Helpers
// ============================================================================

/** Imports the module fresh, so its import-time branch runs under the current env. */
async function importPixel(): Promise<typeof import('@/lib/meta-pixel')> {
  vi.resetModules();
  return import('@/lib/meta-pixel');
}

/** The configuration a real deployment has. */
function withPixelId(): void {
  vi.stubEnv('VITE_META_PIXEL_ID', '2066436523976108');
}

/** Every `fbq(...)` call the module made, in order. */
function fbqCalls(): readonly unknown[][] {
  const fbq = window.fbq;
  return fbq === undefined ? [] : ((fbq.queue ?? []) as unknown[][]);
}

/** The `<script src>` values the module appended. */
function loadedScripts(): readonly string[] {
  return [...document.querySelectorAll('script')].map((script) => script.src);
}

beforeEach(() => {
  // The stub the snippet installs lives on `window`, which persists across
  // tests in one file — so a second import would take the re-entry guard's
  // early return and observe the first test's calls.
  Reflect.deleteProperty(window, 'fbq');
  Reflect.deleteProperty(window, '_fbq');
  document.head.innerHTML = '';
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ============================================================================
// Tests
// ============================================================================

describe('lib/meta-pixel', () => {
  it('loads nothing and exports undefined without an id', async () => {
    // The suite's own default, and a fresh clone's: `vitest.config.ts` blanks
    // it. Every call site is a no-op because of this.
    const { default: pixel, isMetaPixelEnabled } = await importPixel();

    expect(pixel).toBeUndefined();
    expect(isMetaPixelEnabled()).toBe(false);
    expect(window.fbq).toBeUndefined();
    expect(loadedScripts()).toEqual([]);
  });

  it('refuses to load on localhost even with an id configured', async () => {
    withPixelId();
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const { isMetaPixelEnabled } = await importPixel();

    // The guard that makes a stray id in `.env.local` harmless, and the one
    // that does not have to be remembered by a new entry point.
    expect(isMetaPixelEnabled()).toBe(false);
    expect(loadedScripts()).toEqual([]);
    expect(consoleInfo).toHaveBeenCalled();
    consoleInfo.mockRestore();
  });

  it.each([
    ['192.168.1.20', 'a phone loading `vite --host` over the LAN'],
    ['10.0.0.5', 'a private network'],
    ['172.20.1.9', 'the other RFC 1918 range'],
    ['169.254.4.4', 'a link-local address'],
    ['kikouchou.local', 'mDNS'],
    ['app.localhost', 'an RFC 6761 loopback subdomain'],
  ])('refuses to load on %s — %s', async (hostname) => {
    withPixelId();
    vi.stubGlobal('location', { hostname });
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const { isMetaPixelEnabled } = await importPixel();

    expect(isMetaPixelEnabled()).toBe(false);
    expect(loadedScripts()).toEqual([]);
    consoleInfo.mockRestore();
  });

  it('only accepts a literal "true" as the localhost opt-in', async () => {
    withPixelId();
    // `.env` values are strings, so a truthy-looking `false` must not open the
    // door — the same trap `VITE_POSTHOG_ALLOW_LOCALHOST` has.
    vi.stubEnv('VITE_META_PIXEL_ALLOW_LOCALHOST', 'false');
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const { isMetaPixelEnabled } = await importPixel();

    expect(isMetaPixelEnabled()).toBe(false);
    consoleInfo.mockRestore();
  });

  it('loads on a real deployment host, and initializes exactly one pixel', async () => {
    withPixelId();
    // The guard must not be so broad that it silences production. That failure
    // mode costs everything the change is for.
    vi.stubGlobal('location', { hostname: 'app.kikouchou.app' });

    const { isMetaPixelEnabled } = await importPixel();

    expect(isMetaPixelEnabled()).toBe(true);
    expect(loadedScripts()).toEqual(['https://connect.facebook.net/en_US/fbevents.js']);
    expect(fbqCalls()).toEqual([
      ['init', '2066436523976108'],
      ['track', 'PageView'],
    ]);
  });

  it('reports a custom event, which is how the PWA install is measured', async () => {
    withPixelId();
    vi.stubGlobal('location', { hostname: 'app.kikouchou.app' });

    const { trackMetaPixelCustomEvent } = await importPixel();
    trackMetaPixelCustomEvent('AppInstalled', { via_prompt: true });

    // Queued rather than sent: `fbevents.js` has not loaded in jsdom, and the
    // library replays `fbq.queue` when it does. That queueing is the reason no
    // call site has to wait for the script.
    expect(fbqCalls().at(-1)).toEqual([
      'trackCustom',
      'AppInstalled',
      { via_prompt: true },
    ]);
  });

  it('reports a standard event under Meta own name for it', async () => {
    withPixelId();
    vi.stubGlobal('location', { hostname: 'app.kikouchou.app' });

    const { trackMetaPixelEvent } = await importPixel();
    trackMetaPixelEvent('Lead');

    expect(fbqCalls().at(-1)).toEqual(['track', 'Lead', undefined]);
  });

  it('swallows every call when the pixel is off, rather than throwing', async () => {
    // `main.tsx` imports this module at bootstrap and call sites do not check,
    // so a throw here would blank the app over a lost ad event.
    const { trackMetaPixelEvent, trackMetaPixelCustomEvent } = await importPixel();

    expect(() => {
      trackMetaPixelEvent('Lead');
      trackMetaPixelCustomEvent('AppInstalled', { via_prompt: false });
    }).not.toThrow();
    expect(window.fbq).toBeUndefined();
  });

  it('never loads the library twice', async () => {
    withPixelId();
    vi.stubGlobal('location', { hostname: 'app.kikouchou.app' });

    await importPixel();
    await importPixel();

    // A hot reload re-evaluates the module, and two copies of `fbevents.js`
    // would double every event the page reports.
    expect(loadedScripts()).toEqual(['https://connect.facebook.net/en_US/fbevents.js']);
  });
});
