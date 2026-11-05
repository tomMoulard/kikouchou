/**
 * @fileoverview The temporary layout probe for old Android WebViews.
 *
 * @module lib/native/__tests__/layout-probe.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const capture = vi.hoisted(() => vi.fn());
const platform = vi.hoisted(() => ({ value: 'android' as 'android' | 'ios' | 'web' }));

vi.mock('@/lib/posthog', () => ({ captureEvent: capture }));
vi.mock('@/lib/platform', () => ({ getAppPlatform: () => platform.value }));

const OLD_WEBVIEW =
  'Mozilla/5.0 (Linux; Android 11; OnePlus8Pro; wv) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Version/4.0 Chrome/90.0.4430.210 Mobile Safari/537.36 Kikouchou-Native';
const NEW_WEBVIEW = OLD_WEBVIEW.replace('Chrome/90.0.4430.210', 'Chrome/157.0.0.0');

function useUserAgent(userAgent: string): void {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(userAgent);
}

describe('chromeMajorVersion', () => {
  it('reads the major version', async () => {
    const { chromeMajorVersion } = await import('../layout-probe');
    expect(chromeMajorVersion(OLD_WEBVIEW)).toBe(90);
  });

  it('answers null for a browser that is not Chrome', async () => {
    const { chromeMajorVersion } = await import('../layout-probe');
    expect(chromeMajorVersion('Mozilla/5.0 (iPhone) Version/18.0 Safari/605.1.15')).toBeNull();
  });
});

describe('measureLayout', () => {
  it('measures the window, the header and the insets, and no text', async () => {
    useUserAgent(OLD_WEBVIEW);
    document.body.innerHTML = '<header>Kikouchou</header><main>Trip</main>';
    const { measureLayout } = await import('../layout-probe');

    const layout = measureLayout(window);

    expect(layout).toMatchObject({
      chrome: 90,
      inner_width: window.innerWidth,
      inner_height: window.innerHeight,
      header_top: 0,
      inset_top: 0,
    });
    expect(layout).toMatchObject({ native: null });
    expect(JSON.stringify(layout)).not.toContain('Kikouchou');
    // The probe element is gone again.
    expect(document.body.children).toHaveLength(2);
  });

  it('reports what the Android shell handed the page', async () => {
    useUserAgent(OLD_WEBVIEW);
    document.body.innerHTML = '<header></header>';
    document.documentElement.style.setProperty('--app-inset-top', '37.0px');
    const native = { status_top: 37, cutout_top: 93, webview_top: 0, density: 2.225 };
    (window as Window & { __kikouchouInsets?: unknown }).__kikouchouInsets = native;
    const { measureLayout } = await import('../layout-probe');

    expect(measureLayout(window)).toMatchObject({ app_inset_top: '37.0px', native });

    document.documentElement.style.removeProperty('--app-inset-top');
    delete (window as Window & { __kikouchouInsets?: unknown }).__kikouchouInsets;
  });

  it('answers null for the header when there is none', async () => {
    useUserAgent(OLD_WEBVIEW);
    document.body.innerHTML = '<main></main>';
    const { measureLayout } = await import('../layout-probe');

    expect(measureLayout(window)).toMatchObject({ header_top: null, above_header: null });
  });
});

describe('probeLayout', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    capture.mockReset();
    platform.value = 'android';
    document.body.innerHTML = '<header></header>';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    ['an old WebView', 90],
    ['a current WebView', 157],
  ] as const)('reports once, two seconds after the first paint, on %s', async (_label, chrome) => {
    useUserAgent(chrome === 90 ? OLD_WEBVIEW : NEW_WEBVIEW);
    const { probeLayout } = await import('../layout-probe');

    probeLayout();
    probeLayout();
    expect(capture).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(
      'layout_probed',
      expect.objectContaining({
        first: expect.objectContaining({ chrome }),
        settled: expect.objectContaining({ chrome }),
      }),
    );
  });

  it.each([
    ['the website', OLD_WEBVIEW, 'web'],
    ['the iPhone app', 'Mozilla/5.0 (iPhone) Safari/605.1.15', 'ios'],
  ] as const)('stays silent on %s', async (_label, userAgent, target) => {
    useUserAgent(userAgent);
    platform.value = target;
    const { probeLayout } = await import('../layout-probe');

    probeLayout();
    vi.advanceTimersByTime(2000);

    expect(capture).not.toHaveBeenCalled();
  });
});
