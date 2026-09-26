/**
 * @fileoverview Route configuration for the auth feature.
 *
 * @module features/auth/routes
 */

import { lazy } from 'react';
import { Navigate } from 'react-router-dom';
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
 *
 * - `/auth/native`: where a magic link asked for in a store app returns.
 *   The app claims the path as a universal link, so on the phone that asked
 *   the app opens and exchanges the code itself. Reaching this route means the
 *   website opened instead, on another device or with no app installed:
 *   `lib/supabase/auth-callback` has already taken the code off the URL at
 *   import, and the exchange runs as for any web sign-in.
 */
export const authRoutes: RouteObject[] = [
  {
    path: 'signin',
    element: withSuspense(SignInPage),
  },
  {
    path: 'auth/native',
    element: <Navigate to="/trips" replace />,
  },
];
