/**
 * @fileoverview Whether this document is served from somebody's own machine.
 *
 * Lifted out of `lib/posthog` when a second analytics client arrived. The rule
 * is the same for every one of them and the cost of two copies drifting is the
 * accident this project already had: 19 anonymous people in the real PostHog
 * project, every one of them minted by a browser pointed at a dev server. A
 * tracker added later gets the guard by importing it rather than by remembering
 * the list of hostnames.
 *
 * Reads `window` defensively: the callers are evaluated at import time by
 * `main.tsx` and, transitively, by every component test, so nothing here may
 * throw.
 *
 * @module lib/analytics/development-host
 */

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

// ============================================================================
// Exports
// ============================================================================

/**
 * Whether this document is being served from a developer's own machine.
 */
export function isDevelopmentHost(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const { hostname } = window.location;
  return (
    DEVELOPMENT_HOSTNAMES.includes(hostname) ||
    DEVELOPMENT_HOSTNAME_PATTERNS.some((pattern) => pattern.test(hostname))
  );
}
