/**
 * @fileoverview Route configuration for the Transports feature.
 * Provides lazy-loaded route definitions for the transport list and related pages.
 *
 * @module features/transports/routes
 */

import { type ReactElement, Suspense, lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { LoadingState } from '@/components/shared/LoadingState';

// ============================================================================
// Lazy-loaded Components
// ============================================================================

/**
 * Lazy-loaded TransportListPage component.
 * Uses React.lazy for code splitting and optimal bundle size.
 */
const TransportListPage = lazy(() =>
  import('./pages/TransportListPage').then((module) => ({
    default: module.TransportListPage,
  })),
);

// ============================================================================
// Route Wrapper Components
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
// Route Definitions
// ============================================================================

/**
 * Route configuration for the Transports feature.
 *
 * Routes:
 * - `/trips/:tripId/transports` - Transport list page with tabs for arrivals/departures
 *
 * @example
 * ```tsx
 * // In main router configuration
 * import { transportRoutes } from '@/features/transports';
 *
 * const routes = [
 *   // ... other routes
 *   ...transportRoutes,
 * ];
 * ```
 */
export const transportRoutes: RouteObject[] = [
  {
    path: 'trips/:tripId/transports',
    element: withSuspense(TransportListPage),
  },
];

/**
 * Standalone route for use in nested route configurations.
 */
export const TransportListRoute = {
  path: 'trips/:tripId/transports',
  element: withSuspense(TransportListPage),
} satisfies RouteObject;
