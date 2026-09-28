/**
 * @fileoverview The PostHog ids a visitor brings from the landing page.
 *
 * kikouchou.app and this app write into one PostHog project, but the landing
 * page runs posthog-js with `persistence: 'memory'` so that it stores nothing
 * in the browser. It therefore has no cookie this app could read, and without
 * help a visitor who reads the landing page and clicks through is two people:
 * an anonymous one there, and a second one here that a later `identify()` turns
 * into the account. The landing visit that explains the sign-up ends up on
 * neither.
 *
 * So the landing page writes its distinct id and session id onto every link
 * into the app (`handOff` in its `assets/analytics.js`), and `lib/posthog`
 * passes them to `posthog.init()` as `bootstrap`. The first event here then
 * carries the landing page's distinct id and continues its session, so the
 * landing pageviews, its recording and everything after land on one person.
 *
 * Three rules keep that from doing harm:
 *
 *   1. The parameters leave the address bar before `posthog.init()` runs, used
 *      or not. Otherwise they would be in `$current_url` and, for good, in the
 *      person's `$initial_current_url`.
 *   2. A browser that already has a PostHog identity keeps it. posthog-js
 *      overwrites a stored anonymous id with a bootstrapped one, which would cut
 *      a returning visitor off from their own history here.
 *   3. A link older than {@link MAX_HANDOFF_AGE_MS} is ignored. A link copied
 *      from the landing page and sent to a friend would otherwise make the
 *      friend the same person as the sender.
 *
 * Reads `window` defensively and never throws, like the rest of the analytics
 * code: it runs at import time, from `main.tsx` and from every component test.
 *
 * @module lib/analytics/landing-handoff
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * The query parameters the landing page writes.
 *
 * The other half of this contract is `HANDOFF_PARAMS` in the landing page's
 * `assets/analytics.js`. A name changed on one side must change on the other.
 */
export const HANDOFF_PARAMS = {
  distinctId: 'ph_distinct_id',
  sessionId: 'ph_session_id',
  issuedAt: 'ph_handoff_at',
} as const;

/**
 * How old a link can be and still carry an identity.
 *
 * The landing page stamps the link when the pointer goes down on it or when it
 * takes focus, so a real click-through arrives within seconds. Ten minutes
 * covers a slow network and a tab that loads in the background, and it is short
 * enough that a link pasted into a chat has gone stale before most people open
 * it.
 */
export const MAX_HANDOFF_AGE_MS = 10 * 60 * 1000;

/**
 * How far in the future a stamp may be, for a clock that disagrees slightly.
 */
const MAX_CLOCK_SKEW_MS = 60 * 1000;

/**
 * The shape of every id posthog-js mints: a UUID, v7 in current versions.
 *
 * Anything else did not come from the landing page, and a distinct id is not a
 * field to accept free text into: it names the person every event lands on.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================================
// Types
// ============================================================================

/**
 * What `posthog.init()` takes as `bootstrap` for an anonymous visitor.
 */
export interface LandingBootstrap {
  distinctID: string;
  sessionID: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Removes the hand-off parameters from the address bar, keeping everything
 * else (`?install=1`, the path, the hash) as it was.
 */
function stripHandoffParams(url: URL): void {
  for (const name of Object.values(HANDOFF_PARAMS)) {
    url.searchParams.delete(name);
  }
  window.history.replaceState(window.history.state, '', url.toString());
}

/**
 * Whether posthog-js already persisted an identity in this browser.
 *
 * posthog-js keeps its state under `ph_<token>_posthog`, in a cookie and in
 * localStorage with the default `'localStorage+cookie'` persistence. Either one
 * is enough to say this browser was here before.
 */
function hasStoredIdentity(token: string): boolean {
  const name = `ph_${token}_posthog`;
  try {
    if (localStorage.getItem(name) !== null) {
      return true;
    }
  } catch {
    // Storage blocked. The cookie below still answers.
  }
  try {
    return document.cookie.split(';').some((part) => part.trim().startsWith(`${name}=`));
  } catch {
    return false;
  }
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Reads the landing page's ids from the address bar and removes them.
 *
 * Returns the `bootstrap` for `posthog.init()`, or `undefined` when there is
 * nothing to continue: no parameters, malformed ones, a stale link, or a
 * browser that already has an identity of its own.
 *
 * Call it once, before `posthog.init()`, and only when PostHog will actually
 * initialize. It changes the address bar.
 */
export function takeLandingBootstrap(
  token: string,
  now: number = Date.now(),
): LandingBootstrap | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(window.location.href);
  } catch {
    return undefined;
  }
  const params = url.searchParams;
  if (!Object.values(HANDOFF_PARAMS).some((name) => params.has(name))) {
    return undefined;
  }

  const distinctID = params.get(HANDOFF_PARAMS.distinctId) ?? '';
  const sessionID = params.get(HANDOFF_PARAMS.sessionId) ?? '';
  const issuedAt = Number(params.get(HANDOFF_PARAMS.issuedAt));
  try {
    stripHandoffParams(url);
  } catch {
    // A history API that refuses is not a reason to lose analytics.
  }

  if (!UUID.test(distinctID) || !UUID.test(sessionID)) {
    return undefined;
  }
  const age = now - issuedAt;
  if (!Number.isFinite(age) || age > MAX_HANDOFF_AGE_MS || age < -MAX_CLOCK_SKEW_MS) {
    return undefined;
  }
  if (hasStoredIdentity(token)) {
    return undefined;
  }
  return { distinctID, sessionID };
}
