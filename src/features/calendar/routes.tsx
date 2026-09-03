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
 *       ...calendarRoutes,
 *       // other routes...
 *     ],
 *   },
 * ]);
 * ```
 */

import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

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
// Route Configuration
// ============================================================================

/**
 * Route configuration for the calendar feature.
 * These routes are designed to be spread into a parent route's children array.
 *
 * Routes:
 * - `/trips/:tripId/calendar` - Calendar page for a trip (default view)
 *
 * @example
 * ```tsx
 * // In main router configuration
 * const router = createBrowserRouter([
 *   {
 *     path: '/',
 *     element: <Layout />,
 *     children: [...calendarRoutes],
 *   },
 * ]);
 * ```
 */
export const calendarRoutes: RouteObject[] = [
  {
    path: 'trips/:tripId/calendar',
    element: withSuspense(CalendarPage),
  },
  // Also register as the default view when navigating to a trip
  {
    path: 'trips/:tripId',
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
