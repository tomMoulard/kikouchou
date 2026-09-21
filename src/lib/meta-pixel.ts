/**
 * @fileoverview Meta Pixel, for measuring the ads that bring people here.
 *
 * This sits beside `lib/posthog` rather than replacing any part of it. PostHog
 * is the product analytics this app is understood through; the pixel exists so
 * a Meta ad campaign can be optimised against what those visitors go on to do.
 * Every event worth reporting is therefore reported twice, once to each, and
 * neither call site may drop the other — see `hooks/useInstallPrompt`.
 *
 * Meta's own snippet is meant to be pasted into `<head>`. It is here instead
 * because a `<script>` in `index.html` runs on every load of every build,
 * including `bun run dev`, `vite preview` and the Playwright web servers, and
 * loopback traffic in an ad account is the same accident that once filled the
 * PostHog project with nineteen phantom people. Loading the pixel from a module
 * lets it read {@link isDevelopmentHost} and the `VITE_META_PIXEL_ID`
 * environment variable, so a build with no id configured — a fresh clone, a
 * fork's CI, every unit test — loads nothing at all.
 *
 * Like `lib/posthog`, this module must never throw: `main.tsx` imports it at
 * module scope, so a throw here blanks the app rather than merely losing an
 * event. Every export is a no-op when the pixel is not loaded.
 *
 * What may be sent: counts, flags and enum values. A trip name, a guest name
 * or a place goes to Meta under no circumstances. Meta is an advertising
 * network rather than an analytics tool this project controls, so the
 * exception `lib/posthog` makes for `assistant_prompt_sent` has no counterpart
 * here.
 *
 * @module lib/meta-pixel
 */

import { isDevelopmentHost } from '@/lib/analytics/development-host';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * The queue-then-send function Meta's snippet installs on `window`.
 *
 * Calls made before `fbevents.js` arrives are pushed onto `fbq.queue` and
 * replayed by the library on load, which is why nothing here has to wait for
 * the script.
 */
type Fbq = ((...args: readonly unknown[]) => void) & {
  callMethod?: (...args: readonly unknown[]) => void;
  queue?: unknown[];
  push?: unknown;
  loaded?: boolean;
  version?: string;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

/**
 * Properties of one pixel event.
 *
 * Deliberately narrow: an object of primitives, not `unknown`. A value that
 * cannot be written as a number, a string or a flag is a value nobody thought
 * about before sending it to an ad network.
 */
export type MetaPixelProperties = Readonly<Record<string, string | number | boolean>>;

// ============================================================================
// Constants
// ============================================================================

/** Where Meta serves the pixel library from. */
const FBEVENTS_SRC = 'https://connect.facebook.net/en_US/fbevents.js';

/**
 * The pixel id, from Meta Events Manager. Absent means the pixel is off.
 */
const pixelId = import.meta.env.VITE_META_PIXEL_ID;

/**
 * The deliberate opt-in for loading the pixel on a dev server.
 *
 * Off by default, and the same shape as `VITE_POSTHOG_ALLOW_LOCALHOST`: set it
 * for the one session where you need to watch events arrive in Events Manager,
 * then unset it. Every load with it on is real traffic in a real ad account.
 */
const allowLocalhost = import.meta.env.VITE_META_PIXEL_ALLOW_LOCALHOST === 'true';

// ============================================================================
// Loading
// ============================================================================

/**
 * Installs the queueing stub and appends Meta's script tag.
 *
 * A transcription of the snippet Events Manager hands out, with its own
 * re-entry guard (`if (window.fbq) return`) kept, so a hot reload cannot load
 * the library twice.
 */
function loadPixelLibrary(): Fbq {
  const existing = window.fbq;
  if (existing) {
    return existing;
  }

  const fbq: Fbq = (...args: readonly unknown[]): void => {
    if (fbq.callMethod) {
      fbq.callMethod(...args);
      return;
    }
    fbq.queue?.push(args);
  };

  fbq.queue = [];
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = '2.0';

  window.fbq = fbq;
  window._fbq ??= fbq;

  const script = document.createElement('script');
  script.async = true;
  script.src = FBEVENTS_SRC;
  document.head.appendChild(script);

  return fbq;
}

/**
 * The live pixel, or `undefined` when it is off.
 *
 * Module scope, like `lib/posthog`'s client: initialisation happens once, at
 * bootstrap, and every call site reads the result.
 */
let pixel: Fbq | undefined;

if (!pixelId) {
  if (import.meta.env.DEV && !import.meta.env.VITEST) {
    console.warn(
      'Meta Pixel is disabled: VITE_META_PIXEL_ID is not set. Ad measurement ' +
        'will be silently skipped. Set it in .env to enable it.',
    );
  }
} else if (typeof window === 'undefined' || typeof document === 'undefined') {
  // No DOM: a unit test that imported a module that imported this one.
} else if (isDevelopmentHost() && !allowLocalhost) {
  // The guard that does not have to be remembered by each new entry point.
  // Blanking the id in every config file is necessary and not sufficient: a
  // build served from loopback never loads the library at all, so no pageview,
  // no conversion, and no developer counted as a person who saw the ad.
  console.info(
    '[meta-pixel] Disabled on %s. A dev server would report real traffic to ' +
      'the ad account. Set VITE_META_PIXEL_ALLOW_LOCALHOST=true to override.',
    window.location.hostname,
  );
} else {
  pixel = loadPixelLibrary();
  pixel('init', pixelId);
  pixel('track', 'PageView');
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Reports one of Meta's standard events, e.g. `Lead`, `CompleteRegistration`.
 *
 * A no-op when the pixel is off, which is most of the time — no caller checks.
 */
export function trackMetaPixelEvent(
  event: string,
  properties?: MetaPixelProperties,
): void {
  pixel?.('track', event, properties);
}

/**
 * Reports an event of this app's own naming.
 *
 * Meta's standard event list has nothing for a PWA install — `fbq` knows about
 * mobile app installs only through Meta's iOS and Android SDKs, and a web page
 * cannot produce one — so the install is reported this way. A custom event is
 * a first-class thing in Events Manager: it can be turned into a custom
 * conversion and optimised against, exactly like a standard event.
 *
 * A no-op when the pixel is off.
 */
export function trackMetaPixelCustomEvent(
  event: string,
  properties?: MetaPixelProperties,
): void {
  pixel?.('trackCustom', event, properties);
}

/** Whether the pixel actually loaded. Exported for tests and diagnostics. */
export function isMetaPixelEnabled(): boolean {
  return pixel !== undefined;
}

export default pixel;
