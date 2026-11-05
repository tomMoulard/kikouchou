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
    expect(JSON.stringify(layout)).not.toContain('Kikouchou');
    // The probe element is gone again.
    expect(document.body.children).toHaveLength(2);
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

  it('reports once, two seconds after the first paint, on an old Android WebView', async () => {
    useUserAgent(OLD_WEBVIEW);
    const { probeLayout } = await import('../layout-probe');

    probeLayout();
    probeLayout();
    expect(capture).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(
      'layout_probed',
      expect.objectContaining({
        first: expect.objectContaining({ chrome: 90 }),
        settled: expect.objectContaining({ chrome: 90 }),
      }),
    );
  });

  it.each([
    ['a current WebView', NEW_WEBVIEW, 'android'],
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
