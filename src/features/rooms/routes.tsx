/**
 * @fileoverview Route configuration for the rooms feature.
 * Defines lazy-loaded routes for room management pages.
 *
 * @module features/rooms/routes
 *
 * @example
 * ```tsx
 * // In main router configuration
 * import { roomRoutes } from '@/features/rooms';
 *
 * const router = createBrowserRouter([
 *   {
 *     path: '/',
 *     element: <Layout />,
 *     children: [
 *       ...roomRoutes,
 *       // other routes...
 *     ],
 *   },
 * ]);
 * ```
 */

import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

import { withSuspense } from '@/components/shared/with-suspense';

// ============================================================================
// Lazy-Loaded Page Components
// ============================================================================

/**
 * Lazy-loaded RoomListPage component for code splitting.
 * Transforms named export to default export for React.lazy compatibility.
 */
const RoomListPage = lazy(() =>
  import('./pages/RoomListPage').then((module) => ({
    default: module.RoomListPage,
  })),
);

// ============================================================================
// Route Configuration
// ============================================================================

/**
 * Route configuration for the rooms feature.
 * These routes are designed to be spread into a parent route's children array.
 *
 * Routes:
 * - `/trips/:tripId/rooms` - Room list page for a trip
 *
 * Note: Room create/edit are handled via RoomDialog rather than separate pages.
 *
 * @example
 * ```tsx
 * // In main router configuration
 * const router = createBrowserRouter([
 *   {
 *     path: '/',
 *     element: <Layout />,
 *     children: [...roomRoutes],
 *   },
 * ]);
 * ```
 */
export const roomRoutes: RouteObject[] = [
  {
    path: 'trips/:tripId/rooms',
    element: withSuspense(RoomListPage),
  },
];

// ============================================================================
// Type Exports
// ============================================================================

/**
 * Parameters for the room list route.
 * Use with `useParams<RoomListParams>()` for type-safe parameter access.
 *
 * @example
 * ```tsx
 * import type { RoomListParams } from '@/features/rooms/routes';
 *
 * function RoomListPage() {
 *   const { tripId } = useParams<RoomListParams>();
 *   // tripId is typed as string | undefined
 * }
 * ```
 */
export type RoomListParams = {
  /** The trip ID from the URL */
  tripId: string;
};
