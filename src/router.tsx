/**
 * @fileoverview Main router configuration for the Kikoushou application.
 * Configures all routes with lazy loading, error boundaries, and proper Layout wrapping.
 *
 * @module router
 */

import { lazy, Suspense, type ReactElement } from 'react';
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  useRouteError,
  isRouteErrorResponse,
  type RouteObject,
} from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';

import { Layout } from '@/components/shared/Layout';
import { LoadingState } from '@/components/shared/LoadingState';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';

// Feature route imports
import { tripRoutes } from '@/features/trips/routes';
import { calendarRoutes } from '@/features/calendar/routes';
import { roomRoutes } from '@/features/rooms/routes';
import { personRoutes } from '@/features/persons/routes';
import { transportRoutes } from '@/features/transports/routes';
import { sharingRoutes } from '@/features/sharing/routes';

// ============================================================================
// Lazy-loaded Components
// ============================================================================

/**
 * Lazy-loaded SettingsPage component for code splitting.
 */
const SettingsPage = lazy(() =>
  import('@/features/settings/pages/SettingsPage').then((module) => ({
    default: module.SettingsPage,
  })),
);

// ============================================================================
// Error Page Component
// ============================================================================

/**
 * Error page component for handling route errors and 404s.
 * Uses React Router's error handling utilities for type-safe error access.
 */
function ErrorPage(): ReactElement {
  const { t } = useTranslation();
  const error = useRouteError();

  // Determine error type and message
  let title = t('errors.generic', 'Something went wrong');
  let description = t('errors.loadingFailed', 'An unexpected error occurred');
  let status: number | undefined;

  if (isRouteErrorResponse(error)) {
    // React Router error response (404, etc.)
    status = error.status;
    if (error.status === 404) {
      title = t('errors.notFound', 'Page not found');
      description = t(
        'errors.notFoundDescription',
        "The page you're looking for doesn't exist or has been moved.",
      );
    } else {
      title = `${t('errors.generic', 'Error')} ${error.status}`;
      description = error.statusText || error.data?.message || description;
    }
  } else if (error instanceof Error) {
    // JavaScript Error
    description = error.message;
  }

  const handleRetry = (): void => {
    window.location.reload();
  };

  const handleGoHome = (): void => {
    window.location.href = '/trips';
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center text-center">
            {/* Error Icon */}
            <div className="flex size-16 items-center justify-center rounded-full bg-destructive/10 mb-4">
              <AlertTriangle
                className="size-8 text-destructive"
                aria-hidden="true"
              />
            </div>

            {/* Status Code */}
            {status !== undefined && (
              <p className="text-4xl font-bold text-muted-foreground mb-2">
                {status}
              </p>
            )}

            {/* Title */}
            <CardTitle className="text-xl mb-2">{title}</CardTitle>

            {/* Description */}
            <CardDescription className="mb-6">{description}</CardDescription>

            {/* Actions */}
            <div className="flex gap-3">
              <Button variant="outline" onClick={handleGoHome}>
                <Home className="size-4 mr-2" aria-hidden="true" />
                {t('trips.title', 'My trips')}
              </Button>
              <Button onClick={handleRetry}>
                <RefreshCw className="size-4 mr-2" aria-hidden="true" />
                {t('common.retry', 'Retry')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Layout Wrapper with Outlet
// ============================================================================

/**
 * Layout wrapper that renders Layout with Outlet for nested routes.
 * This ensures the Layout component receives proper children.
 */
function LayoutWrapper(): ReactElement {
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

// ============================================================================
// Route Configuration
// ============================================================================

/**
 * Settings route with lazy-loaded SettingsPage.
 */
const settingsRoute: RouteObject = {
  path: 'settings',
  element: (
    <ErrorBoundary>
      <Suspense fallback={<LoadingState variant="fullPage" />}>
        <SettingsPage />
      </Suspense>
    </ErrorBoundary>
  ),
};

/**
 * Main application routes wrapped with Layout.
 * All these routes have the navigation chrome (header, sidebar, bottom nav).
 */
const appRoutes: RouteObject = {
  path: '/',
  element: <LayoutWrapper />,
  errorElement: <ErrorPage />,
  children: [
    // Index redirect to trips list
    {
      index: true,
      element: <Navigate to="/trips" replace />,
    },

    // Trip management routes
    ...tripRoutes,

    // Calendar routes (trip-scoped)
    ...calendarRoutes,

    // Room management routes (trip-scoped)
    ...roomRoutes,

    // Person management routes (trip-scoped)
    ...personRoutes,

    // Transport management routes
    // Note: transportRoutes uses 'transports' path, need to check if it needs trip scoping
    ...transportRoutes,

    // Settings route
    settingsRoute,

    // Catch-all 404 route - must be last
    {
      path: '*',
      element: <ErrorPage />,
    },
  ],
};

/**
 * Public sharing routes - NOT wrapped with Layout.
 * These routes are accessed via shared links and should not show navigation.
 */
const publicRoutes: RouteObject = {
  path: 'share/:shareId',
  element: sharingRoutes[0]?.element,
  errorElement: <ErrorPage />,
};

/**
 * Main application router.
 * Combines public routes (sharing) and authenticated routes (main app).
 *
 * Route Structure:
 * - `/share/:shareId` - Public sharing page (no navigation)
 * - `/` - Main app root (with navigation)
 *   - `/trips` - Trip list
 *   - `/trips/new` - Create trip
 *   - `/trips/:tripId/edit` - Edit trip
 *   - `/trips/:tripId` - Trip calendar (default view)
 *   - `/trips/:tripId/calendar` - Trip calendar
 *   - `/trips/:tripId/rooms` - Room management
 *   - `/trips/:tripId/persons` - Person management
 *   - `/transports` - Transport management
 *   - `/settings` - App settings
 *
 * @example
 * ```tsx
 * // In App.tsx or main.tsx
 * import { RouterProvider } from 'react-router-dom';
 * import { router } from './router';
 *
 * function App() {
 *   return <RouterProvider router={router} />;
 * }
 * ```
 */
export const router = createBrowserRouter([
  // Public routes (outside Layout)
  publicRoutes,

  // Main application routes (with Layout)
  appRoutes,
]);

// ============================================================================
// Type Exports
// ============================================================================

/**
 * Re-export route param types from feature modules for convenience.
 */
export type { TripEditParams } from '@/features/trips/routes';
export type { CalendarParams } from '@/features/calendar/routes';
export type { RoomListParams } from '@/features/rooms/routes';
export type { PersonListParams } from '@/features/persons/routes';
