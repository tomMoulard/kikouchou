/**
 * @fileoverview A one-off measurement of the page's geometry in an Android
 * store app that runs on an old WebView. TEMPORARY: remove it once the stale
 * band above the header is understood.
 *
 * On a OnePlus 8 Pro with its factory Android System WebView (Chrome 90),
 * 0.1.5 to 0.1.7 draw a squashed, stale copy of the header in a band between
 * the status bar and the page. Neither edge-to-edge nor R8 caused it, and the
 * page renders correctly in Chrome on the same phone. This sends what the page
 * sees of its own geometry, once per launch, as `layout_probed`, so the next
 * fix is made from measurements instead of guesses.
 *
 * Numbers only: no text, no trip data. Only for an Android store app on Chrome
 * older than 100, so no other device reports anything.
 *
 * @module lib/native/layout-probe
 */

import { captureEvent } from '@/lib/posthog';
import { getAppPlatform } from '@/lib/platform';

// ============================================================================
// Constants
// ============================================================================

/** Below this Chrome major version, the probe runs. */
const PROBED_BELOW_CHROME = 100;

/** Sent once per launch. */
let probed = false;

// ============================================================================
// Helpers
// ============================================================================

/**
 * The Chrome major version in a user agent, or `null` when it names none.
 *
 * @param userAgent - `navigator.userAgent`
 */
export function chromeMajorVersion(userAgent: string): number | null {
  const match = /Chrome\/(\d+)\./.exec(userAgent);
  return match ? Number(match[1]) : null;
}

/** Rounds a measurement to a tenth of a pixel. */
function px(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The four `env(safe-area-inset-*)` values, read through a probe element. */
function safeAreaInsets(doc: Document): Record<string, number> {
  const probe = doc.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;' +
    'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) ' +
    'env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  doc.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const insets = {
    inset_top: px(parseFloat(style.paddingTop) || 0),
    inset_right: px(parseFloat(style.paddingRight) || 0),
    inset_bottom: px(parseFloat(style.paddingBottom) || 0),
    inset_left: px(parseFloat(style.paddingLeft) || 0),
  };
  probe.remove();
  return insets;
}

/**
 * What the page measures of itself: the window, the visual viewport, the
 * safe-area insets, where the header is, and what sits just above it.
 *
 * @param win - The window to measure
 */
export function measureLayout(win: Window): Record<string, unknown> {
  const doc = win.document;
  const header = doc.querySelector('header');
  const rect = header?.getBoundingClientRect();
  const above = rect && rect.top > 2 ? doc.elementFromPoint(win.innerWidth / 2, rect.top / 2) : null;
  const viewport = win.visualViewport;
  return {
    chrome: chromeMajorVersion(win.navigator.userAgent),
    dpr: win.devicePixelRatio,
    inner_width: win.innerWidth,
    inner_height: win.innerHeight,
    outer_height: win.outerHeight,
    screen_width: win.screen.width,
    screen_height: win.screen.height,
    client_height: doc.documentElement.clientHeight,
    scroll_y: px(win.scrollY),
    visual_height: viewport ? px(viewport.height) : null,
    visual_offset_top: viewport ? px(viewport.offsetTop) : null,
    visual_scale: viewport ? px(viewport.scale) : null,
    header_top: rect ? px(rect.top) : null,
    header_height: rect ? px(rect.height) : null,
    header_position: header ? getComputedStyle(header).position : null,
    body_padding_top: px(parseFloat(getComputedStyle(doc.body).paddingTop) || 0),
    html_padding_top: px(parseFloat(getComputedStyle(doc.documentElement).paddingTop) || 0),
    // A tag name and an id at most, never text.
    above_header: above ? `${above.tagName.toLowerCase()}${above.id ? `#${above.id}` : ''}` : null,
    ...safeAreaInsets(doc),
  };
}

// ============================================================================
// Probe
// ============================================================================

/**
 * Sends `layout_probed` once per launch, in an Android store app on an old
 * WebView, and does nothing anywhere else. Called by `NativeShell` after the
 * first paint; it measures again two seconds later, once the window has
 * settled, and sends both.
 *
 * @param win - The window; the real one by default
 */
export function probeLayout(win: Window = window): void {
  if (probed || getAppPlatform() !== 'android') {
    return;
  }
  const chrome = chromeMajorVersion(win.navigator.userAgent);
  if (chrome === null || chrome >= PROBED_BELOW_CHROME) {
    return;
  }
  probed = true;
  const first = measureLayout(win);
  win.setTimeout(() => {
    captureEvent('layout_probed', { first, settled: measureLayout(win) });
  }, 2000);
}
