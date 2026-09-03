/**
 * @fileoverview Route configuration for the Sharing feature.
 * Provides lazy-loaded route definitions for shared trip viewing and the
 * onboarding wizard sub-routes (identity, room, transport, summary).
 *
 * @module features/sharing/routes
 *
 * @example
 * ```tsx
 * // In main router configuration
 * import { sharingRoutes } from '@/features/sharing';
 *
 * const router = createBrowserRouter([
 *   // ... other routes
 *   ...sharingRoutes,
 * ]);
 * ```
 */

import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

import { withSuspense } from '@/components/shared/with-suspense';

// ============================================================================
// Lazy-loaded Components
// ============================================================================

/**
 * Lazy-loaded ShareImportPage component (welcome screen).
 * Uses React.lazy for code splitting and optimal bundle size.
 */
const ShareImportPage = lazy(() =>
  import('./pages/ShareImportPage').then((module) => ({
    default: module.ShareImportPage,
  })),
);

/**
 * Lazy-loaded IdentityStepPage component (story 2.2).
 */
const IdentityStepPage = lazy(() =>
  import('./pages/IdentityStepPage').then((module) => ({
    default: module.IdentityStepPage,
  })),
);

/**
 * Lazy-loaded RoomSelectionStepPage component (story 2.3).
 */
const RoomSelectionStepPage = lazy(() =>
  import('./pages/RoomSelectionStepPage').then((module) => ({
    default: module.RoomSelectionStepPage,
  })),
);

/**
 * Lazy-loaded TransportEntryStepPage component (story 2.4).
 */
const TransportEntryStepPage = lazy(() =>
  import('./pages/TransportEntryStepPage').then((module) => ({
    default: module.TransportEntryStepPage,
  })),
);

/**
 * Lazy-loaded SummaryStepPage component (story 2.5).
 */
const SummaryStepPage = lazy(() =>
  import('./pages/SummaryStepPage').then((module) => ({
    default: module.SummaryStepPage,
  })),
);

/**
 * Lazy-loaded JoinTripPage — where an invite link lands.
 */
const JoinTripPage = lazy(() =>
  import('./pages/JoinTripPage').then((module) => ({
    default: module.JoinTripPage,
  })),
);

/**
 * Lazy-loaded TripSyncPage component for unified export/import via QR codes.
 */
const TripSyncPage = lazy(() =>
  import('./pages/TripSyncPage').then((module) => ({
    default: module.TripSyncPage,
  })),
);

// ============================================================================
// Route Wrapper Components
// ============================================================================

// ============================================================================
// Route Definitions
// ============================================================================

/**
 * Route configuration for the Sharing feature.
 *
 * Routes:
 * - `/share/:shareId`           — Welcome screen (story 2.1), the index child
 * - `/share/:shareId/identity`  — Step 2: identity selection (story 2.2)
 * - `/share/:shareId/room`      — Step 3: room selection (story 2.3)
 * - `/share/:shareId/transport` — Step 4: transport entry (story 2.4)
 * - `/share/:shareId/summary`   — Step 5: summary & trip entry (story 2.5)
 *
 * Note: This route is designed to be used at the root level of the router,
 * not nested under an authenticated layout, as it's a public sharing link.
 *
 * @example
 * ```tsx
 * // In main router configuration
 * import { sharingRoutes } from '@/features/sharing';
 *
 * const routes = [
 *   // ... authenticated routes
 *   ...sharingRoutes, // Public sharing routes
 * ];
 * ```
 */
export const sharingRoutes: RouteObject[] = [
  {
    path: 'share/:shareId',
    // Deliberately no `element`: React Router renders the matched child in a
    // parent that supplies none. `ShareImportPage` used to sit here and
    // rendered no `<Outlet />`, so every wizard step resolved its URL and then
    // drew the welcome screen instead — four screens that could not appear at
    // all. It is the `index` child now, which also keeps its returning-guest
    // redirect off the step URLs: as the parent it would send anyone reloading
    // `/share/:shareId/room` to the trip calendar, the identity step having by
    // then written the localStorage entry that redirect looks for.
    children: [
      {
        index: true,
        element: withSuspense(ShareImportPage),
      },
      {
        path: 'identity',
        element: withSuspense(IdentityStepPage),
      },
      {
        path: 'room',
        element: withSuspense(RoomSelectionStepPage),
      },
      {
        path: 'transport',
        element: withSuspense(TransportEntryStepPage),
      },
      {
        path: 'summary',
        element: withSuspense(SummaryStepPage),
      },
    ],
  },
];

/**
 * Route for an invite link: `/join/:token`.
 *
 * Deliberately top-level and outside the app chrome — someone arriving from a
 * message has no trip selected and no navigation to use yet.
 *
 * This is a deep link by nature, which is why `dist/404.html` exists: GitHub
 * Pages has no SPA rewrite, so without that copy a cold load here would 404
 * before the service worker is installed. See `githubPagesSpaFallback` in
 * vite.config.ts.
 */
export const joinRoutes: RouteObject[] = [
  {
    path: 'join/:token',
    element: withSuspense(JoinTripPage),
  },
];

/**
 * Routes for the P2P sync feature (QR code export/import).
 * These should be nested under `/trips/:tripId` in the main app routes.
 *
 * Routes:
 * - `/trips/:tripId/sync` — Unified sync page (export + import QR codes)
 */
export const sharingSyncRoutes: RouteObject[] = [
  {
    path: 'sync',
    element: withSuspense(TripSyncPage),
  },
];

// ============================================================================
// Type Exports
// ============================================================================

/**
 * Parameters for the share import route.
 * Use with `useParams<ShareImportParams>()` for type-safe parameter access.
 *
 * @example
 * ```tsx
 * import type { ShareImportParams } from '@/features/sharing/routes';
 *
 * function ShareImportPage() {
 *   const { shareId } = useParams<ShareImportParams>();
 *   // shareId is typed as string | undefined
 * }
 * ```
 */
export type { ShareImportParams } from './pages/ShareImportPage';
