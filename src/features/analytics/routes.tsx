/**
 * @fileoverview Route configuration for trip and global analytics pages.
 *
 * @module features/analytics/routes
 */

import { type ReactElement, Suspense, lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { LoadingState } from '@/components/shared/LoadingState';

// ============================================================================
// Lazy-Loaded Page Components
// ============================================================================

const TripAnalyticsPage = lazy(() =>
  import('./pages/TripAnalyticsPage').then((module) => ({
    default: module.TripAnalyticsPage,
  })),
);

const AllTripsAnalyticsPage = lazy(() =>
  import('./pages/AllTripsAnalyticsPage').then((module) => ({
    default: module.AllTripsAnalyticsPage,
  })),
);

// ============================================================================
// Suspense Wrapper
// ============================================================================

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
// Route Configuration
// ============================================================================

/**
 * Analytics routes:
 * - `/trips/:tripId/analytics` — metrics for the selected trip
 * - `/analytics` — aggregated metrics across all trips (this device)
 */
export const analyticsRoutes: RouteObject[] = [
  {
    path: 'trips/:tripId/analytics',
    element: withSuspense(TripAnalyticsPage),
  },
  {
    path: 'analytics',
    element: withSuspense(AllTripsAnalyticsPage),
  },
];

// ============================================================================
// Type Exports
// ============================================================================

export type AnalyticsParams = {
  readonly tripId: string;
};
