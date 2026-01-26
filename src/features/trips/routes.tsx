/**
 * @fileoverview Route configuration for the trips feature.
 * Defines lazy-loaded routes for trip management pages.
 *
 * @module features/trips/routes
 *
 * @example
 * ```tsx
 * // In main router configuration
 * import { tripRoutes } from '@/features/trips';
 *
 * const router = createBrowserRouter([
 *   {
 *     path: '/',
 *     element: <Layout />,
 *     children: [
 *       ...tripRoutes,
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
 * Lazy-loaded TripListPage component for code splitting.
 * Transforms named export to default export for React.lazy compatibility.
 */
const TripListPage = lazy(() =>
  import('./pages/TripListPage').then((module) => ({
    default: module.TripListPage,
  })),
);

/**
 * Lazy-loaded TripCreatePage component for code splitting.
 * Transforms named export to default export for React.lazy compatibility.
 */
const TripCreatePage = lazy(() =>
  import('./pages/TripCreatePage').then((module) => ({
    default: module.TripCreatePage,
  })),
);

/**
 * Lazy-loaded TripEditPage component for code splitting.
 * Transforms named export to default export for React.lazy compatibility.
 */
const TripEditPage = lazy(() =>
  import('./pages/TripEditPage').then((module) => ({
    default: module.TripEditPage,
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
 * Route configuration for the trips feature.
 * These routes are designed to be spread into a parent route's children array.
 *
 * Routes:
 * - `/trips` - Trip list page (view all trips)
 * - `/trips/new` - Trip creation page
 * - `/trips/:tripId/edit` - Trip edit page
 *
 * @example
 * ```tsx
 * // In main router configuration
 * const router = createBrowserRouter([
 *   {
 *     path: '/',
 *     element: <Layout />,
 *     children: [...tripRoutes],
 *   },
 * ]);
 * ```
 */
export const tripRoutes: RouteObject[] = [
  {
    path: 'trips',
    element: withSuspense(TripListPage),
  },
  {
    path: 'trips/new',
    element: withSuspense(TripCreatePage),
  },
  {
    path: 'trips/:tripId/edit',
    element: withSuspense(TripEditPage),
  },
];

// ============================================================================
// Type Exports
// ============================================================================

/**
 * Parameters for the trip edit route.
 * Use with `useParams<TripEditParams>()` for type-safe parameter access.
 *
 * @example
 * ```tsx
 * import type { TripEditParams } from '@/features/trips/routes';
 *
 * function TripEditPage() {
 *   const { tripId } = useParams<TripEditParams>();
 *   // tripId is typed as string | undefined
 * }
 * ```
 */
export type TripEditParams = {
  /** The trip ID from the URL */
  tripId: string;
};
