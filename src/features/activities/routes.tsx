/**
 * @fileoverview Route configuration for the Activities feature.
 *
 * @module features/activities/routes
 */

import { type ReactElement, Suspense, lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { LoadingState } from '@/components/shared/LoadingState';

// ============================================================================
// Lazy-loaded Components
// ============================================================================

/**
 * Lazy-loaded ActivityListPage component for code splitting.
 */
const ActivityListPage = lazy(() =>
  import('./pages/ActivityListPage').then((module) => ({
    default: module.ActivityListPage,
  })),
);

// ============================================================================
// Route Wrapper Components
// ============================================================================

/**
 * Wraps a lazy-loaded component in Suspense with a loading fallback and error boundary.
 *
 * @param Component - The lazy-loaded component to wrap
 * @returns A React element with error boundary and Suspense boundary
 */
function withSuspense(
  Component: React.LazyExoticComponent<React.ComponentType>,
): ReactElement {
  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingState variant="fullPage" />}>
        <Component />
      </Suspense>
    </ErrorBoundary>
  );
}

// ============================================================================
// Route Definitions
// ============================================================================

/**
 * Route params for the activity list page.
 */
export interface ActivityListParams {
  /** The trip the agenda belongs to */
  readonly tripId: string;
}

/**
 * Route configuration for the Activities feature.
 *
 * Routes:
 * - `/trips/:tripId/activities` - Trip agenda (timeline + list views)
 *
 * @example
 * ```tsx
 * import { activityRoutes } from '@/features/activities';
 *
 * const routes = [
 *   // ... other routes
 *   ...activityRoutes,
 * ];
 * ```
 */
export const activityRoutes: RouteObject[] = [
  {
    path: 'trips/:tripId/activities',
    element: withSuspense(ActivityListPage),
  },
];
