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

import { type ReactElement, Suspense, lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { LoadingState } from '@/components/shared/LoadingState';

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
 * Replaces the OnboardingPlaceholderPage for the identity route.
 */
const IdentityStepPage = lazy(() =>
  import('./pages/IdentityStepPage').then((module) => ({
    default: module.IdentityStepPage,
  })),
);

/**
 * Lazy-loaded RoomSelectionStepPage component (story 2.3).
 * Replaces the OnboardingPlaceholderPage for the room route.
 */
const RoomSelectionStepPage = lazy(() =>
  import('./pages/RoomSelectionStepPage').then((module) => ({
    default: module.RoomSelectionStepPage,
  })),
);

/**
 * Lazy-loaded TransportEntryStepPage component (story 2.4).
 * Replaces the OnboardingPlaceholderPage for the transport route.
 */
const TransportEntryStepPage = lazy(() =>
  import('./pages/TransportEntryStepPage').then((module) => ({
    default: module.TransportEntryStepPage,
  })),
);

/**
 * Lazy-loaded SummaryStepPage component (story 2.5).
 * Replaces the OnboardingPlaceholderPage for the summary route.
 */
const SummaryStepPage = lazy(() =>
  import('./pages/SummaryStepPage').then((module) => ({
    default: module.SummaryStepPage,
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

/**
 * Wraps a lazy-loaded component in Suspense with a loading fallback and error boundary.
 * Handles both loading states and chunk loading failures gracefully.
 *
 * @param Component - The lazy-loaded component to wrap
 * @returns A React element with error boundary and Suspense boundary
 */
function withSuspense(Component: React.LazyExoticComponent<React.ComponentType>): ReactElement {
  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingState variant="fullPage" />}>
        <Component />
      </Suspense>
    </ErrorBoundary>
  );
}

// ============================================================================
// Route Definitions
// ============================================================================

/**
 * Route configuration for the Sharing feature.
 *
 * Routes:
 * - `/share/:shareId`           — Welcome screen (story 2.1)
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
    element: withSuspense(ShareImportPage),
    children: [
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
 * Standalone route for use in nested route configurations.
 */
export const ShareImportRoute = {
  path: 'share/:shareId',
  element: withSuspense(ShareImportPage),
} satisfies RouteObject;

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
