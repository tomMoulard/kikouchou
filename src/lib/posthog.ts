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
 * A visitor becomes a PostHog person on their first event, before any account
 * exists — see `person_profiles` below for why that is worth its cost. Signing
 * in does not start a second person: `AuthContext` calls `identify()` with the
 * Supabase `user.id`, and PostHog merges the anonymous person into the account,
 * so everything the person did before signing up stays on the same timeline.
 * The properties passed alongside — email, display name, how they sign in, when
 * the account was created — are what make that person something other than a
 * UUID nobody can match to its `auth.users` row. `reset()` fires on sign-out so
 * the next person on a shared browser does not inherit that identity; they get
 * a fresh anonymous id, and therefore a fresh anonymous person.
 *
 * That is two changes from how this started. It first said captures were
 * anonymous "by design" because "the app has no accounts", which stopped being
 * true when Supabase auth landed; and it then created a person only at
 * `identify()`, which threw away everything a visitor did before signing up.
 *
 * Trip guests remain domain records rather than identities — nothing about a
 * guest is ever passed to `identify()`. Only the signed-in account is.
 *
 * **Two guards below exist because development polluted the project.** PostHog
 * held 20 persons against three real Supabase accounts; 19 of them were
 * anonymous ids minted on `localhost:3000`, `localhost:5173` and the e2e
 * servers, and not one came from production. See the constants for the
 * mechanism behind each guard. They matter more now than when they were
 * written: with a person per visitor, a dev server that reaches PostHog does
 * not merely add events, it adds people.
 *
 * @module lib/posthog
 */

import posthog from 'posthog-js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Exact hostnames that mean "this is somebody's machine, not the deployed app".
 */
const DEVELOPMENT_HOSTNAMES: readonly string[] = ['localhost', '::1', '[::1]', '0.0.0.0'];

/**
 * Hostname shapes that mean the same thing.
 *
 * Loopback is only half of it. `vite --host` binds to the LAN so a phone can
 * load the app, and that phone sees `192.168.1.20`, not `localhost` — which is
 * exactly the session where somebody is most likely to be poking at the app by
 * hand. `.localhost` resolves to loopback by RFC 6761 and `.local` is mDNS, so
 * both are a machine on a desk rather than a deployment.
 *
 * Nothing here can match the deployment host, which is the property that
 * matters: a false positive costs a day of analytics, a false negative costs
 * the project another nineteen people.
 */
const DEVELOPMENT_HOSTNAME_PATTERNS: readonly RegExp[] = [
  /\.localhost$/,
  /\.local$/,
  /^127\./, // loopback, all of 127.0.0.0/8
  /^10\./, // RFC 1918 private
  /^192\.168\./, // RFC 1918 private
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC 1918 private
  /^169\.254\./, // link-local, e.g. an ad-hoc connection
];

/**
 * Whether this document is being served from a developer's own machine.
 *
 * Reads `window` defensively: this module is evaluated at import time and must
 * never throw, and it is imported by unit tests whose environment is not
 * guaranteed to have a DOM.
 */
function isDevelopmentHost(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const { hostname } = window.location;
  return (
    DEVELOPMENT_HOSTNAMES.includes(hostname) ||
    DEVELOPMENT_HOSTNAME_PATTERNS.some((pattern) => pattern.test(hostname))
  );
}

// ============================================================================
// Initialization
// ============================================================================

const posthogKey = import.meta.env.VITE_POSTHOG_KEY;
const posthogHost = import.meta.env.VITE_POSTHOG_HOST;

/**
 * The deliberate opt-in for capturing from a dev server.
 *
 * Off by default. Set `VITE_POSTHOG_ALLOW_LOCALHOST=true` in `.env.local` for
 * the session where you actually need to watch events arrive, and unset it
 * again — every load with it on is a real person row in the real project.
 */
const allowLocalhost = import.meta.env.VITE_POSTHOG_ALLOW_LOCALHOST === 'true';

/**
 * The super properties this module owns.
 *
 * Named rather than inlined at the `register()` call because `reset()` wipes
 * persisted properties and they have to be put back — see
 * {@link resetAnalyticsIdentity}. One definition, so the two cannot drift.
 */
const BASE_SUPER_PROPERTIES = {
  app_version: import.meta.env.VITE_APP_VERSION ?? 'dev',
} as const;

let posthogClient: typeof posthog | undefined;

if (!posthogKey || !posthogHost) {
  if (import.meta.env.DEV && !import.meta.env.VITEST) {
    console.warn(
      `PostHog is disabled: ${posthogKey ? 'VITE_POSTHOG_HOST' : 'VITE_POSTHOG_KEY'} is not set. ` +
        'Analytics and error tracking will be silently skipped. Set both in .env to enable them.',
    );
  }
} else if (isDevelopmentHost() && !allowLocalhost) {
  // Defence in depth, and the reason the project filled up with phantom people.
  //
  // A key reaches a dev server far too easily: Vite loads `.env.local` for the
  // dev server, for `vite preview`, for Vitest and for Playwright's own
  // servers, and a `COPY . .` in the Dockerfile used to bake it into the image
  // nginx serves on :3000. Blanking the key in each of those places is
  // necessary but not sufficient — every new entry point has to remember. This
  // check does not have to remember: a build served from loopback never
  // initializes at all, so no capture, no person, no `$pageview`.
  console.info(
    '[posthog] Disabled on %s. Analytics from a dev server would create real ' +
      'people in the real project. Set VITE_POSTHOG_ALLOW_LOCALHOST=true to override.',
    window.location.hostname,
  );
} else {
  posthog.init(posthogKey, {
    api_host: posthogHost,
    defaults: '2026-05-30',

    /**
     * A person exists from the first pageview, with no account behind it.
     *
     * The alternative is posthog-js's own `'identified_only'` default, which
     * this ran until it became clear what it costs. An event captured under it
     * carries `$process_person_profile: false`, and PostHog does not fold those
     * events into the person a later `identify()` creates — so the visitor who
     * opened a shared trip, came back for a week and then signed up arrives as
     * a person whose history begins at the sign-up, with the part that explains
     * *why* they signed up missing. Most of this app works signed out, which
     * makes that the majority of what there is to learn.
     *
     * With `'always'` the anonymous distinct id owns a person from the first
     * event, and `identify()` merges it into the account rather than opening a
     * second one. The `$initial_*` properties posthog-js writes from the first
     * landing — referrer, UTM, entry path — survive that merge, so acquisition
     * is answerable about people who eventually became accounts.
     *
     * What it costs, weighed and accepted: a signed-out visitor is now a person
     * row rather than nothing, and every signed-out event is billed at
     * PostHog's identified rate rather than its anonymous one. The development
     * guards above are what keep that honest — each one of them now suppresses
     * a person that would otherwise be created, where before it suppressed only
     * an event.
     */
    person_profiles: 'always',

    /**
     * Disabled, and this is the single line that caused the 19 phantom people.
     *
     * `defaults: '2026-05-30'` turns this on as `/^(localhost|127\.0\.0\.1)$/`.
     * On a match posthog-js calls `setInternalOrTestUser()`, which goes through
     * `setPersonProperties()` — one of the calls that force
     * `$process_person_profile = true`. Back when `person_profiles` was
     * `'identified_only'` that override *was* the bug: it minted a persisted
     * anonymous person on every dev-server load and every fresh Playwright
     * browser context.
     *
     * `'always'` does not retire this line, it only changes what it is for.
     * Forcing a profile is no longer an override of anything, but the call
     * still stamps the person as an internal user from a hostname — a property
     * this project has no use for and no way to unset in bulk. Whether a
     * development load reaches PostHog at all is decided above, by
     * `isDevelopmentHost()`; `null` is the documented way to switch this off
     * while keeping the rest of the dated defaults.
     */
    internal_or_test_user_hostname: null,

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
  posthog.register(BASE_SUPER_PROPERTIES);

  posthogClient = posthog;
}

// ============================================================================
// Identity
// ============================================================================

/**
 * Drops the current identity, then puts back what init had registered.
 *
 * `reset()` alone is not enough. It calls `persistence.clear()` internally,
 * which wipes *every* persisted property — super properties included — so a
 * bare `reset()` leaves the rest of that tab's session reporting no
 * `app_version` at all. Every event after a sign-out would fall out of any
 * breakdown by release, which is the one super property the whole project is
 * sliced by.
 *
 * Whoever registered a super property owns restoring it: this restores what
 * this module set, and `AuthContext` restores `signed_in` after calling here.
 * Safe with no client — analytics is simply off.
 */
export function resetAnalyticsIdentity(): void {
  if (!posthogClient) {
    return;
  }
  posthogClient.reset();
  posthogClient.register(BASE_SUPER_PROPERTIES);
}

// ============================================================================
// Usage
// ============================================================================

/**
 * The domain events that mean a person *used* the app.
 *
 * A closed union rather than a `string`, because the set is the definition of
 * activity for this project and a new member should be a decision somebody
 * makes rather than a typo that silently widens it. Everything absent is absent
 * on purpose:
 *
 * - `account_trip_sync`, `trip_sync_offline`, `trip_sync_recovered` fire from a
 *   sign-in sweep and from connectivity transitions. A phone flapping between
 *   cell and wifi in somebody's pocket is not a person doing something.
 * - `trip_join_failed`, `trip_join_blocked`, `trip_share_blocked`,
 *   `trip_identity_claim_failed` and `assistant_answer_failed` are attempts that
 *   went nowhere. Counting them lets a broken invite raise engagement.
 * - `assistant_answer_received` is the reply to `assistant_prompt_sent`; both
 *   would count one action twice.
 * - `trip_identity_claimed` and `trip_identity_skipped` are steps inside the
 *   join flow that `trip_joined` already counts.
 * - `pwa_install_completed` happens once per device, ever.
 * - `trip_deleted` is a deliberate action but it is cleanup, not use.
 */
export type UsageAction =
  | 'activity_saved'
  | 'assistant_prompt_sent'
  | 'guest_group_imported'
  | 'guest_group_saved'
  | 'person_saved'
  | 'room_saved'
  | 'transport_saved'
  | 'trip_created'
  | 'trip_imported'
  | 'trip_joined'
  | 'trip_updated'
  | 'vehicle_saved';

/**
 * The one event that means "a person used this app".
 *
 * PostHog's activity setting — what it counts as engagement for active users
 * and stickiness — takes a **single** event name, and no one domain event fits:
 * `activity_saved` misses everybody who only edited rooms, `$pageview` counts
 * anyone who merely landed. So the app emits a dedicated event beside whichever
 * domain event actually happened, and that name is what the setting points at.
 *
 * Note that "activity" in `activity_saved` is the domain object — an itinerary
 * item — and has nothing to do with this. Hence `app_used` rather than any name
 * built on the overloaded word.
 */
export const USAGE_EVENT = 'app_used';

/**
 * Captures a domain event and the usage event that shadows it.
 *
 * One function rather than two calls at each of thirteen call sites: the second
 * capture is exactly the kind of thing that gets forgotten when a tenth action
 * is added, and a silently incomplete activity definition reads as a drop in
 * active users with nothing to point at.
 *
 * The domain event keeps its own properties untouched, so every insight and
 * funnel already built on it is unaffected. `app_used` carries only which
 * action it shadowed — the detail stays on the event that has it.
 *
 * Safe with no client, like every other call here: analytics is simply off.
 */
export function captureUsage(
  action: UsageAction,
  properties?: Record<string, unknown>,
): void {
  posthogClient?.capture(action, properties);
  posthogClient?.capture(USAGE_EVENT, { action });
}

export default posthogClient;
