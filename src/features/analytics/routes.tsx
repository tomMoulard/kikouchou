/**
 * @fileoverview Route configuration for trip and global analytics pages.
 *
 * @module features/analytics/routes
 */

import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

import { withSuspense } from '@/components/shared/with-suspense';

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
