/**
 * @fileoverview Route configuration for the calendar feature.
 * Defines lazy-loaded routes for calendar pages.
 *
 * @module features/calendar/routes
 *
 * @example
 * ```tsx
 * // In main router configuration
 * import { calendarRoutes } from '@/features/calendar';
 *
 * const router = createBrowserRouter([
 *   {
 *     path: '/',
 *     element: <Layout />,
 *     children: [
 *       { path: 'trips/:tripId', children: [...calendarRoutes] },
 *       // other routes...
 *     ],
 *   },
 * ]);
 * ```
 */

import { type ReactElement, lazy } from 'react';
import { Navigate, type RouteObject, useLocation } from 'react-router-dom';

import { withSuspense } from '@/components/shared/with-suspense';

// ============================================================================
// Lazy-Loaded Page Components
// ============================================================================

/**
 * Lazy-loaded CalendarPage component for code splitting.
 * Transforms named export to default export for React.lazy compatibility.
 */
const CalendarPage = lazy(() =>
  import('./pages/CalendarPage').then((module) => ({
    default: module.CalendarPage,
  })),
);

// ============================================================================
// Index Redirect
// ============================================================================

/**
 * Sends the bare `/trips/:tripId` on to `/trips/:tripId/calendar`.
 *
 * The bare path used to render its *own* copy of the calendar next to the
 * `calendar` one. `withSuspense` builds a fresh element per call, so the two
 * were referentially distinct routes: moving between them remounted the page
 * and reset `currentMonth`, the selected event and the open dialog. Worse,
 * `?view=` lives in the URL, so the chosen view was scoped to whichever of the
 * two paths you happened to be on and silently fell back to `timeline` on the
 * other.
 *
 * Redirecting instead of rendering leaves exactly one URL the calendar lives
 * at, which is what makes those two bugs unrepresentable rather than fixed.
 *
 * The query string and hash are carried across on purpose: a bookmark of
 * `/trips/:tripId?view=card` is precisely the case this route exists for, and
 * dropping the search would land it on the timeline — the same silent fallback,
 * just moved. `replace` keeps the bare path out of the history stack so Back
 * does not bounce off it.
 *
 * Nothing in the app links the bare path (`Layout` and every `navigate()` call
 * site append `/calendar`), so this is reached only from a bookmark, a typed
 * URL or an external link.
 */
function CalendarIndexRedirect(): ReactElement {
  const { search, hash } = useLocation();

  return <Navigate to={{ pathname: 'calendar', search, hash }} replace />;
}

// ============================================================================
// Route Configuration
// ============================================================================

/**
 * Route configuration for the calendar feature.
 *
 * These are **children of a `trips/:tripId` parent**, not top-level routes —
 * see `appRoutes` in `src/router.tsx`, where the same parent also carries
 * `sharingSyncRoutes`. That parent is the single owner of `trips/:tripId`;
 * registering a second route object for the same path is what this file used
 * to do, and is what the tests in `__tests__/routes.test.tsx` guard against.
 *
 * Routes (relative to `trips/:tripId`):
 * - index — redirects to `calendar`, preserving `?view=`
 * - `calendar` — the trip calendar
 *
 * @example
 * ```tsx
 * // In main router configuration
 * const router = createBrowserRouter([
 *   {
 *     path: '/',
 *     element: <Layout />,
 *     children: [{ path: 'trips/:tripId', children: [...calendarRoutes] }],
 *   },
 * ]);
 * ```
 */
export const calendarRoutes: RouteObject[] = [
  {
    index: true,
    element: <CalendarIndexRedirect />,
  },
  {
    path: 'calendar',
    element: withSuspense(CalendarPage),
  },
];

// ============================================================================
// Type Exports
// ============================================================================

/**
 * Parameters for the calendar route.
 * Use with `useParams<CalendarParams>()` for type-safe parameter access.
 *
 * @example
 * ```tsx
 * import type { CalendarParams } from '@/features/calendar/routes';
 *
 * function CalendarPage() {
 *   const { tripId } = useParams<CalendarParams>();
 *   // tripId is typed as string | undefined
 * }
 * ```
 */
export type CalendarParams = {
  /** The trip ID from the URL */
  tripId: string;
};
