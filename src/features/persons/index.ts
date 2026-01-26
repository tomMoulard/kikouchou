/**
 * @fileoverview Barrel export for the persons feature module.
 * Import person pages, components, and utilities from this index for cleaner imports.
 *
 * @module features/persons
 *
 * @example
 * ```tsx
 * import {
 *   PersonListPage,
 *   PersonForm,
 *   PersonCard,
 *   PersonDialog,
 *   personRoutes,
 * } from '@/features/persons';
 * ```
 */

// ============================================================================
// Pages
// ============================================================================

export { PersonListPage } from './pages/PersonListPage';

// ============================================================================
// Components
// ============================================================================

export { PersonForm } from './components/PersonForm';
export type { PersonFormProps } from './components/PersonForm';

export { PersonCard } from './components/PersonCard';
export type { PersonCardProps, TransportSummary } from './components/PersonCard';

export { PersonDialog } from './components/PersonDialog';
export type { PersonDialogProps } from './components/PersonDialog';

// ============================================================================
// Route Configuration
// ============================================================================

export { personRoutes } from './routes';
export type { PersonListParams } from './routes';
