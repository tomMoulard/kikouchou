/**
 * @fileoverview Route configuration for the guest groups feature.
 *
 * One route, and deliberately not under `trips/:tripId`: a group belongs to the
 * account rather than to a trip, and is reachable with none selected.
 *
 * @module features/guest-groups/routes
 */

import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

import { withSuspense } from '@/components/shared/with-suspense';

// ============================================================================
// Lazy-Loaded Page Components
// ============================================================================

const GuestGroupListPage = lazy(() =>
  import('./pages/GuestGroupListPage').then((module) => ({
    default: module.GuestGroupListPage,
  })),
);

// ============================================================================
// Route Configuration
// ============================================================================

/**
 * Routes for the guest groups feature, spread into the app's children.
 *
 * Routes:
 * - `/groups` - Guest group list
 *
 * Create and edit go through `GuestGroupDialog` rather than their own pages,
 * as guests and rooms do.
 */
export const guestGroupRoutes: RouteObject[] = [
  {
    path: 'groups',
    element: withSuspense(GuestGroupListPage),
  },
];
