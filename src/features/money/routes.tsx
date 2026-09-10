/**
 * @fileoverview Route configuration for the trip's money page.
 *
 * @module features/money/routes
 */

import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

import { withSuspense } from '@/components/shared/with-suspense';

// ============================================================================
// Lazy-Loaded Page Components
// ============================================================================

const TripMoneyPage = lazy(() =>
  import('./pages/TripMoneyPage').then((module) => ({
    default: module.TripMoneyPage,
  })),
);

// ============================================================================
// Route Configuration
// ============================================================================

/**
 * Money route:
 * - `/trips/:tripId/money` — who owes what, starting with the nights
 */
export const moneyRoutes: RouteObject[] = [
  {
    path: 'trips/:tripId/money',
    element: withSuspense(TripMoneyPage),
  },
];

// ============================================================================
// Type Exports
// ============================================================================

/**
 * Parameters for the money route.
 * Use with `useParams<MoneyParams>()` for type-safe parameter access.
 */
export type MoneyParams = {
  /** The trip ID from the URL */
  readonly tripId: string;
};
