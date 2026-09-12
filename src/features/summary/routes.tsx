/**
 * @fileoverview Route configuration for the printable trip summary.
 *
 * @module features/summary/routes
 */

import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

import { withSuspense } from '@/components/shared/with-suspense';

// ============================================================================
// Lazy-Loaded Page Components
// ============================================================================

const TripSummaryPage = lazy(() =>
  import('./pages/TripSummaryPage').then((module) => ({
    default: module.TripSummaryPage,
  })),
);

// ============================================================================
// Route Configuration
// ============================================================================

/**
 * Summary route:
 * - `/trips/:tripId/summary` — the one-page printable summary of the trip
 */
export const summaryRoutes: RouteObject[] = [
  {
    path: 'trips/:tripId/summary',
    element: withSuspense(TripSummaryPage),
  },
];

// ============================================================================
// Type Exports
// ============================================================================

/**
 * Parameters for the summary route.
 * Use with `useParams<SummaryParams>()` for type-safe parameter access.
 */
export type SummaryParams = {
  /** The trip ID from the URL */
  readonly tripId: string;
};
