/**
 * @fileoverview Route configuration for the Transports feature.
 * Provides lazy-loaded route definitions for the transport list and related pages.
 *
 * @module features/transports/routes
 */

import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

import { withSuspense } from '@/components/shared/with-suspense';

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

/**
 * Lazy-loaded TransportMapPage component.
 * Uses React.lazy for code splitting and optimal bundle size.
 */
const TransportMapPage = lazy(() =>
  import('./pages/TransportMapPage').then((module) => ({
    default: module.TransportMapPage,
  })),
);

// ============================================================================
// Route Definitions
// ============================================================================

/**
 * Route configuration for the Transports feature.
 *
 * Routes:
 * - `/trips/:tripId/transports` - Transport list page with tabs for arrivals/departures
 * - `/trips/:tripId/transports/map` - Transport map view showing all locations
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
  {
    path: 'trips/:tripId/transports/map',
    element: withSuspense(TransportMapPage),
  },
];
