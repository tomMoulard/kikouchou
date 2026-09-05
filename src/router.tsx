/**
 * @fileoverview Main router configuration for the Kikouchou application.
 * Configures all routes with lazy loading, error boundaries, and proper Layout wrapping.
 *
 * @module router
 */

import { type ReactElement, Suspense, lazy } from 'react';
import {
  Navigate,
  Outlet,
  type RouteObject,
  createBrowserRouter,
  isRouteErrorResponse,
  useRouteError,
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
import { guestGroupRoutes } from '@/features/guest-groups/routes';
import { transportRoutes } from '@/features/transports/routes';
import { activityRoutes } from '@/features/activities/routes';
import { joinRoutes, sharingRoutes, sharingSyncRoutes } from '@/features/sharing/routes';
import { assistantRoutes } from '@/features/assistant/routes';
import { analyticsRoutes } from '@/features/analytics/routes';
import { authRoutes } from '@/features/auth/routes';

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
  const { t } = useTranslation(),
   error = useRouteError();

  // Determine error type and message
  let title = t('errors.generic', 'Something went wrong'),
   description = t('errors.loadingFailed', 'An unexpected error occurred'),
   status: number | undefined;

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
  },

   handleGoHome = (): void => {
    window.location.href = import.meta.env.BASE_URL + 'trips';
  };

  return (
    <div className="min-h-svh bg-background flex items-center justify-center p-4">
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
 * Everything that hangs directly off one trip rather than off a named
 * sub-page: the calendar (including the bare `/trips/:tripId`, which its index
 * route redirects to `calendar`) and the P2P sync page.
 *
 * This route object is the **single** owner of `trips/:tripId`. There used to
 * be three claimants — `calendarRoutes` registered `trips/:tripId/calendar`
 * *and* `trips/:tripId` as flat siblings, and this file added a third for
 * `sharingSyncRoutes`. Two of them rendered their own separate copy of the
 * calendar, so crossing between the bare path and `/calendar` remounted the
 * page and `?view=` applied to only one of them.
 *
 * Deliberately no `element`: a parent that has one must render an `<Outlet />`
 * or it swallows every child, which is how the share wizard stayed invisible
 * for months. With none, React Router renders the matched child directly.
 */
const tripScopedRoutes: RouteObject = {
  path: 'trips/:tripId',
  children: [
    // Calendar: index redirect + `calendar`
    ...calendarRoutes,

    // P2P sync (QR export/import): `sync`
    ...sharingSyncRoutes,
  ],
};

/**
 * Main application routes wrapped with Layout.
 * All these routes have the navigation chrome (header, sidebar, bottom nav).
 *
 * Exported so route tests can mount the real table rather than a hand-built
 * approximation of it.
 */
export const appRoutes: RouteObject = {
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

    // Calendar + P2P sync, both owned by a single `trips/:tripId` parent
    tripScopedRoutes,

    // Room management routes (trip-scoped)
    ...roomRoutes,

    // Person management routes (trip-scoped)
    ...personRoutes,

    // Guest groups (global — reachable with no trip selected)
    ...guestGroupRoutes,

    // Transport management routes
    // Note: transportRoutes uses 'transports' path, need to check if it needs trip scoping
    ...transportRoutes,

    // Shared activity agenda (trip-scoped)
    ...activityRoutes,

    // Trip + global analytics
    ...analyticsRoutes,

    // Settings route
    settingsRoute,

    // Sign-in page: the ways into an account, discovered from the project
    ...authRoutes,

    // AI Assistant route
    ...assistantRoutes,

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
  // Spread the full sharing route object so that wizard child routes
  // (identity, room, transport, summary) are registered in the router.
  // Previously only `element` was copied, which silently dropped the
  // `children` array and caused sub-routes to never render.
  ...sharingRoutes[0],
  errorElement: <ErrorPage />,
};

/**
 * The application's complete route table.
 *
 * Exported so that route tests can mount the real thing with
 * `createMemoryRouter` instead of hand-building a tree that only resembles it —
 * a hand-built tree cannot catch a route registered twice, a parent missing its
 * `<Outlet />`, or a child nested under the wrong path.
 *
 * Route Structure:
 * - `/join/:token` - Invite link: redeem, download the trip, pick who you are
 * - `/share/:shareId` - Public sharing page (no navigation)
 * - `/` - Main app root (with navigation)
 *   - `/trips` - Trip list
 *   - `/trips/new` - Create trip
 *   - `/trips/:tripId/edit` - Edit trip
 *   - `/trips/:tripId` - Redirects to the calendar, keeping `?view=`
 *   - `/trips/:tripId/calendar` - Trip calendar
 *   - `/trips/:tripId/sync` - P2P sync (QR export/import)
 *   - `/trips/:tripId/rooms` - Room management
 *   - `/trips/:tripId/persons` - Person management
 *   - `/trips/:tripId/transports` - Transport management
 *   - `/trips/:tripId/activities` - Shared activity agenda
 *   - `/trips/:tripId/analytics` - Trip analytics
 *   - `/analytics` - Analytics across all trips
 *   - `/groups` - Reusable guest groups, imported into any trip
 *   - `/settings` - App settings
 *   - `/signin` - Sign in (providers come from the project's own config)
 */
export const routes: RouteObject[] = [
  // Public routes (outside Layout)
  publicRoutes,

  // Invite links: /join/:token. Outside Layout — somebody arriving from a
  // message has no trip selected and no navigation to use yet.
  ...joinRoutes.map((route) => ({ ...route, errorElement: <ErrorPage /> })),

  // Main application routes (with Layout)
  appRoutes,
];

/**
 * Main application router.
 * Combines public routes (sharing) and authenticated routes (main app).
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
export const router = createBrowserRouter(routes, {
  // Use Vite's BASE_URL for GitHub Pages deployment
  basename: import.meta.env.BASE_URL,
});

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
export type { AnalyticsParams } from '@/features/analytics/routes';
export type { ActivityListParams } from '@/features/activities/routes';
