/**
 * @fileoverview The route-element wrapper every feature's `routes.tsx` needs.
 *
 * This existed nine times over — one identical copy in each of
 * `features/{activities,analytics,assistant,calendar,persons,rooms,sharing,
 * transports,trips}/routes.tsx`. A fix to the fallback, or to what the error
 * boundary catches, reached exactly one of them.
 *
 * @module components/shared/with-suspense
 */

import { type ReactElement, Suspense } from 'react';

import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { LoadingState } from '@/components/shared/LoadingState';

/**
 * Wraps a lazy-loaded page component in an error boundary and a Suspense
 * boundary, ready to hand to a route's `element`.
 *
 * The error boundary is the outer one on purpose: a chunk that fails to load
 * throws on render, and a boundary *inside* Suspense would never see it.
 *
 * @param Component - The `React.lazy` component to wrap
 * @returns The element to give a route's `element` property
 *
 * @example
 * ```tsx
 * const CalendarPage = lazy(() => import('./pages/CalendarPage'));
 *
 * // Children of the `trips/:tripId` parent in `src/router.tsx`.
 * export const calendarRoutes: RouteObject[] = [
 *   { path: 'calendar', element: withSuspense(CalendarPage) },
 * ];
 * ```
 */
export function withSuspense(
  Component: React.LazyExoticComponent<React.ComponentType>,
): ReactElement {
  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingState variant="fullPage" />}>
        <Component />
      </Suspense>
    </ErrorBoundary>
  );
}
