/**
 * @fileoverview Public API for the Transports feature module.
 * Re-exports pages, components, routes, and types for external consumption.
 *
 * @module features/transports
 *
 * @example
 * ```tsx
 * import {
 *   TransportListPage,
 *   TransportForm,
 *   TransportDialog,
 *   transportRoutes,
 * } from '@/features/transports';
 * ```
 */

// ============================================================================
// Pages
// ============================================================================

export { TransportListPage } from './pages/TransportListPage';

// ============================================================================
// Components
// ============================================================================

export { TransportForm } from './components/TransportForm';
export type { TransportFormProps } from './components/TransportForm';

export { TransportDialog } from './components/TransportDialog';
export type { TransportDialogProps } from './components/TransportDialog';

export { UpcomingPickups } from './components/UpcomingPickups';
export type { UpcomingPickupsProps } from './components/UpcomingPickups';

export { RideChangeFeed } from './components/RideChangeFeed';
export type { RideChangeFeedProps } from './components/RideChangeFeed';

// ============================================================================
// Hooks
// ============================================================================

// The detection half of "Alice moved her pickup": one device's watermark
// against the document's current times. Exported because the same signal feeds
// more than the feed that renders it.
export { useRideChanges } from './hooks/useRideChanges';
export type {
  RideChange,
  UseRideChangesResult,
} from './hooks/useRideChanges';

// ============================================================================
// Utilities
// ============================================================================

// Timing and selection only. `groupPickupsByProximity` stays internal to the
// pickup alert panel: it groups an already-selected list and would silently
// render assigned or past rides as "needs a driver" if handed a raw one.
export {
  isTransportUpcoming,
  selectPickupsNeedingDriver,
  sortTransportsByInstant,
  toTransportInstant,
} from './utils/pickup-utils';

// ============================================================================
// Routes
// ============================================================================

export { transportRoutes } from './routes';
