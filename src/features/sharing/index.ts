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
export {
  extractP2pTripInviteFromScannedPayload,
  extractShareIdFromScannedPayload,
  type P2pTripInviteFromScan,
} from './utils/share-qr-parse';

// ============================================================================
// Pages
// ============================================================================

export { ShareImportPage } from './pages/ShareImportPage';
export { IdentityStepPage } from './pages/IdentityStepPage';
export { RoomSelectionStepPage } from './pages/RoomSelectionStepPage';
export { TransportEntryStepPage } from './pages/TransportEntryStepPage';
export { SummaryStepPage } from './pages/SummaryStepPage';
export { TripSyncPage } from './pages/TripSyncPage';

// ============================================================================
// Routes
// ============================================================================

export { sharingRoutes, sharingSyncRoutes } from './routes';
