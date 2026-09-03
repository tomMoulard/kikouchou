/**
 * @fileoverview Route configuration for the Activities feature.
 *
 * @module features/activities/routes
 */

import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

import { withSuspense } from '@/components/shared/with-suspense';

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
