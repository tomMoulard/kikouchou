/**
 * @fileoverview Route configuration for the meal planner.
 *
 * @module features/meals/routes
 */

import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

import { withSuspense } from '@/components/shared/with-suspense';

// ============================================================================
// Lazy-Loaded Page Components
// ============================================================================

const MealPlannerPage = lazy(() =>
  import('./pages/MealPlannerPage').then((module) => ({
    default: module.MealPlannerPage,
  })),
);

// ============================================================================
// Route Configuration
// ============================================================================

/**
 * Meal route:
 * - `/trips/:tripId/meals`: the lunches and dinners, and the shopping list
 */
export const mealRoutes: RouteObject[] = [
  {
    path: 'trips/:tripId/meals',
    element: withSuspense(MealPlannerPage),
  },
];

// ============================================================================
// Type Exports
// ============================================================================

/**
 * Parameters for the meal route.
 * Use with `useParams<MealParams>()` for type-safe parameter access.
 */
export type MealParams = {
  /** The trip ID from the URL */
  readonly tripId: string;
};
