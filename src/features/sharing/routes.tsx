/**
 * @fileoverview Route configuration for the Sharing feature.
 * Provides lazy-loaded route definitions for shared trip viewing and the
 * onboarding wizard sub-routes (identity + room steps implemented; stubs for 2.4–2.5).
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
 * Lazy-loaded OnboardingPlaceholderPage component.
 * Stub for wizard steps until stories 2.3–2.5 are implemented.
 */
const OnboardingPlaceholderPage = lazy(() =>
  import('./pages/OnboardingPlaceholderPage').then((module) => ({
    default: module.OnboardingPlaceholderPage,
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
 * - `/share/:shareId/transport` — Step 4: transport entry (story 2.4, stubbed)
 * - `/share/:shareId/summary`   — Step 5: summary (story 2.5, stubbed)
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
        element: withSuspense(OnboardingPlaceholderPage),
      },
      {
        path: 'summary',
        element: withSuspense(OnboardingPlaceholderPage),
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
