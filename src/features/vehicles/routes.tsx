/**
 * @fileoverview Route configuration for the vehicles feature.
 *
 * One route, trip-scoped: a car is entered for a trip and picked per ride, so
 * unlike a guest group it does not outlive the trip it belongs to.
 *
 * @module features/vehicles/routes
 */

import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

import { withSuspense } from '@/components/shared/with-suspense';

// ============================================================================
// Lazy-Loaded Page Components
// ============================================================================

const VehicleListPage = lazy(() =>
  import('./pages/VehicleListPage').then((module) => ({
    default: module.VehicleListPage,
  })),
);

// ============================================================================
// Route Configuration
// ============================================================================

/**
 * Route params for the vehicle list page.
 */
export interface VehicleListParams {
  /** The trip whose cars are being listed */
  readonly tripId: string;
}

/**
 * Routes for the vehicles feature, spread into the app's children.
 *
 * Routes:
 * - `/trips/:tripId/vehicles` - The trip's cars
 *
 * Create and edit go through `VehicleDialog` rather than their own pages, as
 * guests, rooms and transports do.
 */
export const vehicleRoutes: RouteObject[] = [
  {
    path: 'trips/:tripId/vehicles',
    element: withSuspense(VehicleListPage),
  },
];
