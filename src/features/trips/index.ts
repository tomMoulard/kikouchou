/**
 * @fileoverview Barrel export for the trips feature module.
 * Import trip pages, components, and utilities from this index for cleaner imports.
 *
 * @module features/trips
 *
 * @example
 * ```tsx
 * import {
 *   TripListPage,
 *   TripCreatePage,
 *   TripEditPage,
 *   TripForm,
 *   TripCard,
 *   getDateLocale,
 *   formatDateRange,
 * } from '@/features/trips';
 * ```
 */

// ============================================================================
// Pages
// ============================================================================

export { TripListPage } from './pages/TripListPage';

export { TripCreatePage } from './pages/TripCreatePage';

export { TripEditPage } from './pages/TripEditPage';

// ============================================================================
// Components
// ============================================================================

export { TripForm } from './components/TripForm';
export type { TripFormProps } from './components/TripForm';

export { TripCard, getDateLocale, formatDateRange } from './components/TripCard';
export type { TripCardProps } from './components/TripCard';

// ============================================================================
// Route Configuration
// ============================================================================

export { tripRoutes } from './routes';
