/**
 * @fileoverview Route configuration for the Transports feature.
 * Provides lazy-loaded route definitions for the transport list and related pages.
 *
 * @module features/transports/routes
 */

import { lazy, Suspense, type ReactElement } from 'react';
import type { RouteObject } from 'react-router-dom';

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
 * Wrapper component with Suspense for lazy-loaded pages.
 *
 * @param props - The component to render with a loading fallback
 * @returns The wrapped component with Suspense boundary
 */
function SuspenseWrapper({
  children,
}: {
  readonly children: ReactElement;
}): ReactElement {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[400px]">
          <LoadingState variant="inline" size="lg" />
        </div>
      }
    >
      {children}
    </Suspense>
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
    path: 'transports',
    element: (
      <SuspenseWrapper>
        <TransportListPage />
      </SuspenseWrapper>
    ),
  },
];

/**
 * Standalone route for use in nested route configurations.
 */
export const TransportListRoute = {
  path: 'transports',
  element: (
    <SuspenseWrapper>
      <TransportListPage />
    </SuspenseWrapper>
  ),
} satisfies RouteObject;
