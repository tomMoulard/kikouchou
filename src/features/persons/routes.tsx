/**
 * @fileoverview Route configuration for the persons feature.
 * Defines lazy-loaded routes for person management pages.
 *
 * @module features/persons/routes
 *
 * @example
 * ```tsx
 * // In main router configuration
 * import { personRoutes } from '@/features/persons';
 *
 * const router = createBrowserRouter([
 *   {
 *     path: '/',
 *     element: <Layout />,
 *     children: [
 *       ...personRoutes,
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
 * Lazy-loaded PersonListPage component for code splitting.
 * Transforms named export to default export for React.lazy compatibility.
 */
const PersonListPage = lazy(() =>
  import('./pages/PersonListPage').then((module) => ({
    default: module.PersonListPage,
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
 * Route configuration for the persons feature.
 * These routes are designed to be spread into a parent route's children array.
 *
 * Routes:
 * - `/trips/:tripId/persons` - Person list page for a trip
 *
 * Note: Person create/edit are handled via PersonDialog rather than separate pages.
 *
 * @example
 * ```tsx
 * // In main router configuration
 * const router = createBrowserRouter([
 *   {
 *     path: '/',
 *     element: <Layout />,
 *     children: [...personRoutes],
 *   },
 * ]);
 * ```
 */
export const personRoutes: RouteObject[] = [
  {
    path: 'trips/:tripId/persons',
    element: withSuspense(PersonListPage),
  },
];

// ============================================================================
// Type Exports
// ============================================================================

/**
 * Parameters for the person list route.
 * Use with `useParams<PersonListParams>()` for type-safe parameter access.
 *
 * @example
 * ```tsx
 * import type { PersonListParams } from '@/features/persons/routes';
 *
 * function PersonListPage() {
 *   const { tripId } = useParams<PersonListParams>();
 *   // tripId is typed as string | undefined
 * }
 * ```
 */
export type PersonListParams = {
  /** The trip ID from the URL */
  tripId: string;
};
