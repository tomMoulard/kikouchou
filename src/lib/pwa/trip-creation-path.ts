/**
 * @fileoverview Whether a URL is the trip creation form.
 *
 * The install banner (`components/pwa/InstallPrompt`) is mounted in `App`,
 * outside the router, so it cannot call `useLocation`. `App` reads the
 * router's own location instead, which still carries the deployment base path
 * (`import.meta.env.BASE_URL`), so this strips it before matching.
 *
 * @module lib/pwa/trip-creation-path
 */

import { matchPath } from 'react-router-dom';

// ============================================================================
// Constants
// ============================================================================

/**
 * The route of the trip creation form, the wizard included
 * (`features/trips/routes`).
 */
const TRIP_CREATION_ROUTE = '/trips/new';

// ============================================================================
// Exports
// ============================================================================

/**
 * Tells whether `pathname` is the trip creation form.
 *
 * @param pathname - The full path, base path included
 * @param basename - The router's base path, with or without a trailing slash
 * @returns True on the trip creation form
 */
export function isTripCreationPath(pathname: string, basename: string): boolean {
  const base = basename.replace(/\/+$/, '');
  if (base && pathname !== base && !pathname.startsWith(`${base}/`)) {
    return false;
  }
  const routePath = pathname.slice(base.length) || '/';
  return matchPath({ path: TRIP_CREATION_ROUTE, end: true }, routePath) !== null;
}
