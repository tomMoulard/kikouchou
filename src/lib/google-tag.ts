/**
 * @fileoverview The Google tags: the GTM container and the Google Ads tag.
 *
 * The landing page (`kikouchou-LP/index.html`) carries both of these in its
 * `<head>`, and this module is the app's half of the same pair. Together with
 * `lib/meta-pixel` it makes the install measurable by the two ad platforms the
 * campaigns run on; `lib/posthog` remains the analytics the product itself is
 * understood through, and none of the three replaces either of the others.
 *
 * Two tags, in the order Google's own instructions ask for them:
 *
 *   1. **The GTM container** (`VITE_GTM_CONTAINER_ID`). A tag manager rather
 *      than a tag: whatever is configured in the GTM UI runs in this app
 *      without a deploy. That is the convenience it is installed for and the
 *      hazard it brings — a container that can inject a script into the app
 *      can read the page, so who holds access to it is now part of this app's
 *      security boundary. It shares `dataLayer` with the tag below, which is
 *      why it must load first.
 *   2. **The Google Ads tag** (`VITE_GOOGLE_ADS_ID`, e.g. `AW-…`), configured
 *      here rather than in the container so that a conversion this repo fires
 *      cannot be silenced by a change nobody made in git.
 *
 * Both are loaded from a module rather than pasted into `index.html`, for the
 * reason `lib/meta-pixel` is: a `<script>` there runs on every load of every
 * build, `bun run dev`, `vite preview` and the three Playwright web servers
 * included, and loopback traffic in an ad account is billed and trains the
 * campaign's optimiser on visitors who were never real. A missing id means the
 * tag is off entirely, so a fresh clone, a fork's CI and every unit test load
 * nothing.
 *
 * `crossOrigin = 'anonymous'` on both injected scripts is the third thing
 * taken from the landing page. A cross-origin `<script>` without it is opaque
 * to `window.onerror` by specification, so anything `gtm.js` or `gtag/js`
 * throws arrives as the bare string `Script error.` with no file, line or
 * stack — see `lib/posthog`'s `readableExternalScript` for the same fix on the
 * same problem.
 *
 * Like `lib/posthog` and `lib/meta-pixel`, this module must never throw:
 * `main.tsx` imports it at module scope, so a throw blanks the app rather than
 * losing an ad event. Every export is a no-op when the tags are off.
 *
 * What may be sent: counts, flags and enum values. Google Ads is an
 * advertising network rather than an analytics tool this project controls, so
 * no guest name, no trip name and no place goes through here.
 *
 * @module lib/google-tag
 */

import { isDevelopmentHost } from '@/lib/analytics/development-host';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * The queue `gtag.js` and `gtm.js` both read.
 *
 * Calls made before either script arrives are pushed onto it and replayed on
 * load, which is why nothing here has to wait for the network.
 */
type DataLayer = unknown[];

/** The `gtag()` shim Google's snippet defines. It only pushes to `dataLayer`. */
type Gtag = (...args: readonly unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: DataLayer;
    gtag?: Gtag;
  }
}

/**
 * Parameters of one Google Ads conversion.
 *
 * `event_callback` is Google's own: it runs once the beacon has left, which is
 * what {@link reportGoogleAdsConversion} uses to avoid holding a navigation
 * open longer than it has to.
 */
export interface GoogleAdsConversion {
  /** The conversion, as `AW-<account>/<label>`. */
  readonly send_to: string;
  readonly value?: number;
  readonly currency?: string;
  readonly event_callback?: () => void;
}

// ============================================================================
// Constants
// ============================================================================

/** Where Google serves both scripts from. */
const GOOGLE_TAG_ORIGIN = 'https://www.googletagmanager.com';

/** The GTM container, e.g. `GTM-THNTTWRZ`. Absent means no container. */
const containerId = import.meta.env.VITE_GTM_CONTAINER_ID;

/** The Google Ads account, e.g. `AW-18455477906`. Absent means no Ads tag. */
const adsId = import.meta.env.VITE_GOOGLE_ADS_ID;

/**
 * The Google Ads conversion the PWA install counts as, as `AW-…/<label>`.
 *
 * A whole `send_to` rather than a label appended to {@link adsId}, because a
 * conversion can belong to a different Ads account from the one the page is
 * configured with, and a half-built identifier is the kind of thing that fails
 * silently in an ad platform. Absent means the install reports no conversion —
 * the tag still loads and the pageview is still counted.
 */
const installConversionSendTo = import.meta.env.VITE_GOOGLE_ADS_INSTALL_CONVERSION;

/**
 * The deliberate opt-in for loading the tags on a dev server.
 *
 * Off by default, the same shape as `VITE_POSTHOG_ALLOW_LOCALHOST` and
 * `VITE_META_PIXEL_ALLOW_LOCALHOST`: set it for the one session where you need
 * to watch tags fire, then unset it.
 */
const allowLocalhost = import.meta.env.VITE_GOOGLE_TAG_ALLOW_LOCALHOST === 'true';

// ============================================================================
// Loading
// ============================================================================

/** Ensures `window.dataLayer` exists, and returns it. */
function ensureDataLayer(): DataLayer {
  window.dataLayer ??= [];
  return window.dataLayer;
}

/**
 * Appends one of Google's scripts, readable when it throws.
 */
function appendGoogleScript(src: string): void {
  const script = document.createElement('script');
  script.async = true;
  // See the file header: without this a throw inside the script is delivered
  // as `Script error.` with nothing attached. googletagmanager.com answers a
  // CORS request by reflecting the origin, so it costs nothing.
  script.crossOrigin = 'anonymous';
  script.src = src;
  document.head.appendChild(script);
}

/**
 * Loads the GTM container.
 *
 * A transcription of Google's snippet, including the `gtm.start` timing entry
 * the container reads to report how long it waited.
 */
function loadContainer(id: string): void {
  const dataLayer = ensureDataLayer();
  dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
  appendGoogleScript(`${GOOGLE_TAG_ORIGIN}/gtm.js?id=${encodeURIComponent(id)}`);
}

/**
 * Loads `gtag.js` and configures the Google Ads account.
 *
 * The shim must push `arguments` itself rather than an array built from it:
 * `gtag.js` reads the `Arguments` object's own shape, and a plain array is
 * silently ignored. That is why this one function uses `arguments` where the
 * rest of the codebase uses rest parameters.
 */
function loadAdsTag(id: string): Gtag {
  const dataLayer = ensureDataLayer();
  appendGoogleScript(`${GOOGLE_TAG_ORIGIN}/gtag/js?id=${encodeURIComponent(id)}`);

  const gtag: Gtag = function gtag(): void {
    // eslint-disable-next-line prefer-rest-params -- gtag.js requires the Arguments object itself.
    dataLayer.push(arguments);
  };

  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', id);

  return gtag;
}

/**
 * The live `gtag`, or `undefined` when the Ads tag is off.
 *
 * Module scope, like `lib/posthog`'s client and `lib/meta-pixel`'s queue:
 * loading happens once, at bootstrap, and every call site reads the result.
 */
let gtagClient: Gtag | undefined;

if (!containerId && !adsId) {
  if (import.meta.env.DEV && !import.meta.env.VITEST) {
    console.warn(
      'Google tags are disabled: neither VITE_GTM_CONTAINER_ID nor ' +
        'VITE_GOOGLE_ADS_ID is set. Set them in .env to enable them.',
    );
  }
} else if (typeof window === 'undefined' || typeof document === 'undefined') {
  // No DOM: a unit test that imported a module that imported this one.
} else if (isDevelopmentHost() && !allowLocalhost) {
  console.info(
    '[google-tag] Disabled on %s. A dev server would report real traffic to ' +
      'the ad account. Set VITE_GOOGLE_TAG_ALLOW_LOCALHOST=true to override.',
    window.location.hostname,
  );
} else {
  // Order matters: Google's instructions put the container first, and the two
  // share `dataLayer`.
  if (containerId) {
    loadContainer(containerId);
  }
  if (adsId) {
    gtagClient = loadAdsTag(adsId);
  }
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Reports one event to the Google tag.
 *
 * A no-op when the Ads tag is off, which is most of the time — no caller
 * checks.
 */
export function trackGoogleTagEvent(
  event: string,
  parameters?: Readonly<Record<string, unknown>>,
): void {
  gtagClient?.('event', event, parameters);
}

/**
 * Reports a Google Ads conversion.
 *
 * The landing page fires its own on a click through to this app
 * (`gtag_report_conversion` in `kikouchou-LP/index.html`); this is how the
 * app reports what happened after that click.
 *
 * A no-op when the Ads tag is off.
 */
export function reportGoogleAdsConversion(conversion: GoogleAdsConversion): void {
  gtagClient?.('event', 'conversion', conversion);
}

/**
 * Reports the PWA install as a Google Ads conversion.
 *
 * The third reporter of one event, beside `pwa_install_completed` in PostHog
 * and `AppInstalled` in the Meta Pixel — see `hooks/useInstallPrompt`, which
 * fires all three from the browser's own `appinstalled`. Each answers a
 * question the others cannot: what the product did, what Meta should optimise
 * against, and what Google Ads should.
 *
 * No `value`, no `currency`, deliberately. The landing page's click conversion
 * declares `1.0 EUR` because a Google Ads conversion action can be configured
 * to take its value from the tag, and this app has no money to attach to an
 * install. Set the value on the conversion action in Google Ads instead, where
 * changing it does not need a deploy.
 *
 * A no-op when the Ads tag is off or no conversion is configured.
 */
export function reportGoogleAdsInstallConversion(): void {
  if (!installConversionSendTo) {
    return;
  }
  reportGoogleAdsConversion({ send_to: installConversionSendTo });
}

/** Whether the Google Ads tag actually loaded. Exported for tests. */
export function isGoogleAdsTagEnabled(): boolean {
  return gtagClient !== undefined;
}

export default gtagClient;
