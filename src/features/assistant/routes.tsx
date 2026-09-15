/**
 * @fileoverview Route configuration for the AI assistant feature.
 * Defines lazy-loaded routes for the assistant page.
 *
 * @module features/assistant/routes
 */

import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

import { withSuspense } from '@/components/shared/with-suspense';

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
