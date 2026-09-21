/**
 * @fileoverview `lib/google-tag` loading rules.
 *
 * The module does its work at import time, like `lib/posthog` and
 * `lib/meta-pixel`, so every test here stubs the environment, resets the
 * module registry and imports it fresh.
 *
 * The container is the widest of the three trackers this app carries: it runs
 * whatever the GTM UI holds, in whatever browser loads the page. A dev server
 * that loads it therefore does more than report a stray visit. jsdom says
 * `window.location.hostname` is `localhost`, so these tests run on exactly the
 * hostname the guard exists for.
 *
 * @module lib/__tests__/google-tag.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================================
// Helpers
// ============================================================================

/** Imports the module fresh, so its import-time branch runs under the current env. */
async function importGoogleTag(): Promise<typeof import('@/lib/google-tag')> {
  vi.resetModules();
  return import('@/lib/google-tag');
}

/** The configuration a real deployment has. */
function withTags(): void {
  vi.stubEnv('VITE_GTM_CONTAINER_ID', 'GTM-THNTTWRZ');
  vi.stubEnv('VITE_GOOGLE_ADS_ID', 'AW-18455477906');
}

/** The `<script src>` values the module appended. */
function loadedScripts(): readonly string[] {
  return [...document.querySelectorAll('script')].map((script) => script.src);
}

/** Everything pushed onto `dataLayer`, as plain arrays. */
function dataLayerEntries(): readonly unknown[] {
  return [...(window.dataLayer ?? [])].map((entry) =>
    // A `gtag()` call pushes the `Arguments` object itself, which compares
    // badly against an array; every other entry is a plain object.
    typeof entry === 'object' && entry !== null && 'length' in entry
      ? Array.from(entry as ArrayLike<unknown>)
      : entry,
  );
}

/** A deployed host, so the guard lets the tags through. */
function onDeployedHost(): void {
  vi.stubGlobal('location', { hostname: 'app.kikouchou.app' });
}

beforeEach(() => {
  // `dataLayer` and `gtag` live on `window`, which persists across tests in
  // one file, so a later import would observe an earlier test's pushes.
  Reflect.deleteProperty(window, 'dataLayer');
  Reflect.deleteProperty(window, 'gtag');
  document.head.innerHTML = '';
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ============================================================================
// Tests
// ============================================================================

describe('lib/google-tag', () => {
  it('loads nothing with neither id configured', async () => {
    // The suite's own default, and a fresh clone's.
    const { default: gtag, isGoogleAdsTagEnabled } = await importGoogleTag();

    expect(gtag).toBeUndefined();
    expect(isGoogleAdsTagEnabled()).toBe(false);
    expect(loadedScripts()).toEqual([]);
    expect(window.dataLayer).toBeUndefined();
  });

  it('refuses to load on localhost even with both ids configured', async () => {
    withTags();
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const { isGoogleAdsTagEnabled } = await importGoogleTag();

    // The guard that makes a stray id in `.env.local` harmless. It matters
    // more here than for the other two: the container executes whatever the
    // GTM UI holds, so a dev load runs code this repository never saw.
    expect(isGoogleAdsTagEnabled()).toBe(false);
    expect(loadedScripts()).toEqual([]);
    expect(consoleInfo).toHaveBeenCalled();
    consoleInfo.mockRestore();
  });

  it.each([
    ['192.168.1.20', 'a phone loading `vite --host` over the LAN'],
    ['10.0.0.5', 'a private network'],
    ['kikouchou.local', 'mDNS'],
  ])('refuses to load on %s — %s', async (hostname) => {
    withTags();
    vi.stubGlobal('location', { hostname });
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const { isGoogleAdsTagEnabled } = await importGoogleTag();

    expect(isGoogleAdsTagEnabled()).toBe(false);
    expect(loadedScripts()).toEqual([]);
    consoleInfo.mockRestore();
  });

  it('only accepts a literal "true" as the localhost opt-in', async () => {
    withTags();
    vi.stubEnv('VITE_GOOGLE_TAG_ALLOW_LOCALHOST', 'false');
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const { isGoogleAdsTagEnabled } = await importGoogleTag();

    expect(isGoogleAdsTagEnabled()).toBe(false);
    consoleInfo.mockRestore();
  });

  it('loads the container first, then the Ads tag', async () => {
    withTags();
    onDeployedHost();

    const { isGoogleAdsTagEnabled } = await importGoogleTag();

    // Google's instructions ask for that order, and the two share `dataLayer`.
    expect(loadedScripts()).toEqual([
      'https://www.googletagmanager.com/gtm.js?id=GTM-THNTTWRZ',
      'https://www.googletagmanager.com/gtag/js?id=AW-18455477906',
    ]);
    expect(isGoogleAdsTagEnabled()).toBe(true);

    const entries = dataLayerEntries();
    expect(entries[0]).toMatchObject({ event: 'gtm.js' });
    expect(entries.at(-1)).toEqual(['config', 'AW-18455477906']);
  });

  it('asks the browser to keep the real error from a Google script', async () => {
    withTags();
    onDeployedHost();

    await importGoogleTag();

    // Without `crossorigin` a throw inside gtm.js reaches `window.onerror` as
    // the bare string "Script error." with no file, line or stack. The landing
    // page carries the same attribute for the same reason.
    const scripts = [...document.querySelectorAll('script')];
    expect(scripts.map((script) => script.crossOrigin)).toEqual([
      'anonymous',
      'anonymous',
    ]);
  });

  it('loads the container alone when no Ads account is configured', async () => {
    vi.stubEnv('VITE_GTM_CONTAINER_ID', 'GTM-THNTTWRZ');
    onDeployedHost();

    const { isGoogleAdsTagEnabled } = await importGoogleTag();

    expect(loadedScripts()).toEqual([
      'https://www.googletagmanager.com/gtm.js?id=GTM-THNTTWRZ',
    ]);
    // No Ads tag, so no conversion can be reported — and nothing throws.
    expect(isGoogleAdsTagEnabled()).toBe(false);
  });

  it('reports the install conversion configured for it', async () => {
    withTags();
    vi.stubEnv(
      'VITE_GOOGLE_ADS_INSTALL_CONVERSION',
      'AW-18455477906/KKbVCKuNgfocEJL9oOBE',
    );
    onDeployedHost();

    const { reportGoogleAdsInstallConversion } = await importGoogleTag();
    reportGoogleAdsInstallConversion();

    expect(dataLayerEntries().at(-1)).toEqual([
      'event',
      'conversion',
      { send_to: 'AW-18455477906/KKbVCKuNgfocEJL9oOBE' },
    ]);
  });

  it('reports no conversion when none is configured', async () => {
    withTags();
    onDeployedHost();

    const { reportGoogleAdsInstallConversion } = await importGoogleTag();
    const before = dataLayerEntries().length;
    reportGoogleAdsInstallConversion();

    // A half-configured conversion is worse than none: Google Ads would count
    // an install against whatever `send_to` it could make of it.
    expect(dataLayerEntries()).toHaveLength(before);
  });

  it('reports a plain event', async () => {
    withTags();
    onDeployedHost();

    const { trackGoogleTagEvent } = await importGoogleTag();
    trackGoogleTagEvent('page_view', { page_path: '/trips' });

    expect(dataLayerEntries().at(-1)).toEqual([
      'event',
      'page_view',
      { page_path: '/trips' },
    ]);
  });

  it('swallows every call when the tags are off, rather than throwing', async () => {
    // `main.tsx` imports this at bootstrap and call sites do not check, so a
    // throw here would blank the app over a lost ad event.
    const { trackGoogleTagEvent, reportGoogleAdsConversion, reportGoogleAdsInstallConversion } =
      await importGoogleTag();

    expect(() => {
      trackGoogleTagEvent('page_view');
      reportGoogleAdsConversion({ send_to: 'AW-1/abc' });
      reportGoogleAdsInstallConversion();
    }).not.toThrow();
    expect(window.dataLayer).toBeUndefined();
  });
});
