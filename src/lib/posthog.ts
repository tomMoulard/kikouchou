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
 * Events are tied to the Supabase account once somebody signs in:
 * `AuthContext` calls `identify()` with `user.id` so a person's events line up
 * across their devices, and `reset()` on sign-out so the next person on a shared
 * browser does not inherit that identity. Before a sign-in, and in a build with
 * no backend, captures stay anonymous.
 *
 * That is a change from how this started. It said captures were anonymous "by
 * design" because "the app has no accounts", which stopped being true when
 * Supabase auth landed.
 *
 * Trip guests remain domain records rather than identities — nothing about a
 * guest is ever passed to `identify()`. Only the signed-in account is.
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
  // Attached to every event from here on, so any question can be sliced by
  // release without each call site having to remember to pass it. Set at init
  // rather than per capture: it cannot change while the page is loaded.
  posthog.register({ app_version: import.meta.env.VITE_APP_VERSION ?? 'dev' });

  posthogClient = posthog;
} else if (import.meta.env.DEV && !import.meta.env.VITEST) {
  console.warn(
    `PostHog is disabled: ${posthogKey ? 'VITE_POSTHOG_HOST' : 'VITE_POSTHOG_KEY'} is not set. ` +
      'Analytics and error tracking will be silently skipped. Set both in .env to enable them.',
  );
}

export default posthogClient;
