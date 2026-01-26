/**
 * @fileoverview Public API for the Sharing feature module.
 * Re-exports pages, components, routes, and types for external consumption.
 *
 * @module features/sharing
 *
 * @example
 * ```tsx
 * import {
 *   ShareDialog,
 *   ShareImportPage,
 *   sharingRoutes,
 * } from '@/features/sharing';
 * ```
 */

// ============================================================================
// Components
// ============================================================================

export { ShareDialog } from './components/ShareDialog';
export type { ShareDialogProps } from './components/ShareDialog';

// ============================================================================
// Pages
// ============================================================================

export { ShareImportPage } from './pages/ShareImportPage';

// ============================================================================
// Routes
// ============================================================================

export { sharingRoutes, ShareImportRoute } from './routes';
