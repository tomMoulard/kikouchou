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
export { TripSyncExportPanel } from './components/TripSyncExportPanel';
export type { TripSyncExportPanelProps } from './components/TripSyncExportPanel';
export { ImportTripQrDialog } from './components/ImportTripQrDialog';
export type { ImportTripQrDialogProps } from './components/ImportTripQrDialog';
export { extractShareIdFromScannedPayload } from './utils/share-qr-parse';

// ============================================================================
// Pages
// ============================================================================

export { ShareImportPage } from './pages/ShareImportPage';
export { OnboardingPlaceholderPage } from './pages/OnboardingPlaceholderPage';
export { IdentityStepPage } from './pages/IdentityStepPage';
export { RoomSelectionStepPage } from './pages/RoomSelectionStepPage';
export { TransportEntryStepPage } from './pages/TransportEntryStepPage';
export { SummaryStepPage } from './pages/SummaryStepPage';
export { TripSyncPage } from './pages/TripSyncPage';
export { P2PTripPage } from './pages/P2PTripPage';

// ============================================================================
// Routes
// ============================================================================

export { sharingRoutes, sharingSyncRoutes, ShareImportRoute } from './routes';
