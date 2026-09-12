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
import type { CaptureResult } from 'posthog-js';

import { readDisplayMode } from '@/lib/pwa/display-mode';

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
// Exception handling
// ============================================================================

/**
 * Lets an error thrown by a PostHog-loaded script arrive readable.
 *
 * posthog-js fetches `recorder.js`, `surveys.js` and `toolbar.js` at runtime by
 * appending a `<script>` to the document, and those come from
 * `events.kikouchou.app` — a different origin from the page. A cross-origin
 * script tag with no `crossorigin` attribute is opaque to the error handler by
 * specification: whatever it throws reaches `window.onerror` as the literal
 * `"Script error."` with the filename, line, column and stack blanked. That is
 * an error this project cannot read, cannot attribute and therefore cannot fix.
 *
 * `crossOrigin = 'anonymous'` makes the browser fetch it as a CORS request and
 * keep the real message and stack. The asset host answers
 * `access-control-allow-origin: *`, which is what makes this safe: with the
 * attribute set and the header missing the browser would refuse the script
 * outright, and session replay and surveys would stop loading rather than
 * merely reporting badly. It is the same guarantee `index.html` already relies
 * on — Vite emits the app's own bundle with `crossorigin`.
 *
 * Exported for tests; wired in at init below.
 */
export function readableExternalScript(script: HTMLScriptElement): HTMLScriptElement {
  script.crossOrigin = 'anonymous';
  return script;
}

/**
 * The exception values a browser uses when it refuses to describe an error.
 *
 * A script loaded from another origin without CORS headers has its error
 * sanitized before `window.onerror` ever sees it: the message becomes the
 * literal `"Script error."` and the filename, line, column and stack are
 * blanked. Chrome and Firefox emit the trailing period; WebKit has shipped both
 * spellings, so both are listed.
 */
const OPAQUE_EXCEPTION_VALUES: readonly string[] = ['Script error.', 'Script error'];

/** One entry of `$exception_list`, narrowed to the two fields this reads. */
interface ExceptionListEntry {
  value?: unknown;
  stacktrace?: { frames?: unknown } | null;
}

/**
 * Whether one captured exception carries nothing anybody could act on.
 *
 * Both halves are required. The message alone is not enough — an app that
 * genuinely threw `new Error('Script error.')` would be silenced by a
 * message-only test — so an entry counts as opaque only when the browser also
 * withheld every frame.
 */
function isOpaqueCrossOriginException(entry: ExceptionListEntry): boolean {
  const value = typeof entry.value === 'string' ? entry.value.trim() : '';
  if (!OPAQUE_EXCEPTION_VALUES.includes(value)) {
    return false;
  }
  const frames = entry.stacktrace?.frames;
  return !Array.isArray(frames) || frames.length === 0;
}

/**
 * The one issue every unreadable error is filed under.
 *
 * PostHog groups exceptions by `$exception_fingerprint`, and it computes one
 * from the message and the stack when the event does not carry its own. For an
 * opaque error there is no stack and the message is a constant, so the
 * computed fingerprint is stable but meaningless — an issue named `Error` whose
 * description is `Script error.`, which says nothing about what it holds.
 *
 * Naming the fingerprint here puts every one of them in a single issue that
 * reads as what it is. Nothing is lost: the events still arrive, with their
 * URL, session, release and device, and a session replay to watch.
 */
const OPAQUE_EXCEPTION_FINGERPRINT = 'opaque-cross-origin-script';

/**
 * Marks an exception the browser refused to describe, and sends it anyway.
 *
 * The issue behind this is one unhandled, synthetic `Error: Script error.` from
 * Mobile Safari on `/trips` with no stack, no file and no line. The cause is
 * addressed above, at the only place this app can address it:
 * {@link readableExternalScript} makes every script posthog-js injects report
 * its errors in full, so an error from that source is no longer opaque and
 * never reaches this function. The app's own bundle was never the source — it
 * is same-origin and Vite emits it with `crossorigin`.
 *
 * What remains is genuinely outside the app: a browser extension's content
 * script, or an in-app webview injecting its own JavaScript. No code in this
 * repository can stop those from throwing, so the honest handling is to keep
 * reporting them and make them tractable, which is what the two properties do.
 * `opaque_cross_origin` makes them addressable in any insight or filter, and
 * the fingerprint collapses them into one named issue instead of leaving them
 * to blur into whatever else PostHog decides they resemble.
 *
 * Only an exception whose *every* entry is opaque is marked. One with a
 * readable entry beside an opaque one keeps its own grouping, because that
 * readable entry is the cause and it is what somebody would fix.
 *
 * Must not throw: posthog-js calls this on the way out of every capture, so a
 * throw here would be an error raised by the error reporter. Every unexpected
 * shape returns the event untouched.
 *
 * Exported for tests; wired in as `before_send` below.
 */
export function markOpaqueExceptions(event: CaptureResult | null): CaptureResult | null {
  if (!event || event.event !== '$exception') {
    return event;
  }
  const list: unknown = event.properties?.['$exception_list'];
  if (!Array.isArray(list) || list.length === 0) {
    return event;
  }
  const everyEntryIsOpaque = list.every(
    (entry: unknown) =>
      typeof entry === 'object' &&
      entry !== null &&
      isOpaqueCrossOriginException(entry as ExceptionListEntry),
  );
  if (!everyEntryIsOpaque) {
    return event;
  }
  event.properties['opaque_cross_origin'] = true;
  event.properties['$exception_fingerprint'] = OPAQUE_EXCEPTION_FINGERPRINT;
  return event;
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
  /**
   * `standalone` for an installed app, `browser` for a tab.
   *
   * The question this project most wants answered — do people who install
   * come back more than people who do not? — was unanswerable before this
   * property existed: `pwa_install_completed` says an install happened, and
   * nothing said which of the later events came from the installed copy. Read
   * once at init: a page does not change how it is displayed while loaded.
   */
  display_mode: readDisplayMode(),
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

    /**
     * Where the PostHog app itself lives, as opposed to where events go.
     *
     * `VITE_POSTHOG_HOST` points at `events.kikouchou.app`, a reverse proxy
     * this organization owns in front of PostHog's EU ingestion host. The proxy
     * is what keeps a content blocker from dropping analytics: the requests go
     * to a first-party domain rather than to a domain on every blocklist.
     *
     * posthog-js otherwise assumes the ingestion host is also the app host, and
     * builds the toolbar and session-replay links from `api_host` — which would
     * point them at the proxy, where the PostHog UI is not served. This project
     * is on EU cloud, the same region the source-map upload in
     * `.github/workflows/deploy.yml` targets. Hardcoded rather than read from
     * the environment: it is a property of the PostHog project, not of a
     * deployment, and it must not follow the proxy domain when that changes.
     */
    ui_host: 'https://eu.posthog.com',

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

    /**
     * Runs on every `<script>` posthog-js appends for its own lazy bundles.
     *
     * See {@link readableExternalScript}: without it a throw inside session
     * replay or surveys reaches this project as `"Script error."` and nothing
     * else. This is the fix for the cause rather than for the symptom.
     */
    prepare_external_dependency_script: readableExternalScript,

    /**
     * The last gate before an event leaves the browser. Nothing is dropped
     * here.
     *
     * Only {@link markOpaqueExceptions} runs, and it only ever adds two
     * properties, to the one exception shape a browser refuses to describe. See
     * it for what is left once the cause above is fixed, and why that remainder
     * is worth reporting rather than discarding.
     */
    before_send: markOpaqueExceptions,
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
// Capture
// ============================================================================

/**
 * Every event name this app captures itself.
 *
 * A closed union, for the reason {@link UsageAction} is one: the set of things
 * this project measures is a decision somebody makes, and a free `string`
 * parameter turns a typo into a second event that quietly splits an insight in
 * half. It covers only the app's own events — posthog-js keeps capturing
 * `$pageview`, `$exception` and the rest under names it owns, and LLM analytics
 * captures `$ai_generation` through the client directly, because those names
 * belong to PostHog's schema rather than to this list.
 */
export type AnalyticsEvent =
  | UsageAction
  | DeletionEvent
  | typeof USAGE_EVENT
  // Account
  | 'account_registered'
  | 'account_trip_sync'
  | 'sign_in_started'
  | 'sign_in_failed'
  | 'signed_out'
  // Assistant
  | 'assistant_answer_failed'
  | 'assistant_answer_received'
  | 'assistant_device_unsupported'
  | 'assistant_model_load_failed'
  // Reading what the app worked out
  | 'analytics_viewed'
  | 'calendar_view_changed'
  | 'summary_printed'
  | 'transports_view_opened'
  // Install and reminders
  | 'install_nudge_accepted'
  | 'install_nudge_dismissed'
  | 'install_nudge_shown'
  | 'notification_opened'
  | 'pwa_install_completed'
  | 'reminder_card_dismissed'
  | 'reminder_card_shown'
  | 'reminders_disabled'
  | 'reminders_enable_result'
  | 'run_calendar_exported'
  // Preferences
  | 'language_changed'
  | 'theme_changed'
  // Sharing, joining and syncing
  | 'own_trip_prompt_accepted'
  | 'own_trip_prompt_dismissed'
  | 'own_trip_prompt_shown'
  | 'share_wizard_step'
  | 'trip_identity_claim_failed'
  | 'trip_identity_claimed'
  | 'trip_identity_skipped'
  | 'trip_invite_ready'
  | 'trip_join_failed'
  | 'trip_link_opened'
  | 'trip_share_blocked'
  | 'trip_sync_exported'
  | 'trip_sync_imported'
  | 'trip_sync_offline'
  | 'trip_sync_recovered'
  | 'viewer_sign_in_clicked'
  // Creating a trip
  | 'trip_wizard_started'
  | 'trip_wizard_step';

/** One captured event, as {@link readCapturedEvents} hands it back. */
export interface CapturedEvent {
  readonly event: AnalyticsEvent;
  readonly properties?: Record<string, unknown>;
}

declare global {
  interface Window {
    /**
     * Every event captured since the page loaded, on a dev build only.
     *
     * See {@link recordForInspection} for why it exists and why production
     * never has it.
     */
    __kikouchouAnalytics?: CapturedEvent[];
  }
}

/**
 * How many captures the dev-only log keeps before dropping the oldest.
 *
 * A bound rather than an unbounded array: a dev server left open all afternoon
 * with the assistant running would otherwise grow one forever, and nothing
 * reading this log cares about an event five hundred captures ago.
 */
const INSPECTION_LOG_LIMIT = 500;

/**
 * Writes one capture to `window.__kikouchouAnalytics`, on a dev build only.
 *
 * The end-to-end suite cannot watch the wire: `lib/posthog` refuses to
 * initialize on a loopback hostname and the Playwright servers blank
 * `VITE_POSTHOG_KEY`, both deliberately — see `e2e/analytics-privacy.spec.ts`
 * for the nineteen phantom people that bought those guards. So the suite needs
 * somewhere else to look, and this is it: the events are observable where they
 * are decided, one step before a client that is not there would have sent them.
 *
 * `import.meta.env.DEV` is replaced by a literal at build time, so a production
 * bundle keeps neither this log nor the branch that fills it — the Playwright
 * `production` project, which runs a real build, correctly sees nothing. Guard
 * `window` too: this module is imported by unit tests whose environment has no
 * DOM, and it must never throw at import time.
 */
function recordForInspection(
  event: AnalyticsEvent,
  properties?: Record<string, unknown>,
): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') {
    return;
  }
  const log = (window.__kikouchouAnalytics ??= []);
  log.push(properties === undefined ? { event } : { event, properties });
  if (log.length > INSPECTION_LOG_LIMIT) {
    log.shift();
  }
}

/**
 * Captures one event, and is the only place in the app that does.
 *
 * Every call site goes through here rather than through `posthog?.capture`, for
 * two reasons. The name is checked against {@link AnalyticsEvent}, so a typo is
 * a build error rather than an orphan event nobody notices for a month. And
 * there is exactly one point where a capture can be observed, which is what
 * lets `e2e/analytics-events.spec.ts` assert that a click produces the event it
 * is supposed to produce.
 *
 * Safe with no client, like everything else here: analytics is simply off, and
 * the inspection log still fills, so the end-to-end suite works on a build that
 * sends nothing anywhere.
 */
export function captureEvent(
  event: AnalyticsEvent,
  properties?: Record<string, unknown>,
): void {
  posthogClient?.capture(event, properties);
  recordForInspection(event, properties);
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
 *
 * `trip_viewed` is *in*, deliberately: an invitee opening a shared trip
 * through its link, with no account, is the first value moment this app has
 * for most of the people who ever reach it. Counting only members would say
 * "nobody uses sharing" about a trip six guests read every day.
 */
export type UsageAction =
  | 'activity_saved'
  | 'assistant_prompt_sent'
  | 'expense_saved'
  | 'guest_group_imported'
  | 'guest_group_saved'
  | 'person_saved'
  | 'ride_saved'
  | 'room_saved'
  | 'transport_saved'
  | 'trip_created'
  | 'trip_imported'
  | 'trip_joined'
  | 'trip_updated'
  | 'trip_viewed'
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
  captureEvent(action, properties);
  captureEvent(USAGE_EVENT, { action });
}

// ============================================================================
// Deletion
// ============================================================================

/**
 * The events that mean a record left a trip.
 *
 * Saving was counted from the start and deleting was not, which made every
 * `*_saved` count a gross number: a trip whose rooms were entered three times
 * and pruned twice reads the same as one entered once and kept. These are the
 * matching halves, named after the events they undo.
 *
 * None of them is a {@link UsageAction}, and that is the same call the module
 * already made for `trip_deleted`: cleanup is not what "somebody used the app"
 * is meant to measure, and counting it would let a person tidying up on a
 * Sunday read as engagement.
 *
 * `assignment_deleted` has no `assignment_saved` beside it — putting a guest in
 * a room happens by drag and drop and was never captured. It is here anyway:
 * unpicking a room plan is the one deletion that says the plan was wrong.
 */
export type DeletionEvent =
  | 'activity_deleted'
  | 'assignment_deleted'
  | 'expense_deleted'
  | 'guest_group_deleted'
  | 'person_deleted'
  | 'ride_deleted'
  | 'room_deleted'
  | 'transport_deleted'
  | 'trip_deleted'
  | 'vehicle_deleted';

/**
 * Captures one record being deleted.
 *
 * A thin name over {@link captureEvent} rather than a second mechanism: it
 * exists so the deletion events are one closed list somebody reads in one
 * place, the way {@link UsageAction} is, instead of ten string literals spread
 * over ten features.
 *
 * `trip_deleted` predates this and keeps its exact name, so the insights built
 * on it are unaffected.
 */
export function captureDeletion(
  event: DeletionEvent,
  properties?: Record<string, unknown>,
): void {
  captureEvent(event, properties);
}

// ============================================================================
// Error reporting
// ============================================================================

/**
 * Reports an error that the app already caught.
 *
 * `capture_exceptions` above only sees what reaches the window: an unhandled
 * error, or an unhandled promise rejection. Everything this codebase catches on
 * purpose — a failed write behind a toast, a boundary that renders a fallback,
 * a route that renders the error page — is by construction never unhandled, so
 * none of it reached PostHog. A session replay could show the red toast while
 * error tracking held nothing at all, which is what happened to the room
 * assignment failure this helper was written for.
 *
 * `console_errors` is deliberately still off: it would capture the 118 existing
 * `console.error` sites indiscriminately, including the noisy ones. This is the
 * opt-in counterpart — a call site that reports says so.
 *
 * `context` names where the error came from, because a wrapped error's own
 * message rarely does. Everything passed here must be app-domain detail, never
 * a guest's name or a person's contact: the project treats trip guests as
 * records, not identities.
 *
 * Safe with no client, like every other call here. Never throws: a reporting
 * failure must not replace the error that was being reported.
 */
export function reportError(
  error: unknown,
  context: { readonly source: string } & Record<string, unknown>,
): void {
  try {
    const thrown = error instanceof Error ? error : new Error(String(error));
    posthogClient?.captureException(thrown, context);
  } catch {
    // Reporting is best-effort. The caller is already handling a failure and
    // must not inherit a second one from the reporter.
  }
}

export default posthogClient;
