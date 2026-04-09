/**
 * @fileoverview Route configuration for the AI assistant feature.
 * Defines lazy-loaded routes for the assistant page.
 *
 * @module features/assistant/routes
 */

import { type ReactElement, Suspense, lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { LoadingState } from '@/components/shared/LoadingState';

// ============================================================================
// Lazy-Loaded Page Components
// ============================================================================

/**
 * Lazy-loaded AssistantPage component for code splitting.
 * Transforms named export to default export for React.lazy compatibility.
 */
const AssistantPage = lazy(() =>
  import('./pages/AssistantPage').then((module) => ({
    default: module.AssistantPage,
  })),
);

// ============================================================================
// Suspense Wrapper
// ============================================================================

/**
 * Wraps a lazy-loaded component in Suspense with a loading fallback and error boundary.
 *
 * @param Component - The lazy-loaded component to wrap
 * @returns A React element with error boundary and Suspense boundary
 */
function withSuspense(
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

// ============================================================================
// Route Configuration
// ============================================================================

/**
 * Route configuration for the AI assistant feature.
 * These routes are designed to be spread into a parent route's children array.
 *
 * Routes:
 * - `/assistant` - AI assistant chat page
 */
export const assistantRoutes: RouteObject[] = [
  {
    path: 'assistant',
    element: withSuspense(AssistantPage),
  },
];
