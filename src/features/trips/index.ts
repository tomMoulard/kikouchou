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

export { LocationAutocomplete, ImportBadge } from './components/LocationAutocomplete';
export type { LocationAutocompleteProps, ImportBadgeProps, TripImportData } from './components/LocationAutocomplete';

export { TripCard } from './components/TripCard';
export type { TripCardProps } from './components/TripCard';

export { TripsLocationMap } from './components/TripsLocationMap';
export type { TripsLocationMapProps } from './components/TripsLocationMap';

// ============================================================================
// Route Configuration
// ============================================================================

export { tripRoutes } from './routes';
