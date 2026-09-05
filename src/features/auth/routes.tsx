/**
 * @fileoverview Route configuration for the auth feature.
 *
 * @module features/auth/routes
 */

import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

import { withSuspense } from '@/components/shared/with-suspense';

// ============================================================================
// Lazy-Loaded Page Components
// ============================================================================

const SignInPage = lazy(() =>
  import('./pages/SignInPage').then((module) => ({
    default: module.SignInPage,
  })),
);

// ============================================================================
// Route Configuration
// ============================================================================

/**
 * Auth routes:
 * - `/signin` — every way into an account, built from what the project reports
 *
 * Inside the app Layout rather than outside it, unlike `/join` and `/share`:
 * whoever is here is already using the app and may well decide not to sign in
 * after all, and the navigation chrome is what lets them leave.
 *
 * `?next=` carries where to return to once a session exists. It only applies to
 * a way in that completes on the page — a wallet signature — because the OAuth
 * redirect and the emailed link both come back to the app root.
 */
export const authRoutes: RouteObject[] = [
  {
    path: 'signin',
    element: withSuspense(SignInPage),
  },
];
