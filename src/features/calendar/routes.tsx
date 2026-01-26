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

import { lazy, Suspense, type ReactElement } from 'react';
import type { RouteObject } from 'react-router-dom';

import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { LoadingState } from '@/components/shared/LoadingState';

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
// Suspense Wrapper
// ============================================================================

/**
 * Wraps a lazy-loaded component in Suspense with a loading fallback and error boundary.
 * Handles both loading states and chunk loading failures gracefully.
 *
 * @param Component - The lazy-loaded component to wrap
 * @returns A React element with error boundary and Suspense boundary
 */
function withSuspense(Component: React.LazyExoticComponent<React.ComponentType>): ReactElement {
  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingState variant="fullPage" />}>
        <Component />
      </Suspense>
    </ErrorBoundary>
  );
}

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
