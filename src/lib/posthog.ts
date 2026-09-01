/**
 * @fileoverview PostHog browser analytics and error tracking.
 *
 * The app is local-first and ships no server, so this is the only PostHog
 * client: it initializes once at bootstrap (imported from `main.tsx`) and every
 * call site captures through the default export.
 *
 * The export is `undefined` whenever `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST`
 * are absent — a fresh clone, a fork's CI, or a unit test — so call sites use
 * `posthog?.capture(...)` and analytics simply goes quiet. This module must
 * never throw: it is evaluated at import time by `main.tsx` and, transitively,
 * by every component test, so a throw here blanks the app and fails test
 * collection rather than just losing events.
 *
 * Captures are anonymous by design. The app has no accounts, and trip guests
 * are domain records rather than identities, so nothing is passed to
 * `identify()` — a shared browser would otherwise misattribute events.
 *
 * @module lib/posthog
 */

import posthog from 'posthog-js';

const posthogKey = import.meta.env.VITE_POSTHOG_KEY;
const posthogHost = import.meta.env.VITE_POSTHOG_HOST;

let posthogClient: typeof posthog | undefined;

if (posthogKey && posthogHost) {
  posthog.init(posthogKey, {
    api_host: posthogHost,
    defaults: '2026-05-30',
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      // Console errors are noisy and cost ingestion; unhandled errors and
      // rejections are the signal worth paying for.
      capture_console_errors: false,
    },
  });
  posthogClient = posthog;
} else if (import.meta.env.DEV && !import.meta.env.VITEST) {
  console.warn(
    `PostHog is disabled: ${posthogKey ? 'VITE_POSTHOG_HOST' : 'VITE_POSTHOG_KEY'} is not set. ` +
      'Analytics and error tracking will be silently skipped. Set both in .env to enable them.',
  );
}

export default posthogClient;
