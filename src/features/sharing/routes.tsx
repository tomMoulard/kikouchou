/**
 * @fileoverview Route configuration for the Sharing feature.
 * Provides lazy-loaded route definitions for shared trip viewing.
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

import { lazy, Suspense, type ReactElement } from 'react';
import type { RouteObject } from 'react-router-dom';

import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { LoadingState } from '@/components/shared/LoadingState';

// ============================================================================
// Lazy-loaded Components
// ============================================================================

/**
 * Lazy-loaded ShareImportPage component.
 * Uses React.lazy for code splitting and optimal bundle size.
 */
const ShareImportPage = lazy(() =>
  import('./pages/ShareImportPage').then((module) => ({
    default: module.ShareImportPage,
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
 * - `/share/:shareId` - Public page to view a shared trip
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
